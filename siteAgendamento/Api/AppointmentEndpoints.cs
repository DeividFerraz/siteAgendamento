using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Appointments;
using siteAgendamento.Infrastructure;
using System.Globalization;

namespace siteAgendamento.Api;

public static class AppointmentEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}").RequireAuthorization();

        // LISTAR agendamentos (dia/intervalo). Staff comum só enxerga o próprio.
        g.MapGet("/appointments", async (
            [FromRoute] string tenantSlug,
            AppDbContext db,
            HttpContext http,
            HttpRequest req) =>
        {
            var defaultFrom = DateTimeOffset.UtcNow.Date;
            var defaultTo = defaultFrom.AddDays(1).AddTicks(-1);

            var fromStr = req.Query["fromUtc"].FirstOrDefault() ?? req.Query["from"].FirstOrDefault();
            var toStr = req.Query["toUtc"].FirstOrDefault() ?? req.Query["to"].FirstOrDefault();

            var fromUtc = TryParse(fromStr) ?? defaultFrom;
            var toUtc = TryParse(toStr) ?? defaultTo;
            if (toUtc < fromUtc) (fromUtc, toUtc) = (toUtc, fromUtc);

            Guid? staffId = null;
            if (Guid.TryParse(req.Query["staffId"].FirstOrDefault(), out var sid)) staffId = sid;

            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var privileged = http.User.IsInRole("adm master") || http.User.IsInRole("owner") || http.User.IsInRole("admin");
            if (!privileged)
            {
                var myStaff = http.User.FindFirst("staff_id")?.Value;
                if (!Guid.TryParse(myStaff, out var my)) return Results.Forbid();
                staffId = my;
            }

            var q = db.Appointments.AsNoTracking()
                .Where(a => a.TenantId == tenant.Id &&
            a.StartUtc < toUtc.UtcDateTime &&
            a.EndUtc > fromUtc.UtcDateTime &&
            a.Status != AppointmentStatus.Canceled);     // <<<<<< NÃO retorna cancelados

            if (staffId.HasValue) q = q.Where(a => a.StaffId == staffId.Value);

            var list = await q
                .OrderBy(a => a.StartUtc)
                .Select(a => new
                {
                    a.Id,
                    a.StaffId,
                    a.StartUtc,
                    a.EndUtc,
                    a.Kind,
                    a.ClientName
                })
                .ToListAsync();

            return Results.Ok(list);
        });

        // CRIAR (staff comum só para si; managers para qualquer staff)
        g.MapPost("/appointments", [Authorize(Policy = "ManageOwnCalendar")] async (
            string tenantSlug, [FromBody] CreateAppointmentDto dto, AppDbContext db, HttpContext http) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var privileged = http.User.IsInRole("adm master") || http.User.IsInRole("owner") || http.User.IsInRole("admin");
            if (!privileged)
            {
                var myStaff = http.User.FindFirst("staff_id")?.Value;
                if (myStaff is null || !Guid.TryParse(myStaff, out var me) || me != dto.StaffId)
                    return Results.Forbid();
            }

            // Serviço padrão (se não houver nenhum)
            var service = await db.Services.FirstOrDefaultAsync(s => s.TenantId == tenant.Id);
            if (service is null)
            {
                service = new siteAgendamento.Domain.Catalog.Service
                {
                    TenantId = tenant.Id,
                    Name = "Serviço padrão",
                    DurationMin = tenant.Settings.DefaultAppointmentMinutes,
                    BufferBeforeMin = 0,
                    BufferAfterMin = 0,
                    Capacity = 1,
                    PriceCents = 0
                };
                db.Services.Add(service);
                await db.SaveChangesAsync();
            }

            // Conflito
            var startUtc = DateTime.SpecifyKind(dto.StartUtc, DateTimeKind.Utc);
            var endUtc = DateTime.SpecifyKind(dto.EndUtc, DateTimeKind.Utc);
            if (endUtc <= startUtc) return Results.BadRequest(new { message = "EndUtc deve ser maior que StartUtc." });

            var conflict = await db.Appointments.AnyAsync(a =>
                a.TenantId == tenant.Id && a.StaffId == dto.StaffId &&
                a.Status != AppointmentStatus.Canceled &&
                a.StartUtc < endUtc && a.EndUtc > startUtc);

            if (conflict) return Results.BadRequest(new { message = "Conflito de horário para este colaborador." });

            var appt = new Appointment
            {
                TenantId = tenant.Id,
                ServiceId = service.Id,
                StaffId = dto.StaffId,
                StartUtc = startUtc,
                EndUtc = endUtc,
                Status = AppointmentStatus.Confirmed,
                Kind = string.IsNullOrWhiteSpace(dto.Kind) ? "appt" : dto.Kind!.Trim().ToLowerInvariant(),
                ClientName = string.IsNullOrWhiteSpace(dto.ClientName) ? null : dto.ClientName!.Trim()
            };

            db.Appointments.Add(appt);
            await db.SaveChangesAsync();

            return Results.Created($"/api/v1/{tenantSlug}/appointments/{appt.Id}", new { appt.Id });
        });

        // ATUALIZAR
        g.MapPut("/appointments/{id:guid}", [Authorize(Policy = "ManageOwnCalendar")] async (
            string tenantSlug, Guid id, [FromBody] UpdateAppointmentDto dto, AppDbContext db, HttpContext http) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenant.Id);
            if (appt is null) return Results.NotFound(new { message = "Agendamento não encontrado." });

            var privileged = http.User.IsInRole("adm master") || http.User.IsInRole("owner") || http.User.IsInRole("admin");
            var targetStaffId = dto.StaffId ?? appt.StaffId;

            if (!privileged)
            {
                var myStaff = http.User.FindFirst("staff_id")?.Value;
                if (myStaff is null || !Guid.TryParse(myStaff, out var me) || me != targetStaffId)
                    return Results.Forbid();
            }

            var newStart = dto.StartUtc ?? appt.StartUtc;
            var newEnd = dto.EndUtc ?? appt.EndUtc;
            if (newEnd <= newStart) return Results.BadRequest(new { message = "EndUtc deve ser maior que StartUtc." });

            var conflict = await db.Appointments.AnyAsync(a =>
                a.Id != appt.Id &&
                a.TenantId == tenant.Id &&
                a.StaffId == targetStaffId &&
                a.Status != AppointmentStatus.Canceled &&
                a.StartUtc < newEnd && a.EndUtc > newStart);

            if (conflict) return Results.BadRequest(new { message = "Conflito de horário." });

            appt.StaffId = targetStaffId;
            appt.StartUtc = DateTime.SpecifyKind(newStart, DateTimeKind.Utc);
            appt.EndUtc = DateTime.SpecifyKind(newEnd, DateTimeKind.Utc);
            if (dto.ClientName is not null)
                appt.ClientName = string.IsNullOrWhiteSpace(dto.ClientName) ? null : dto.ClientName.Trim();

            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // EXCLUIR (marca como Cancelado)
        g.MapDelete("/appointments/{id:guid}", [Authorize(Policy = "ManageOwnCalendar")] async (
            string tenantSlug, Guid id, AppDbContext db, HttpContext http) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenant.Id);
            if (appt is null) return Results.NotFound(new { message = "Agendamento não encontrado." });

            var privileged = http.User.IsInRole("adm master") || http.User.IsInRole("owner") || http.User.IsInRole("admin");
            if (!privileged)
            {
                var myStaff = http.User.FindFirst("staff_id")?.Value;
                if (myStaff is null || !Guid.TryParse(myStaff, out var me) || me != appt.StaffId)
                    return Results.Forbid();
            }

            appt.Status = AppointmentStatus.Canceled;
            appt.UpdatedUtc = DateTime.UtcNow;

            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    static DateTimeOffset? TryParse(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var fmts = new[] {
            "dd/MM/yyyy","dd/MM/yyyy HH:mm","dd/MM/yyyy HH:mm:ss",
            "yyyy-MM-dd","yyyy-MM-dd HH:mm","yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-ddTHH:mm:ss","yyyy-MM-ddTHH:mm:ssK","o"
        };
        return DateTimeOffset.TryParseExact(s.Trim(), fmts, CultureInfo.GetCultureInfo("pt-BR"),
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var v) ? v : null;
    }

    // DTOs
    public record CreateAppointmentDto(Guid StaffId, DateTime StartUtc, DateTime EndUtc, string? Kind, string? ClientName);
    public record UpdateAppointmentDto(DateTime? StartUtc, DateTime? EndUtc, Guid? StaffId, string? ClientName);
}
