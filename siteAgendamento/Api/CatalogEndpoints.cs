using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Catalog;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class CatalogEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}");
        g.RequireAuthorization();

        // Services
        g.MapGet("/services", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            return Results.Ok(await db.Services.Where(s => s.TenantId == t.Id).ToListAsync());
        });

        g.MapPost("/services", [Authorize(Policy = "ManageTenant")] async (string tenantSlug, [FromBody] ServiceDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var s = new Service
            {
                TenantId = t.Id,
                Name = dto.Name,
                DurationMin = dto.DurationMin,
                BufferBeforeMin = dto.BufferBeforeMin,
                BufferAfterMin = dto.BufferAfterMin,
                Capacity = dto.Capacity,
                PriceCents = dto.PriceCents
            };
            db.Services.Add(s);
            await db.SaveChangesAsync();
            return Results.Created($"/api/v1/{tenantSlug}/services/{s.Id}", s);
        });

        // Resources (CRUD básico)
        g.MapGet("/resources", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            return Results.Ok(await db.Resources.Where(r => r.TenantId == t.Id).ToListAsync());
        });
        g.MapPost("/resources", [Authorize(Policy = "ManageTenant")] async (string tenantSlug, [FromBody] ResourceDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var r = new Resource { TenantId = t.Id, Name = dto.Name, Type = dto.Type ?? "generic", Active = true };
            db.Resources.Add(r);
            await db.SaveChangesAsync();
            return Results.Created($"/api/v1/{tenantSlug}/resources/{r.Id}", r);
        });

        // Business Hours
        g.MapGet("/business-hours", async (string tenantSlug, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            return Results.Ok(await db.BusinessHours.Where(b => b.TenantId == t.Id).ToListAsync());
        });
        g.MapPut("/business-hours", [Authorize(Policy = "ManageTenant")] async (string tenantSlug, [FromBody] List<BusinessHourDto> dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var olds = db.BusinessHours.Where(b => b.TenantId == t.Id);
            db.BusinessHours.RemoveRange(olds);
            foreach (var d in dto)
                db.BusinessHours.Add(new BusinessHours { TenantId = t.Id, DayOfWeek = d.DayOfWeek, StartLocal = TimeSpan.Parse(d.StartLocal), EndLocal = TimeSpan.Parse(d.EndLocal) });
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        // Blocks
        g.MapPost("/blocks", [Authorize(Policy = "ManageAllCalendars")] async (string tenantSlug, [FromBody] BlockDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var block = new Block { TenantId = t.Id, StaffId = dto.StaffId, StartUtc = dto.StartUtc, EndUtc = dto.EndUtc, Reason = dto.Reason ?? "Block" };
            db.Blocks.Add(block);
            await db.SaveChangesAsync();
            return Results.Created($"/api/v1/{tenantSlug}/blocks/{block.Id}", block);
        });
        g.MapDelete("/blocks/{id:guid}", [Authorize(Policy = "ManageAllCalendars")] async (string tenantSlug, Guid id, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var b = await db.Blocks.FirstOrDefaultAsync(x => x.TenantId == t.Id && x.Id == id);
            if (b == null) return Results.NotFound();
            db.Blocks.Remove(b);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    public record ServiceDto(string Name, int DurationMin, int BufferBeforeMin, int BufferAfterMin, int Capacity, int? PriceCents);
    public record ResourceDto(string Name, string? Type);
    public record BusinessHourDto(int DayOfWeek, string StartLocal, string EndLocal);
    public record BlockDto(Guid? StaffId, DateTime StartUtc, DateTime EndUtc, string? Reason);
}
