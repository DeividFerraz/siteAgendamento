using Microsoft.EntityFrameworkCore;
using siteAgendamento.Infrastructure;
using siteAgendamento.Domain.Catalog;
using siteAgendamento.Domain.Staffing;
using siteAgendamento.Domain.Appointments;

namespace siteAgendamento.Application.Services;

public record Slot(DateTime StartUtc, DateTime EndUtc, Guid StaffId);

public class AvailabilityService
{
    private readonly AppDbContext _db;
    public AvailabilityService(AppDbContext db) => _db = db;

    public async Task<List<Slot>> FindSlotsAsync(Guid tenantId, Guid serviceId, DateTime fromUtc, DateTime toUtc, IEnumerable<Guid>? staffIds = null)
    {
        var service = await _db.Services
        .AsNoTracking()
        .FirstOrDefaultAsync(s => s.Id == serviceId && s.TenantId == tenantId);
        if (service is null)
        {
            return new List<Slot>();
        }
        var staffQuery = _db.Staffs.Where(s => s.TenantId == tenantId && s.Active);
        if (staffIds != null && staffIds.Any()) staffQuery = staffQuery.Where(s => staffIds.Contains(s.Id));
        var staffs = await staffQuery.ToListAsync();

        var appointments = await _db.Appointments
            .Where(a => a.TenantId == tenantId && a.Status != AppointmentStatus.Canceled &&
                        a.StartUtc < toUtc && a.EndUtc > fromUtc)
            .ToListAsync();

        var holds = await _db.AppointmentHolds
            .Where(h => h.TenantId == tenantId && h.ExpiresUtc > DateTime.UtcNow &&
                        h.StartUtc < toUtc && h.EndUtc > fromUtc)
            .ToListAsync();

        var bh = await _db.BusinessHours.Where(b => b.TenantId == tenantId).ToListAsync();
        var availabilities = await _db.StaffAvailabilities.Where(a => a.TenantId == tenantId).ToListAsync();

        var results = new List<Slot>();
        foreach (var st in staffs)
        {
            // para cada dia no range, cria grade por granularidade do tenant
            var settings = (await _db.Tenants.Where(t => t.Id == tenantId).Select(t => t.Settings).FirstAsync());
            var gran = TimeSpan.FromMinutes(settings.SlotGranularityMinutes);
            var cur = fromUtc.Date;
            while (cur <= toUtc.Date)
            {
                var dow = (int)cur.DayOfWeek;
                var bhDay = bh.Where(x => x.DayOfWeek == dow).ToList();
                var staffDay = availabilities.Where(x => x.StaffId == st.Id && x.DayOfWeek == dow).ToList();
                foreach (var win in IntersectWindows(bhDay, staffDay, cur))
                {
                    // aplica duração + buffers do serviço
                    var total = TimeSpan.FromMinutes(service.DurationMin + service.BufferBeforeMin + service.BufferAfterMin);
                    var t = win.start;
                    while (t + total <= win.end)
                    {
                        var sUtc = t + TimeSpan.FromMinutes(service.BufferBeforeMin);
                        var eUtc = sUtc + TimeSpan.FromMinutes(service.DurationMin);
                        // conflito com agendamentos/holds?
                        bool conflict = appointments.Any(a => a.StaffId == st.Id && a.StartUtc < eUtc && a.EndUtc > sUtc)
                                     || holds.Any(h => h.StaffId == st.Id && h.StartUtc < eUtc && h.EndUtc > sUtc);
                        if (!conflict) results.Add(new Slot(sUtc, eUtc, st.Id));
                        t += gran;
                    }
                }
                cur = cur.AddDays(1);
            }
        }
        return results.OrderBy(r => r.StartUtc).ToList();
    }

    private static IEnumerable<(DateTime start, DateTime end)> IntersectWindows(
        IEnumerable<Domain.Catalog.BusinessHours> bh,
        IEnumerable<Domain.Staffing.StaffAvailability> av,
        DateTime dayUtc)
    {
        // Simples: trata StartLocal/EndLocal como UTC (assumimos TZ travado do tenant presencial)
        foreach (var b in bh)
        {
            var bStart = dayUtc.Date + b.StartLocal;
            var bEnd = dayUtc.Date + b.EndLocal;
            foreach (var a in av)
            {
                var aStart = dayUtc.Date + a.StartLocal;
                var aEnd = dayUtc.Date + a.EndLocal;
                var start = bStart > aStart ? bStart : aStart;
                var end = bEnd < aEnd ? bEnd : aEnd;
                if (start < end) yield return (start, end);
            }
        }
    }
}
