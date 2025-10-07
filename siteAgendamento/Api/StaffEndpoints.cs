using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Application.Services;
using siteAgendamento.Domain.Staffing;
using siteAgendamento.Domain.Tenants;
using siteAgendamento.Infrastructure;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace siteAgendamento.Api;

public static class StaffEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}").RequireAuthorization();

        // CRIAR STAFF (apenas adm master)
        g.MapPost("/staff", [Authorize(Policy = "ManageTenant")] async (
            string tenantSlug, [FromBody] CreateStaffDto dto, AppDbContext db, PasswordHasherService hasher) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            if (dto?.User is null || string.IsNullOrWhiteSpace(dto.User.Name) ||
                string.IsNullOrWhiteSpace(dto.User.Email) || string.IsNullOrWhiteSpace(dto.User.Password))
                return Results.BadRequest(new { message = "Dados do usuário inválidos." });

            if (dto.Staff is null || string.IsNullOrWhiteSpace(dto.Staff.DisplayName))
                return Results.BadRequest(new { message = "DisplayName do Staff é obrigatório." });

            if (await db.Users.AnyAsync(u => u.Email == dto.User.Email.Trim()))
                return Results.Conflict(new { message = "Já existe um usuário com esse e-mail." });

            var user = new Domain.Identity.User
            {
                Name = dto.User.Name.Trim(),
                Email = dto.User.Email.Trim(),
                PasswordHash = hasher.Hash(dto.User.Password)
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();

            var role = string.IsNullOrWhiteSpace(dto.Role) ? "staff" : dto.Role!.Trim().ToLowerInvariant(); // "admin" | "staff"
            db.UserTenants.Add(new Domain.Identity.UserTenant { UserId = user.Id, TenantId = tenant.Id, Role = role });
            await db.SaveChangesAsync();

            var staff = new Staff
            {
                TenantId = tenant.Id,
                UserId = user.Id,
                DisplayName = dto.Staff.DisplayName.Trim(),
                Bio = string.IsNullOrWhiteSpace(dto.Staff.Bio) ? null : dto.Staff.Bio.Trim(),
                Active = dto.Staff.Active ?? true,
                Role = role == "admin" ? "admin" : "staff"
            };
            db.Staffs.Add(staff);
            await db.SaveChangesAsync();

            var ut = await db.UserTenants.FirstAsync(x => x.UserId == user.Id && x.TenantId == tenant.Id);
            ut.StaffId = staff.Id;
            await db.SaveChangesAsync();

            return Results.Created($"/api/v1/{tenantSlug}/staff/{staff.Id}", new { staffId = staff.Id, userId = user.Id, role });
        });

        // LISTAR STAFF (adm master + admin)
        g.MapGet("/staff", [Authorize(Policy = "ManageAllCalendars")] async (string tenantSlug, bool? active, AppDbContext db) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var q = db.Staffs.AsNoTracking().Where(s => s.TenantId == tenant.Id);
            if (active.HasValue) q = q.Where(s => s.Active == active.Value);

            var list = await q.OrderBy(s => s.DisplayName).ToListAsync();
            return Results.Ok(list);
        });

        // DETALHE DO STAFF (o próprio ou manager)
        g.MapGet("/staff/{staffId:guid}", async (string tenantSlug, Guid staffId, HttpContext http, AppDbContext db) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var staff = await db.Staffs.AsNoTracking().FirstOrDefaultAsync(s => s.Id == staffId && s.TenantId == tenant.Id);
            return staff is null ? Results.NotFound() : Results.Ok(staff);
        });

        // ATUALIZAR STAFF (apenas adm master)
        g.MapPut("/staff/{staffId:guid}", [Authorize(Policy = "ManageTenant")] async (
            string tenantSlug, Guid staffId, [FromBody] UpdateStaffDto dto, AppDbContext db, PasswordHasherService hasher) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var staff = await db.Staffs.FirstOrDefaultAsync(s => s.Id == staffId && s.TenantId == tenant.Id);
            if (staff is null) return Results.NotFound(new { message = "Staff não encontrado." });

            if (!string.IsNullOrWhiteSpace(dto.DisplayName)) staff.DisplayName = dto.DisplayName.Trim();
            if (dto.BioSet) staff.Bio = string.IsNullOrWhiteSpace(dto.Bio) ? null : dto.Bio!.Trim();
            if (dto.Active.HasValue) staff.Active = dto.Active.Value;

            if (dto.User is not null)
            {
                var user = await db.Users.FirstAsync(u => u.Id == staff.UserId);
                if (!string.IsNullOrWhiteSpace(dto.User.Name)) user.Name = dto.User.Name.Trim();
                if (!string.IsNullOrWhiteSpace(dto.User.Email) && dto.User.Email.Trim() != user.Email)
                {
                    var exists = await db.Users.AnyAsync(u => u.Email == dto.User.Email.Trim() && u.Id != user.Id);
                    if (exists) return Results.Conflict(new { message = "Já existe um usuário com esse e-mail." });
                    user.Email = dto.User.Email.Trim();
                }
                if (!string.IsNullOrWhiteSpace(dto.User.NewPassword))
                {
                    if (dto.User.NewPassword!.Length < 6) return Results.BadRequest(new { message = "Nova senha deve ter ao menos 6 caracteres." });
                    user.PasswordHash = hasher.Hash(dto.User.NewPassword);
                }
            }

            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // REMOVER STAFF (apenas adm master)
        g.MapDelete("/staff/{staffId:guid}", [Authorize(Policy = "ManageTenant")] async (string tenantSlug, Guid staffId, AppDbContext db) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var staff = await db.Staffs.FirstOrDefaultAsync(s => s.Id == staffId && s.TenantId == tenant.Id);
            if (staff is null) return Results.NotFound(new { message = "Staff não encontrado." });

            db.Staffs.Remove(staff);
            var uts = await db.UserTenants.Where(ut => ut.StaffId == staff.Id && ut.TenantId == tenant.Id).ToListAsync();
            db.UserTenants.RemoveRange(uts);

            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // MEU STAFF
        g.MapGet("/me/staff", async (string tenantSlug, HttpContext http, AppDbContext db) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var staffIdStr = http.User.FindFirst("staff_id")?.Value;
            if (staffIdStr == null) return Results.Forbid();

            var staffId = Guid.Parse(staffIdStr);
            var staff = await db.Staffs.AsNoTracking().FirstOrDefaultAsync(s => s.Id == staffId && s.TenantId == tenant.Id);
            return staff is null ? Results.NotFound() : Results.Ok(staff);
        });

        // BRANDING do staff (foto) — próprio ou manager
        g.MapGet("/staff/{staffId:guid}/branding", async (string tenantSlug, Guid staffId, AppDbContext db, HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.AsNoTracking().FirstAsync(t => t.Slug == tenantSlug);
            var staff = await db.Staffs.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenant.Id && s.Id == staffId);
            if (staff == null) return Results.NotFound();

            var effective = staff.PhotoUrl ?? tenant.Branding?.LogoUrl;
            return Results.Ok(new { photoUrl = staff.PhotoUrl, effectivePhotoUrl = effective });
        });

        g.MapPut("/staff/{staffId:guid}/branding", async (
            string tenantSlug, Guid staffId, [FromBody] PutStaffBrandingDto dto, AppDbContext db, HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            var staff = await db.Staffs.FirstOrDefaultAsync(s => s.TenantId == tenant.Id && s.Id == staffId);
            if (staff == null) return Results.NotFound();

            if (dto.PhotoUrl is not null)
                staff.PhotoUrl = string.IsNullOrWhiteSpace(dto.PhotoUrl) ? null : dto.PhotoUrl;

            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // SETTINGS override do staff — próprio ou manager
        g.MapGet("/staff/{staffId:guid}/settings", async (string tenantSlug, Guid staffId, AppDbContext db, HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var staff = await db.Staffs.AsNoTracking().FirstOrDefaultAsync(s => s.Id == staffId && s.TenantId == tenant.Id);
            if (staff is null) return Results.NotFound(new { message = "Staff não encontrado." });

            var effective = BuildEffectiveSettings(tenant, staff);
            return Results.Ok(effective);
        });

        g.MapPut("/staff/{staffId:guid}/settings", async (string tenantSlug, Guid staffId, [FromBody] StaffSettingsOverrideDto dto, AppDbContext db, HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            var staff = await db.Staffs.FirstOrDefaultAsync(s => s.TenantId == tenant.Id && s.Id == staffId);
            if (staff == null) return Results.NotFound();

            var current = ParseOverrides(staff.SettingsOverrideJson) ?? new StaffSettingsOverrideDto();

            if (dto.SlotGranularityMinutes.HasValue) current.SlotGranularityMinutes = dto.SlotGranularityMinutes;
            if (dto.DefaultAppointmentMinutes.HasValue) current.DefaultAppointmentMinutes = dto.DefaultAppointmentMinutes;
            if (!string.IsNullOrWhiteSpace(dto.Timezone)) current.Timezone = dto.Timezone;
            if (!string.IsNullOrWhiteSpace(dto.OpenTime)) current.OpenTime = dto.OpenTime;
            if (!string.IsNullOrWhiteSpace(dto.CloseTime)) current.CloseTime = dto.CloseTime;
            if (dto.BusinessDays is not null) current.BusinessDays = dto.BusinessDays;

            var json = JsonSerializer.Serialize(current, JsonOpt);
            var empty = IsAllNull(current);
            staff.SettingsOverrideJson = empty ? null : json;

            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ==== helpers ====
        static bool IsCalendarManager(HttpContext http) =>
            http.User.IsInRole("adm master") || http.User.IsInRole("admin");

        static bool CanAccessStaff(HttpContext http, Guid staffId)
        {
            var myStaff = http.User.FindFirst("staff_id")?.Value;
            return myStaff != null && Guid.Parse(myStaff) == staffId;
        }
    }

    // ===== DTOs =====
    public record CreateStaffDto(UserDto User, NewStaffDto Staff, string? Role);
    public record UserDto([Required] string Name, [Required] string Email, [Required] string Password);
    public record NewStaffDto([Required] string DisplayName, string? Bio, bool? Active);
    public record UpdateStaffUserDto(string? Name, string? Email, string? NewPassword);
    public record UpdateStaffDto(string? DisplayName, string? Bio, bool BioSet, bool? Active, UpdateStaffUserDto? User);
    public record PutStaffBrandingDto(string? PhotoUrl);

    // Overrides permitidos ao staff
    public class StaffSettingsOverrideDto
    {
        public int? SlotGranularityMinutes { get; set; }
        public int? DefaultAppointmentMinutes { get; set; }
        public string? Timezone { get; set; }
        public List<string>? BusinessDays { get; set; }
        public string? OpenTime { get; set; }
        public string? CloseTime { get; set; }
    }

    private static readonly JsonSerializerOptions JsonOpt = new(JsonSerializerDefaults.Web) { WriteIndented = false };

    public static StaffSettingsOverrideDto? ParseOverrides(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<StaffSettingsOverrideDto>(json, JsonOpt); }
        catch { return null; }
    }

    private static bool IsAllNull(StaffSettingsOverrideDto o) =>
        o.Timezone == null && o.BusinessDays == null && o.OpenTime == null && o.CloseTime == null
        && o.SlotGranularityMinutes == null && o.DefaultAppointmentMinutes == null;

    private static object BuildEffectiveSettings(Tenant tenant, Staff staff)
    {
        var company = tenant.Settings;
        var companyDays = string.IsNullOrWhiteSpace(company.BusinessDays)
            ? new List<string>()
            : company.BusinessDays.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        var ovr = ParseOverrides(staff.SettingsOverrideJson ?? "") ?? new StaffSettingsOverrideDto();

        var timezone = ovr.Timezone ?? company.Timezone;
        var openTime = ovr.OpenTime ?? company.OpenTime;
        var closeTime = ovr.CloseTime ?? company.CloseTime;
        var businessDays = (ovr.BusinessDays != null && ovr.BusinessDays.Count > 0) ? ovr.BusinessDays : companyDays;
        var slotGranularityMinutes = ovr.SlotGranularityMinutes ?? company.SlotGranularityMinutes;
        var defaultAppointmentMinutes = ovr.DefaultAppointmentMinutes ?? company.DefaultAppointmentMinutes;

        return new
        {
            timezone,
            openTime,
            closeTime,
            businessDays,
            slotGranularityMinutes,
            defaultAppointmentMinutes
        };
    }
}
