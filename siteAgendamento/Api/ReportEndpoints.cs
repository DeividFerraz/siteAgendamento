using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Appointments;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class ReportEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}/reports").RequireAuthorization();

        g.MapGet("/appointments", async (string tenantSlug, DateTime fromUtc, DateTime toUtc, AppointmentStatus? status, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var q = db.Appointments.Where(a => a.TenantId == t.Id && a.StartUtc >= fromUtc && a.EndUtc <= toUtc);
            if (status.HasValue) q = q.Where(a => a.Status == status.Value);
            var data = await q.ToListAsync();
            return Results.Ok(new { count = data.Count, items = data });
        });

        g.MapGet("/utilization", async (string tenantSlug, Guid? staffId, DateTime fromUtc, DateTime toUtc, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var q = db.Appointments.Where(a => a.TenantId == t.Id && a.StartUtc >= fromUtc && a.EndUtc <= toUtc && a.Status != AppointmentStatus.Canceled);
            if (staffId.HasValue) q = q.Where(a => a.StaffId == staffId.Value);
            var totalMin = await q.SumAsync(a => EF.Functions.DateDiffMinute(a.StartUtc, a.EndUtc));
            return Results.Ok(new { totalMinutes = totalMin });
        });
    }
}
