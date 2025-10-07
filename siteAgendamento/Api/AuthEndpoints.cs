using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Application.Services;
using siteAgendamento.Domain.Catalog;
using siteAgendamento.Domain.Identity;
using siteAgendamento.Domain.Staffing;
using siteAgendamento.Domain.Tenants;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class AuthEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1");

        // Registrar novo tenant + usuário ADM MASTER
        g.MapPost("/auth/register-tenant", async (
            [FromBody] RegisterTenantDto dto,
            AppDbContext db,
            PasswordHasherService hasher,
            JwtTokenService jwt) =>
        {
            if (await db.Tenants.AnyAsync(t => t.Slug == dto.Slug))
                return Results.Conflict("Slug já em uso.");

            var tenant = new Tenant
            {
                Slug = dto.Slug,
                Name = dto.CompanyName,
                Settings = new TenantSettings
                {
                    SlotGranularityMinutes = dto.Settings?.SlotGranularityMinutes ?? 10,
                    AllowAnonymousAppointments = dto.Settings?.AllowAnonymousAppointments ?? false,
                    CancellationWindowHours = dto.Settings?.CancellationWindowHours ?? 24,
                    Timezone = dto.Settings?.Timezone ?? "America/Sao_Paulo",
                    BusinessDays = string.Join(",", dto.Settings?.BusinessDays ?? new[] { "1", "2", "3", "4", "5" }),
                    OpenTime = dto.Settings?.OpenTime ?? "09:00",
                    CloseTime = dto.Settings?.CloseTime ?? "18:00",
                    DefaultAppointmentMinutes = dto.Settings?.DefaultAppointmentMinutes ?? 60
                },
                Branding = new TenantBranding
                {
                    LogoUrl = dto.Branding?.LogoUrl,
                    Primary = dto.Branding?.Primary ?? "#1976D2",
                    Secondary = dto.Branding?.Secondary ?? "#90CAF9",
                    Tertiary = dto.Branding?.Tertiary ?? "#E3F2FD"
                }
            };

            var user = new User
            {
                Name = dto.Admin.Name,
                Email = dto.Admin.Email,
                PasswordHash = hasher.Hash(dto.Admin.Password ?? Guid.NewGuid().ToString("N"))
            };

            db.Users.Add(user);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            // **adm master** por padrão no vínculo ao tenant
            db.UserTenants.Add(new UserTenant { UserId = user.Id, TenantId = tenant.Id, Role = "adm master" });

            // cria staff para o adm master
            var staff = new Staff { TenantId = tenant.Id, UserId = user.Id, DisplayName = dto.Admin.Name, Role = "admin" };
            db.Staffs.Add(staff);
            await db.SaveChangesAsync();

            var ut = await db.UserTenants.FirstAsync(x => x.UserId == user.Id && x.TenantId == tenant.Id);
            ut.StaffId = staff.Id;
            await db.SaveChangesAsync();

            // serviço padrão
            var defaultService = new Service
            {
                TenantId = tenant.Id,
                Name = "Serviço padrão",
                DurationMin = tenant.Settings.DefaultAppointmentMinutes,
                BufferBeforeMin = 0,
                BufferAfterMin = 0,
                Capacity = 1,
                PriceCents = 0
            };
            db.Services.Add(defaultService);
            await db.SaveChangesAsync();

            var token = jwt.CreateToken(user.Id, user.Email, tenant.Id, "adm master", staff.Id);
            return Results.Ok(new { access_token = token, role = "adm master", staff_id = staff.Id, tenantId = tenant.Id, tenantSlug = tenant.Slug });
        });

        // Login por tenant
        g.MapPost("/{tenantSlug}/auth/login", async (
            string tenantSlug, [FromBody] LoginDto dto,
            AppDbContext db, PasswordHasherService hasher, JwtTokenService jwt) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug && t.Active);
            if (tenant == null) return Results.NotFound("Empresa não encontrada.");

            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == dto.Email && u.Active);
            if (user == null || !hasher.Verify(dto.Password, user.PasswordHash))
                return Results.Unauthorized();

            var ut = await db.UserTenants.FirstOrDefaultAsync(x => x.UserId == user.Id && x.TenantId == tenant.Id);
            if (ut == null) return Results.Unauthorized();

            var token = jwt.CreateToken(user.Id, user.Email, tenant.Id, ut.Role, ut.StaffId);
            return Results.Ok(new { access_token = token, role = ut.Role, staff_id = ut.StaffId, tenant_id = tenant.Id });
        });

        // Login global
        g.MapPost("/auth/login", async ([FromBody] GlobalLoginDto dto, AppDbContext db, PasswordHasherService hasher, JwtTokenService jwt) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == dto.Tenant || t.Name == dto.Tenant);
            if (tenant == null) return Results.NotFound("Empresa não encontrada.");

            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == dto.Email && u.Active);
            if (user == null || !hasher.Verify(dto.Password, user.PasswordHash))
                return Results.Unauthorized();

            var ut = await db.UserTenants.FirstOrDefaultAsync(x => x.UserId == user.Id && x.TenantId == tenant.Id);
            if (ut == null) return Results.Unauthorized();

            var token = jwt.CreateToken(user.Id, user.Email, tenant.Id, ut.Role, ut.StaffId);
            return Results.Ok(new { access_token = token, role = ut.Role, staff_id = ut.StaffId, tenant_id = tenant.Id });
        });

        g.MapGet("/me", async (AppDbContext db, HttpContext http) =>
        {
            var sub = http.User.FindFirst("sub")?.Value;
            var tenantIdStr = http.User.FindFirst("tenant_id")?.Value;
            if (sub is null || tenantIdStr is null) return Results.Unauthorized();

            var userId = Guid.Parse(sub);
            var tenantId = Guid.Parse(tenantIdStr);

            var user = await db.Users.FindAsync(userId);
            var ut = await db.UserTenants.FirstOrDefaultAsync(x => x.UserId == userId && x.TenantId == tenantId);
            if (user is null || ut is null) return Results.Unauthorized();

            return Results.Ok(new
            {
                user = new { user.Id, user.Name, user.Email },
                tenantId,
                role = ut.Role,
                staff_id = ut.StaffId
            });
        })
        .RequireAuthorization()
        .WithName("GetMe")
        .WithDisplayName("Get current user")
        .WithSummary("Devolve dados do usuário e vínculo no tenant")
        .WithDescription("Retorna usuário, tenantId, role e staff_id");
    }

    // DTOs
    public record RegisterTenantDto(string Slug, string CompanyName, AdminDto Admin, BrandingDto? Branding, SettingsDto? Settings);
    public record AdminDto(string Name, string Email, string? Password);
    public record BrandingDto(string? LogoUrl, string? Primary, string? Secondary, string? Tertiary);
    public record SettingsDto(int? SlotGranularityMinutes, bool? AllowAnonymousAppointments, int? CancellationWindowHours, string? Timezone, string[]? BusinessDays, string? OpenTime, string? CloseTime, int? DefaultAppointmentMinutes);
    public record LoginDto(string Email, string Password);
    public record GlobalLoginDto(string Tenant, string Email, string Password);
}
