using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Application.Services;
using siteAgendamento.Domain.Appointments;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class AppointmentEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}").RequireAuthorization();

        // HOLD
        g.MapPost("/appointments:hold", async (string tenantSlug, [FromBody] HoldDto dto, AppDbContext db, BookingService booking, IConfiguration cfg) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var ttl = TimeSpan.FromSeconds(cfg.GetValue<int>("Scheduling:DefaultHoldSeconds"));
            var hold = await booking.CreateHoldAsync(t.Id, dto.Slot.ServiceId, dto.Slot.StaffId, dto.Slot.StartUtc, dto.Slot.EndUtc, ttl);
            return Results.Ok(new { hold.Token, hold.ExpiresUtc });
        });

        // BOOK
        g.MapPost("/appointments", async (string tenantSlug, [FromBody] BookDto dto, AppDbContext db, BookingService booking, HttpContext http) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var userId = Guid.Parse(http.User.FindFirst("sub")!.Value);

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

            var appt = await booking.BookAsync(t.Id, dto.HoldToken, clientId, guestJson, clientType, dto.Notes, userId);
            return Results.Created($"/api/v1/{tenantSlug}/appointments/{appt.Id}", appt);
        });

        // LIST
        g.MapGet("/appointments", async (string tenantSlug, DateTime fromUtc, DateTime toUtc, Guid? staffId, AppDbContext db, HttpContext http) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);

            // Staff só pode ver a própria agenda
            if (http.User.IsInRole("Staff") && !http.User.IsInRole("Admin") && !http.User.IsInRole("Owner") && !http.User.IsInRole("Receptionist"))
            {
                var myStaffStr = http.User.FindFirst("staff_id")?.Value;
                if (myStaffStr == null) return Results.Forbid();
                var myStaff = Guid.Parse(myStaffStr);
                staffId = myStaff;
            }

            var query = db.Appointments.Where(a => a.TenantId == t.Id && a.StartUtc >= fromUtc && a.EndUtc <= toUtc);
            if (staffId.HasValue) query = query.Where(a => a.StaffId == staffId.Value);
            var list = await query.ToListAsync();
            return Results.Ok(list);
        });

        // RESCHEDULE
        g.MapPatch("/appointments/{id:guid}:reschedule", async (string tenantSlug, Guid id, [FromBody] RescheduleDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.TenantId == t.Id && a.Id == id);
            if (appt == null) return Results.NotFound();

            // regra simples: não reagendar para passado, e verificar conflito
            if (dto.StartUtc >= dto.EndUtc || dto.StartUtc < DateTime.UtcNow) return Results.BadRequest("Horário inválido.");
            bool conflict = await db.Appointments.AnyAsync(a =>
                a.TenantId == t.Id && a.StaffId == appt.StaffId && a.Id != appt.Id && a.Status != AppointmentStatus.Canceled &&
                a.StartUtc < dto.EndUtc && a.EndUtc > dto.StartUtc);
            if (conflict) return Results.Conflict("Conflito de agenda.");

            appt.StartUtc = dto.StartUtc;
            appt.EndUtc = dto.EndUtc;
            appt.Status = AppointmentStatus.Rescheduled;
            appt.UpdatedUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(appt);
        });

        // CANCEL
        g.MapPost("/appointments/{id:guid}:cancel", async (string tenantSlug, Guid id, [FromBody] CancelDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var appt = await db.Appointments.FirstOrDefaultAsync(a => a.TenantId == t.Id && a.Id == id);
            if (appt == null) return Results.NotFound();

            // Janela de cancelamento (horas)
            var cutoff = TimeSpan.FromHours(t.Settings.CancellationWindowHours);
            var now = DateTime.UtcNow;
            var feeApplies = appt.StartUtc - now < cutoff;

            appt.Status = AppointmentStatus.Canceled;
            appt.UpdatedUtc = now;
            await db.SaveChangesAsync();

            return Results.Ok(new { appt.Id, feeMayApply = feeApplies, message = feeApplies ? "Cancelado fora da janela." : "Cancelado." });
        });

        // NOSHOW
        g.MapPost("/appointments/{id:guid}:noshow", async (string tenantSlug, Guid id, AppDbContext db) =>
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

    public record HoldDto(HoldSlot Slot);
    public record HoldSlot(Guid ServiceId, Guid StaffId, DateTime StartUtc, DateTime EndUtc);
    public record BookDto(string HoldToken, Guid? ClientId, GuestDto? Guest, string? Notes);
    public record GuestDto(string FirstName, string LastName, string? Email, string? Phone);
    public record RescheduleDto(DateTime StartUtc, DateTime EndUtc);
    public record CancelDto(string? Reason);
}
