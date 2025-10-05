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

            // Se seu type for a própria entidade, você pode devolver um shape anônimo tratado:
            return Results.Ok(new
            {
                t.Settings.SlotGranularityMinutes,
                t.Settings.AllowAnonymousAppointments,
                t.Settings.CancellationWindowHours,
                t.Settings.Timezone,
                BusinessDays = string.IsNullOrWhiteSpace(t.Settings.BusinessDays)
                    ? Array.Empty<string>()
                    : t.Settings.BusinessDays.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                t.Settings.OpenTime,
                t.Settings.CloseTime,
                t.Settings.DefaultAppointmentMinutes
            });
        });

        g.MapPut("/settings", [Authorize(Policy = "ManageTenant")] async (string tenantSlug,
        [FromBody] TenantSettingsUpdateDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);

            if (dto.SlotGranularityMinutes.HasValue) t.Settings.SlotGranularityMinutes = dto.SlotGranularityMinutes.Value;
            if (dto.AllowAnonymousAppointments.HasValue) t.Settings.AllowAnonymousAppointments = dto.AllowAnonymousAppointments.Value;
            if (dto.CancellationWindowHours.HasValue) t.Settings.CancellationWindowHours = dto.CancellationWindowHours.Value;

            if (!string.IsNullOrWhiteSpace(dto.Timezone)) t.Settings.Timezone = dto.Timezone;
            if (dto.BusinessDays is not null) t.Settings.BusinessDays = string.Join(",", dto.BusinessDays);
            if (!string.IsNullOrWhiteSpace(dto.OpenTime)) t.Settings.OpenTime = dto.OpenTime;
            if (!string.IsNullOrWhiteSpace(dto.CloseTime)) t.Settings.CloseTime = dto.CloseTime;
            if (dto.DefaultAppointmentMinutes.HasValue) t.Settings.DefaultAppointmentMinutes = dto.DefaultAppointmentMinutes.Value;

            await db.SaveChangesAsync();
            return Results.Ok(t.Settings);
        });

        g.MapGet("/company", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            if (t == null) return Results.NotFound();

            // normaliza businessDays para array
            var days = (t.Settings.BusinessDays ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries);

            return Results.Ok(new
            {
                companyName = t.Name,
                slug = t.Slug,
                timezone = t.Settings.Timezone,
                businessDays = days.Select(d => int.TryParse(d, out var n) ? n : -1).Where(n => n >= 0).ToArray(),
                openTime = t.Settings.OpenTime,
                closeTime = t.Settings.CloseTime,
                slotGranularityMinutes = t.Settings.SlotGranularityMinutes,
                defaultAppointmentMinutes = t.Settings.DefaultAppointmentMinutes,
                branding = new
                {
                    t.Branding.LogoUrl,
                    primaryColor = t.Branding.Primary,
                    secondaryColor = t.Branding.Secondary,
                    tertiaryColor = t.Branding.Tertiary
                }
            });
        });

    }

    public record TenantBrandingDto(string? LogoUrl, string? Primary, string? Secondary, string? Tertiary);
    public record TenantSettingsUpdateDto(
    int? SlotGranularityMinutes,
    bool? AllowAnonymousAppointments,
    int? CancellationWindowHours,
    string? Timezone,
    List<string>? BusinessDays,
    string? OpenTime,
    string? CloseTime,
    int? DefaultAppointmentMinutes
);

}
