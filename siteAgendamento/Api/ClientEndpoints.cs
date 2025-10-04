using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Clients;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class ClientEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}/clients").RequireAuthorization();

        g.MapPost("", async (string tenantSlug, [FromBody] ClientCreateDto dto, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(dto.Email) && string.IsNullOrWhiteSpace(dto.Phone))
                return Results.BadRequest("Informe e-mail ou telefone.");

            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);

            var c = new Client
            {
                TenantId = tenant.Id,
                FirstName = dto.FirstName,
                LastName = dto.LastName,
                Email = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email.ToLowerInvariant(),
                PhoneE164 = string.IsNullOrWhiteSpace(dto.Phone) ? null : dto.Phone
            };
            db.Clients.Add(c);
            await db.SaveChangesAsync();
            return Results.Created($"/api/v1/{tenantSlug}/clients/{c.Id}", c);
        });

        g.MapPost(":upsert", async (string tenantSlug, [FromBody] ClientCreateDto dto, AppDbContext db) =>
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            Client? c = null;

            if (!string.IsNullOrWhiteSpace(dto.Email))
            {
                var email = dto.Email.ToLowerInvariant();
                c = await db.Clients.FirstOrDefaultAsync(x => x.TenantId == tenant.Id && x.Email == email);
            }
            if (c == null && !string.IsNullOrWhiteSpace(dto.Phone))
            {
                c = await db.Clients.FirstOrDefaultAsync(x => x.TenantId == tenant.Id && x.PhoneE164 == dto.Phone);
            }

            if (c == null)
            {
                c = new Client
                {
                    TenantId = tenant.Id,
                    FirstName = dto.FirstName,
                    LastName = dto.LastName,
                    Email = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email.ToLowerInvariant(),
                    PhoneE164 = string.IsNullOrWhiteSpace(dto.Phone) ? null : dto.Phone
                };
                db.Clients.Add(c);
            }
            else
            {
                c.FirstName = dto.FirstName;
                c.LastName = dto.LastName;
                if (!string.IsNullOrWhiteSpace(dto.Email)) c.Email = dto.Email.ToLowerInvariant();
                if (!string.IsNullOrWhiteSpace(dto.Phone)) c.PhoneE164 = dto.Phone;
            }

            await db.SaveChangesAsync();
            return Results.Ok(c);
        });

        g.MapGet("{id:guid}/appointments", async (string tenantSlug, Guid id, AppDbContext db) =>
        {
            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            var appts = await db.Appointments.Where(a => a.TenantId == tenant.Id && a.ClientId == id).ToListAsync();
            return Results.Ok(appts);
        });
    }

    public record ClientCreateDto(string FirstName, string LastName, string? Email, string? Phone);
}
