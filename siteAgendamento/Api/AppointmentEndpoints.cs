using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Application.Services;
using siteAgendamento.Domain.Appointments;
using siteAgendamento.Infrastructure;
using System.Security.Claims;

namespace siteAgendamento.Api;

public static class AppointmentEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}").RequireAuthorization();

        // HOLD
        g.MapPost("/appointments:hold", async (
            string tenantSlug,
            [FromBody] HoldDto dto,
            AppDbContext db,
            BookingService booking,
            IConfiguration cfg) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);

            var ttl = TimeSpan.FromSeconds(cfg.GetValue<int>("Scheduling:DefaultHoldSeconds"));

            var hold = await booking.CreateHoldAsync(
                t.Id,
                dto.Slot.ServiceId,
                dto.Slot.StaffId,
                dto.Slot.StartUtc,
                dto.Slot.EndUtc,
                ttl);

            return Results.Ok(new { hold.Token, hold.ExpiresUtc });
        });

        // BOOK
        g.MapPost("/appointments", async (
            string tenantSlug,
            [FromBody] BookDto dto,
            AppDbContext db,
            BookingService booking,
            HttpContext http) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);

            // --- pega o id do usuário de forma resiliente (sub -> NameIdentifier) ---
            var userId =
                TryGetGuidClaim(http, "sub")
                ?? TryGetGuidClaim(http, ClaimTypes.NameIdentifier);

            if (userId is null)
                return Results.Forbid(); // token sem identificador de usuário

            string clientType;
            Guid? clientId = null;
            string? guestJson = null;

            if (dto.ClientId.HasValue)
            {
                clientType = "Registered";
                clientId = dto.ClientId.Value;
            }
            else if (dto.Guest is not null)
            {
                clientType = "Guest";
                guestJson = System.Text.Json.JsonSerializer.Serialize(dto.Guest);
            }
            else
            {
                var allowAnon = t.Settings.AllowAnonymousAppointments;
                if (!allowAnon) return Results.BadRequest("Agendamentos anônimos não habilitados.");
                clientType = "Anonymous";
            }

            // O BookAsync cria o agendamento usando o HOLD (que já contém o StaffId correto)
            var appt = await booking.BookAsync(
                t.Id,
                dto.HoldToken,
                clientId,
                guestJson,
                clientType,
                dto.Notes,
                userId.Value);

            return Results.Created($"/api/v1/{tenantSlug}/appointments/{appt.Id}", appt);
        });

        // LIST
        g.MapGet("/appointments", async (
            string tenantSlug,
            DateTime fromUtc,
            DateTime toUtc,
            Guid? staffId,
            AppDbContext db,
            HttpContext http) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);

            // Staff comum só pode ver a própria agenda
            // (Owner/Admin/Receptionist veem qualquer uma)
            var isPrivileged =
                http.User.IsInRole("Owner") ||
                http.User.IsInRole("Admin") ||
                http.User.IsInRole("Receptionist");

            if (!isPrivileged)
            {
                var myStaff = TryGetGuidClaim(http, "staff_id");
                if (myStaff is null) return Results.Forbid();
                staffId = myStaff;
            }

            var query = db.Appointments
                .Where(a => a.TenantId == t.Id && a.StartUtc >= fromUtc && a.EndUtc <= toUtc);

            if (staffId.HasValue)
                query = query.Where(a => a.StaffId == staffId.Value);

            var list = await query.ToListAsync();
            return Results.Ok(list);
        });

        // RESCHEDULE
        g.MapPatch("/appointments/{id:guid}:reschedule", async (
            string tenantSlug,
            Guid id,
            [FromBody] RescheduleDto dto,
            AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.TenantId == t.Id && a.Id == id);
            if (appt == null) return Results.NotFound();

            // regra simples
            if (dto.StartUtc >= dto.EndUtc || dto.StartUtc < DateTime.UtcNow)
                return Results.BadRequest("Horário inválido.");

            var conflict = await db.Appointments.AnyAsync(a =>
                a.TenantId == t.Id &&
                a.StaffId == appt.StaffId &&
                a.Id != appt.Id &&
                a.Status != AppointmentStatus.Canceled &&
                a.StartUtc < dto.EndUtc &&
                a.EndUtc > dto.StartUtc);

            if (conflict) return Results.Conflict("Conflito de agenda.");

            appt.StartUtc = dto.StartUtc;
            appt.EndUtc = dto.EndUtc;
            appt.Status = AppointmentStatus.Rescheduled;
            appt.UpdatedUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(appt);
        });

        // CANCEL
        g.MapPost("/appointments/{id:guid}:cancel", async (
            string tenantSlug,
            Guid id,
            [FromBody] CancelDto dto,
            AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.TenantId == t.Id && a.Id == id);
            if (appt == null) return Results.NotFound();

            var cutoff = TimeSpan.FromHours(t.Settings.CancellationWindowHours);
            var now = DateTime.UtcNow;
            var feeApplies = appt.StartUtc - now < cutoff;

            appt.Status = AppointmentStatus.Canceled;
            appt.UpdatedUtc = now;
            await db.SaveChangesAsync();

            return Results.Ok(new
            {
                appt.Id,
                feeMayApply = feeApplies,
                message = feeApplies ? "Cancelado fora da janela." : "Cancelado."
            });
        });

        // NOSHOW
        g.MapPost("/appointments/{id:guid}:noshow", async (
            string tenantSlug,
            Guid id,
            AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.TenantId == t.Id && a.Id == id);
            if (appt == null) return Results.NotFound();

            appt.Status = AppointmentStatus.NoShow;
            appt.UpdatedUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(appt);
        });
    }

    // ===== helpers =====
    private static Guid? TryGetGuidClaim(HttpContext http, string claimType)
    {
        var v = http?.User?.FindFirst(claimType)?.Value;
        return Guid.TryParse(v, out var g) ? g : (Guid?)null;
    }

    // ===== DTOs =====
    public record HoldDto(HoldSlot Slot);
    public record HoldSlot(Guid ServiceId, Guid StaffId, DateTime StartUtc, DateTime EndUtc);
    public record BookDto(string HoldToken, Guid? ClientId, GuestDto? Guest, string? Notes);
    public record GuestDto(string FirstName, string LastName, string? Email, string? Phone);
    public record RescheduleDto(DateTime StartUtc, DateTime EndUtc);
    public record CancelDto(string? Reason);
}
