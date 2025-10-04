using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Application.Services;
using siteAgendamento.Domain.Identity;
using siteAgendamento.Domain.Staffing;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class StaffEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}");
        g.RequireAuthorization();

        // Criar usuário + staff (Admin/Owner)
        g.MapPost("/staff", [Authorize(Policy = "ManageTenant")] async (
            string tenantSlug,
            [FromBody] CreateStaffDto dto,
            AppDbContext db,
            PasswordHasherService hasher) =>
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);

            var user = new User { Name = dto.User.Name, Email = dto.User.Email, PasswordHash = hasher.Hash(dto.User.TempPassword ?? Guid.NewGuid().ToString("N")) };
            db.Users.Add(user);
            await db.SaveChangesAsync();

            db.UserTenants.Add(new UserTenant { UserId = user.Id, TenantId = tenant.Id, Role = dto.Role ?? "Staff" });
            await db.SaveChangesAsync();

            var staff = new Staff { TenantId = tenant.Id, UserId = user.Id, DisplayName = dto.Staff.DisplayName, Bio = dto.Staff.Bio };
            db.Staffs.Add(staff);
            await db.SaveChangesAsync();

            // Atualiza staff_id no vínculo
            var ut = await db.UserTenants.FirstAsync(x => x.UserId == user.Id && x.TenantId == tenant.Id);
            ut.StaffId = staff.Id;
            await db.SaveChangesAsync();

            return Results.Created(
                $"/api/v1/{tenantSlug}/staff/{staff.Id}",
                new { staffId = staff.Id, userId = user.Id }
            );
        });

        g.MapGet("/staff", [Authorize(Policy = "ManageAllCalendars")] async (string tenantSlug, AppDbContext db) =>
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            var list = await db.Staffs.Where(s => s.TenantId == tenant.Id).ToListAsync();
            return Results.Ok(list);
        });

        g.MapGet("/me/staff", async (string tenantSlug, HttpContext http, AppDbContext db) =>
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            var staffIdStr = http.User.FindFirst("staff_id")?.Value;
            if (staffIdStr == null) return Results.Forbid();

            var staffId = Guid.Parse(staffIdStr);
            var staff = await db.Staffs.FirstOrDefaultAsync(s => s.Id == staffId && s.TenantId == tenant.Id);
            return staff is null ? Results.NotFound() : Results.Ok(staff);
        });

        // Disponibilidade do staff
        g.MapGet("/staff/{staffId:guid}/availability", async (string tenantSlug, Guid staffId, AppDbContext db, HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            var list = await db.StaffAvailabilities.Where(a => a.TenantId == tenant.Id && a.StaffId == staffId).ToListAsync();
            return Results.Ok(list);
        });

        g.MapPost("/staff/{staffId:guid}/availability", async (string tenantSlug, Guid staffId, [FromBody] StaffAvailabilityDto dto,
            AppDbContext db, HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http)) return Results.Forbid();
            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);

            var av = new StaffAvailability
            {
                TenantId = tenant.Id,
                StaffId = staffId,
                DayOfWeek = dto.DayOfWeek,
                StartLocal = TimeSpan.Parse(dto.StartLocal),
                EndLocal = TimeSpan.Parse(dto.EndLocal)
            };
            db.StaffAvailabilities.Add(av);
            await db.SaveChangesAsync();
            return Results.Created($"/api/v1/{tenantSlug}/staff/{staffId}/availability/{av.Id}", av);
        });

        // Minha Agenda (staff)
        g.MapGet("/me/agenda", async (string tenantSlug, DateTime fromUtc, DateTime toUtc, AppDbContext db, HttpContext http) =>
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            var staffIdStr = http.User.FindFirst("staff_id")?.Value;
            if (staffIdStr == null) return Results.Forbid();
            var staffId = Guid.Parse(staffIdStr);

            var appts = await db.Appointments
                .Where(a => a.TenantId == tenant.Id && a.StaffId == staffId && a.StartUtc >= fromUtc && a.EndUtc <= toUtc)
                .ToListAsync();

            return Results.Ok(appts);
        });
    }

    private static bool IsAllCalendarManager(HttpContext http) =>
        http.User.IsInRole("Owner") || http.User.IsInRole("Admin") || http.User.IsInRole("Receptionist");

    private static bool CanAccessStaff(HttpContext http, Guid staffId)
    {
        var myStaff = http.User.FindFirst("staff_id")?.Value;
        return myStaff != null && Guid.Parse(myStaff) == staffId;
    }

    public record CreateStaffDto(UserDto User, StaffDto Staff, string? Role);
    public record UserDto(string Name, string Email, string? TempPassword);
    public record StaffDto(string DisplayName, string? Bio);
    public record StaffAvailabilityDto(int DayOfWeek, string StartLocal, string EndLocal);
}
