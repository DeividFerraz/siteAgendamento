using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Tenants;
using siteAgendamento.Infrastructure;
using siteAgendamento.Application.Services;
using System.Security.Claims;

namespace siteAgendamento.Api;

public static class TenantEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}").RequireAuthorization();

        // --- Branding ---
        g.MapGet("/branding", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            return t is null ? Results.NotFound() : Results.Ok(t.Branding);
        });

        g.MapPut("/branding", [Authorize(Policy = "AdminMasterOnly")] async (
            string tenantSlug, [FromBody] TenantBrandingDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            if (t is null) return Results.NotFound();

            if (dto.LogoUrl is not null) t.Branding.LogoUrl = dto.LogoUrl;
            if (dto.Primary is not null) t.Branding.Primary = dto.Primary;
            if (dto.Secondary is not null) t.Branding.Secondary = dto.Secondary;
            if (dto.Tertiary is not null) t.Branding.Tertiary = dto.Tertiary;

            await db.SaveChangesAsync();
            return Results.Ok(t.Branding);
        });

        // --- Settings (empresa) ---
        g.MapGet("/settings", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            if (t is null) return Results.NotFound();

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

        g.MapPut("/settings", [Authorize(Policy = "AdminMasterOnly")] async (
            string tenantSlug, [FromBody] TenantSettingsUpdateDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            if (t is null) return Results.NotFound();

            if (dto.SlotGranularityMinutes.HasValue) t.Settings.SlotGranularityMinutes = dto.SlotGranularityMinutes.Value;
            if (dto.AllowAnonymousAppointments.HasValue) t.Settings.AllowAnonymousAppointments = dto.AllowAnonymousAppointments.Value;
            if (dto.CancellationWindowHours.HasValue) t.Settings.CancellationWindowHours = dto.CancellationWindowHours.Value;
            if (!string.IsNullOrWhiteSpace(dto.Timezone)) t.Settings.Timezone = dto.Timezone!;
            if (dto.BusinessDays is not null) t.Settings.BusinessDays = string.Join(",", dto.BusinessDays);
            if (!string.IsNullOrWhiteSpace(dto.OpenTime)) t.Settings.OpenTime = dto.OpenTime!;
            if (!string.IsNullOrWhiteSpace(dto.CloseTime)) t.Settings.CloseTime = dto.CloseTime!;
            if (dto.DefaultAppointmentMinutes.HasValue) t.Settings.DefaultAppointmentMinutes = dto.DefaultAppointmentMinutes.Value;

            await db.SaveChangesAsync();
            return Results.Ok(t.Settings);
        });

        // --- Shape compacto da "empresa" para o front ---
        g.MapGet("/company", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            if (t is null) return Results.NotFound();

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

        // --- Trocar senha do adm master (no escopo do tenant) ---
        g.MapPost("/auth/change-password", [Authorize(Policy = "AdminMasterOnly")] async (
            string tenantSlug, ChangePasswordDto dto, AppDbContext db, PasswordHasherService hasher, ClaimsPrincipal user) =>
        {
            var t = await db.Tenants.FirstOrDefaultAsync(x => x.Slug == tenantSlug);
            if (t is null) return Results.NotFound();

            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var userId)) return Results.Forbid();

            var u = await db.Users.FirstOrDefaultAsync(x => x.Id == userId);
            if (u is null) return Results.NotFound();

            u.PasswordHash = hasher.Hash(dto.NewPassword);
            await db.SaveChangesAsync();

            return Results.NoContent();
        });
    }

    // DTOs (sem duplicação)
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
    public record ChangePasswordDto(string NewPassword);
}
