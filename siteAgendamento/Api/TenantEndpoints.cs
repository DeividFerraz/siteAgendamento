using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Tenants;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class TenantEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}");
        g.RequireAuthorization();

        g.MapGet("/branding", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            if (t == null) return Results.NotFound();
            return Results.Ok(t.Branding);
        });

        g.MapPut("/branding", [Authorize(Policy = "ManageTenant")] async (string tenantSlug, [FromBody] TenantBrandingDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            t.Branding.LogoUrl = dto.LogoUrl ?? t.Branding.LogoUrl;
            t.Branding.Primary = dto.Primary ?? t.Branding.Primary;
            t.Branding.Secondary = dto.Secondary ?? t.Branding.Secondary;
            t.Branding.Tertiary = dto.Tertiary ?? t.Branding.Tertiary;
            await db.SaveChangesAsync();
            return Results.Ok(t.Branding);
        });

        g.MapGet("/settings", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            if (t == null) return Results.NotFound();
            return Results.Ok(t.Settings);
        });

        g.MapPut("/settings", [Authorize(Policy = "ManageTenant")] async (string tenantSlug, [FromBody] TenantSettingsUpdateDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            if (dto.SlotGranularityMinutes.HasValue) t.Settings.SlotGranularityMinutes = dto.SlotGranularityMinutes.Value;
            if (dto.AllowAnonymousAppointments.HasValue) t.Settings.AllowAnonymousAppointments = dto.AllowAnonymousAppointments.Value;
            if (dto.CancellationWindowHours.HasValue) t.Settings.CancellationWindowHours = dto.CancellationWindowHours.Value;
            await db.SaveChangesAsync();
            return Results.Ok(t.Settings);
        });
    }

    public record TenantBrandingDto(string? LogoUrl, string? Primary, string? Secondary, string? Tertiary);
    public record TenantSettingsUpdateDto(int? SlotGranularityMinutes, bool? AllowAnonymousAppointments, int? CancellationWindowHours);
}
