using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Application.Services;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class AvailabilityEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}/availability").RequireAuthorization();

        g.MapPost("/slots:search", async (string tenantSlug, [FromBody] SearchDto dto,
    AppDbContext db, AvailabilityService availability) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);

            var hasService = await db.Services
                .AnyAsync(s => s.TenantId == t.Id && s.Id == dto.ServiceId);

            if (!hasService)
                return Results.NotFound("Serviço não encontrado para esta empresa.");

            var slots = await availability.FindSlotsAsync(
                t.Id, dto.ServiceId, dto.DateRange.FromUtc, dto.DateRange.ToUtc, dto.StaffIds);

            return Results.Ok(slots);
        });
    }

    public record SearchDto(Guid ServiceId, DateRangeDto DateRange, IEnumerable<Guid>? StaffIds);
    public record DateRangeDto(DateTime FromUtc, DateTime ToUtc);
}
