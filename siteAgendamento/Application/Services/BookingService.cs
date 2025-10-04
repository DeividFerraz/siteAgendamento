using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Appointments;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Application.Services;

public class BookingService
{
    private readonly AppDbContext _db;
    public BookingService(AppDbContext db) => _db = db;

    public async Task<AppointmentHold> CreateHoldAsync(Guid tenantId, Guid serviceId, Guid staffId,
        DateTime startUtc, DateTime endUtc, TimeSpan ttl)
    {
        // Verifica conflitos com agendamentos e holds ativos
        var now = DateTime.UtcNow;
        bool conflict = await _db.Appointments.AnyAsync(a =>
            a.TenantId == tenantId && a.StaffId == staffId && a.Status != AppointmentStatus.Canceled &&
            a.StartUtc < endUtc && a.EndUtc > startUtc);

        if (!conflict)
        {
            conflict = await _db.AppointmentHolds.AnyAsync(h =>
                h.TenantId == tenantId && h.StaffId == staffId && h.ExpiresUtc > now &&
                h.StartUtc < endUtc && h.EndUtc > startUtc);
        }

        if (conflict) throw new InvalidOperationException("Slot indisponível.");

        var hold = new AppointmentHold
        {
            TenantId = tenantId,
            ServiceId = serviceId,
            StaffId = staffId,
            StartUtc = startUtc,
            EndUtc = endUtc,
            Token = Guid.NewGuid().ToString("N"),
            ExpiresUtc = now.Add(ttl)
        };

        _db.AppointmentHolds.Add(hold);
        await _db.SaveChangesAsync();
        return hold;
    }

    public async Task<Appointment> BookAsync(Guid tenantId, string holdToken,
        Guid? clientId, string? guestJson, string clientType, string? notes, Guid createdByUserId)
    {
        var now = DateTime.UtcNow;
        var hold = await _db.AppointmentHolds.FirstOrDefaultAsync(h =>
            h.TenantId == tenantId && h.Token == holdToken && h.ExpiresUtc > now);

        if (hold == null) throw new InvalidOperationException("Hold inválido ou expirado.");

        // Double-check de conflito no momento da gravação
        bool conflict = await _db.Appointments.AnyAsync(a =>
            a.TenantId == tenantId && a.StaffId == hold.StaffId && a.Status != AppointmentStatus.Canceled &&
            a.StartUtc < hold.EndUtc && a.EndUtc > hold.StartUtc);

        if (conflict) throw new InvalidOperationException("Conflito detectado.");

        var appt = new Appointment
        {
            TenantId = tenantId,
            ServiceId = hold.ServiceId,
            StaffId = hold.StaffId,
            StartUtc = hold.StartUtc,
            EndUtc = hold.EndUtc,
            ClientId = clientId,
            ClientType = clientType,
            GuestContactJson = guestJson,
            Status = AppointmentStatus.Confirmed,
            Notes = notes,
            CreatedByUserId = createdByUserId
        };

        _db.Appointments.Add(appt);
        _db.AppointmentHolds.Remove(hold);
        await _db.SaveChangesAsync();
        return appt;
    }
}
