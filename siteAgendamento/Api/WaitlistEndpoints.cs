using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Waitlist;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class WaitlistEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}/waitlist").RequireAuthorization();

        g.MapPost("", async (string tenantSlug, [FromBody] CreateDto dto, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var e = new WaitlistEntry { TenantId = t.Id, ClientId = dto.ClientId, ServiceId = dto.ServiceId, PriorityMode = dto.PriorityMode ?? "FIFO", PreferencesJson = dto.PreferencesJson };
            db.Waitlist.Add(e);
            await db.SaveChangesAsync();
            return Results.Created($"/api/v1/{tenantSlug}/waitlist/{e.Id}", e);
        });

        // promoção manual simples (notificação/auto-book pode ser feito depois)
        g.MapPost("{id:guid}:promote", async (string tenantSlug, Guid id, AppDbContext db) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);
            var e = await db.Waitlist.FirstOrDefaultAsync(w => w.TenantId == t.Id && w.Id == id);
            if (e == null) return Results.NotFound();
            e.Status = "Offered";
            await db.SaveChangesAsync();
            return Results.Ok(e);
        });
    }

    public record CreateDto(Guid ClientId, Guid ServiceId, string? PriorityMode, string? PreferencesJson);
}
