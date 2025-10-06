using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Application.Services;
using siteAgendamento.Domain.Identity;
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
        var g = app.MapGroup("/api/v1/{tenantSlug}");
        g.RequireAuthorization();

        // --------------------------------------------------------------------
        // POST /staff  → cria usuário + vínculo Tenant + staff (senha obrigatória)
        // --------------------------------------------------------------------
        g.MapPost("/staff", [Authorize(Policy = "ManageTenant")] async (
            string tenantSlug,
            [FromBody] CreateStaffDto dto,
            AppDbContext db,
            PasswordHasherService hasher) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            if (dto?.User is null) return Results.BadRequest(new { message = "User é obrigatório." });
            if (string.IsNullOrWhiteSpace(dto.User.Name)) return Results.BadRequest(new { message = "Nome é obrigatório." });
            if (string.IsNullOrWhiteSpace(dto.User.Email)) return Results.BadRequest(new { message = "Email é obrigatório." });
            if (string.IsNullOrWhiteSpace(dto.User.Password) || dto.User.Password.Length < 6)
                return Results.BadRequest(new { message = "Senha é obrigatória (mínimo 6 caracteres)." });

            if (dto.Staff is null || string.IsNullOrWhiteSpace(dto.Staff.DisplayName))
                return Results.BadRequest(new { message = "DisplayName do Staff é obrigatório." });

            var emailExists = await db.Users.AnyAsync(u => u.Email == dto.User.Email.Trim());
            if (emailExists) return Results.Conflict(new { message = "Já existe um usuário com esse e-mail." });

            // cria usuário
            var user = new User
            {
                Name = dto.User.Name.Trim(),
                Email = dto.User.Email.Trim(),
                PasswordHash = hasher.Hash(dto.User.Password)
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();

            // vínculo usuário-tenant com Role do vínculo
            var role = string.IsNullOrWhiteSpace(dto.Role) ? "Staff" : dto.Role!.Trim();
            db.UserTenants.Add(new UserTenant { UserId = user.Id, TenantId = tenant.Id, Role = role });
            await db.SaveChangesAsync();

            // cria staff (Role no Staff é só para facilitar filtros no front)
            var staff = new Staff
            {
                TenantId = tenant.Id,
                UserId = user.Id,
                DisplayName = dto.Staff.DisplayName.Trim(),
                Bio = string.IsNullOrWhiteSpace(dto.Staff.Bio) ? null : dto.Staff.Bio.Trim(),
                Active = dto.Staff.Active ?? true,
                Role = string.Equals(role, "Owner", StringComparison.OrdinalIgnoreCase)
                       || string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase)
                       ? "admin" : "staff",
                PhotoUrl = null,
                SettingsOverrideJson = null
            };
            db.Staffs.Add(staff);
            await db.SaveChangesAsync();

            // Atualiza staff_id no vínculo
            var ut = await db.UserTenants.FirstAsync(x => x.UserId == user.Id && x.TenantId == tenant.Id);
            ut.StaffId = staff.Id;
            await db.SaveChangesAsync();

            return Results.Created($"/api/v1/{tenantSlug}/staff/{staff.Id}", new { staffId = staff.Id, userId = user.Id, role });
        });

        // --------------------------------------------------------------------
        // GET /staff?active=true|false
        // --------------------------------------------------------------------
        g.MapGet("/staff", [Authorize(Policy = "ManageAllCalendars")] async (string tenantSlug, bool? active, AppDbContext db) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var q = db.Staffs.AsNoTracking().Where(s => s.TenantId == tenant.Id);
            if (active.HasValue) q = q.Where(s => s.Active == active.Value);

            var list = await q.OrderBy(s => s.DisplayName).ToListAsync();
            return Results.Ok(list);
        });

        // --------------------------------------------------------------------
        // GET /staff/{staffId}
        // --------------------------------------------------------------------
        g.MapGet("/staff/{staffId:guid}", async (string tenantSlug, Guid staffId, HttpContext http, AppDbContext db) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var staff = await db.Staffs.AsNoTracking().FirstOrDefaultAsync(s => s.Id == staffId && s.TenantId == tenant.Id);
            return staff is null ? Results.NotFound() : Results.Ok(staff);
        });

        // --------------------------------------------------------------------
        // PUT /staff/{staffId}
        // --------------------------------------------------------------------
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

        // --------------------------------------------------------------------
        // DELETE /staff/{staffId}
        // --------------------------------------------------------------------
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

        // --------------------------------------------------------------------
        // GET /me/staff
        // --------------------------------------------------------------------
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

        // --------------------------------------------------------------------
        // BRANDING por staff  (foto opcional, "" limpa → herda tenant)
        // GET /staff/{staffId}/branding
        // PUT /staff/{staffId}/branding
        // --------------------------------------------------------------------
        // --------------------------------------------------------------------
        // BRANDING por staff  (foto opcional, "" limpa → herda tenant)
        // GET /staff/{staffId}/branding
        // PUT /staff/{staffId}/branding
        // --------------------------------------------------------------------
        g.MapGet("/staff/{staffId:guid}/branding", async (
            string tenantSlug,
            Guid staffId,
            AppDbContext db,
            HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http))
                return Results.Forbid();

            // carrega tenant + staff (sem db.Brandings)
            var tenant = await db.Tenants
                .AsNoTracking()
                .FirstAsync(t => t.Slug == tenantSlug);

            var staff = await db.Staffs
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.TenantId == tenant.Id && s.Id == staffId);

            if (staff == null) return Results.NotFound();

            // herda logo do tenant se staff.PhotoUrl for null
            var effective = staff.PhotoUrl ?? tenant.Branding?.LogoUrl;

            return Results.Ok(new
            {
                photoUrl = staff.PhotoUrl,
                effectivePhotoUrl = effective
            });
        });

        g.MapPut("/staff/{staffId:guid}/branding", async (
            string tenantSlug,
            Guid staffId,
            [FromBody] PutStaffBrandingDto dto,
            AppDbContext db,
            HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http))
                return Results.Forbid();

            var tenant = await db.Tenants
                .FirstAsync(t => t.Slug == tenantSlug);

            var staff = await db.Staffs
                .FirstOrDefaultAsync(s => s.TenantId == tenant.Id && s.Id == staffId);

            if (staff == null) return Results.NotFound();

            // "" limpa (volta a herdar do tenant), null mantém
            if (dto.PhotoUrl is not null)
                staff.PhotoUrl = string.IsNullOrWhiteSpace(dto.PhotoUrl) ? null : dto.PhotoUrl;

            await db.SaveChangesAsync();
            return Results.NoContent();
        });


        // --------------------------------------------------------------------
        // SETTINGS por staff (overrides) — herda tenant + aplica overrides
        // GET /staff/{staffId}/settings
        // PUT /staff/{staffId}/settings
        // --------------------------------------------------------------------
        g.MapGet("/staff/{staffId:guid}/settings", async (
    string tenantSlug,
    Guid staffId,
    AppDbContext db,
    HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var staff = await db.Staffs.AsNoTracking().FirstOrDefaultAsync(s => s.Id == staffId && s.TenantId == tenant.Id);
            if (staff is null) return Results.NotFound(new { message = "Staff não encontrado." });

            var effective = BuildEffectiveSettings(tenant, staff);
            return Results.Ok(effective);
        });

        g.MapPut("/staff/{staffId:guid}/settings", async (string tenantSlug, Guid staffId, [FromBody] StaffSettingsOverrideDto dto, AppDbContext db, HttpContext http) =>
        {
            // o próprio colaborador pode editar os seus horários; Admin/Owner/Recepção pode editar de todos
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstAsync(t => t.Slug == tenantSlug);
            var staff = await db.Staffs.FirstOrDefaultAsync(s => s.TenantId == tenant.Id && s.Id == staffId);
            if (staff == null) return Results.NotFound();

            var current = ParseOverrides(staff.SettingsOverrideJson) ?? new StaffSettingsOverrideDto();

            // aplica somente os campos permitidos (todos opcionais)
            if (dto.SlotGranularityMinutes.HasValue) current.SlotGranularityMinutes = dto.SlotGranularityMinutes;
            if (dto.DefaultAppointmentMinutes.HasValue) current.DefaultAppointmentMinutes = dto.DefaultAppointmentMinutes;
            if (!string.IsNullOrWhiteSpace(dto.Timezone)) current.Timezone = dto.Timezone;
            if (!string.IsNullOrWhiteSpace(dto.OpenTime)) current.OpenTime = dto.OpenTime;
            if (!string.IsNullOrWhiteSpace(dto.CloseTime)) current.CloseTime = dto.CloseTime;
            if (dto.BusinessDays is not null) current.BusinessDays = dto.BusinessDays;

            // salva (se tudo ficou null, limpa a coluna)
            var json = JsonSerializer.Serialize(current, JsonOpt);
            // ver se todos os campos são null → limpa
            var empty = IsAllNull(current);
            staff.SettingsOverrideJson = empty ? null : json;

            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // --------------------------------------------------------------------
        // Disponibilidade do staff
        // --------------------------------------------------------------------
        g.MapGet("/staff/{staffId:guid}/availability", async (string tenantSlug, Guid staffId, AppDbContext db, HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var list = await db.StaffAvailabilities.AsNoTracking()
                .Where(a => a.TenantId == tenant.Id && a.StaffId == staffId)
                .OrderBy(a => a.DayOfWeek).ThenBy(a => a.StartLocal)
                .ToListAsync();

            return Results.Ok(list);
        });

        g.MapPost("/staff/{staffId:guid}/availability", async (string tenantSlug, Guid staffId, [FromBody] StaffAvailabilityDto dto, AppDbContext db, HttpContext http) =>
        {
            if (!CanAccessStaff(http, staffId) && !IsAllCalendarManager(http)) return Results.Forbid();

            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            if (dto.DayOfWeek < 0 || dto.DayOfWeek > 6) return Results.BadRequest(new { message = "DayOfWeek deve estar entre 0 e 6." });
            if (!TimeSpan.TryParse(dto.StartLocal, out var start)) return Results.BadRequest(new { message = "StartLocal inválido." });
            if (!TimeSpan.TryParse(dto.EndLocal, out var end)) return Results.BadRequest(new { message = "EndLocal inválido." });
            if (end <= start) return Results.BadRequest(new { message = "EndLocal deve ser maior que StartLocal." });

            var av = new StaffAvailability
            {
                TenantId = tenant.Id,
                StaffId = staffId,
                DayOfWeek = dto.DayOfWeek,
                StartLocal = start,
                EndLocal = end
            };
            db.StaffAvailabilities.Add(av);
            await db.SaveChangesAsync();

            return Results.Created($"/api/v1/{tenantSlug}/staff/{staffId}/availability/{av.Id}", av);
        });

        // --------------------------------------------------------------------
        // Minha Agenda (staff logado)
        // --------------------------------------------------------------------
        g.MapGet("/me/agenda", async (string tenantSlug, DateTime fromUtc, DateTime toUtc, AppDbContext db, HttpContext http) =>
        {
            var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null) return Results.NotFound(new { message = "Tenant não encontrado." });

            var staffIdStr = http.User.FindFirst("staff_id")?.Value;
            if (staffIdStr == null) return Results.Forbid();

            var staffId = Guid.Parse(staffIdStr);

            var appts = await db.Appointments.AsNoTracking()
                .Where(a => a.TenantId == tenant.Id && a.StaffId == staffId && a.StartUtc >= fromUtc && a.EndUtc <= toUtc)
                .OrderBy(a => a.StartUtc).ToListAsync();

            return Results.Ok(appts);
        });
    }

    // ===== Helpers de autorização =====
    private static bool IsAllCalendarManager(HttpContext http) =>
        http.User.IsInRole("Owner") || http.User.IsInRole("Admin") || http.User.IsInRole("Receptionist");

    private static bool CanAccessStaff(HttpContext http, Guid staffId)
    {
        var myStaff = http.User.FindFirst("staff_id")?.Value;
        return myStaff != null && Guid.Parse(myStaff) == staffId;
    }

    // ===== Helpers de settings (override) =====
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
        // company base
        var company = tenant.Settings;
        var companyDays = string.IsNullOrWhiteSpace(company.BusinessDays)
            ? new List<string>()
            : company.BusinessDays.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        // staff overrides (parsed)
        var ovr = GetStaffOverrides(staff);

        // merge: staff > company
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
            businessDays,                 // array de strings
            slotGranularityMinutes,
            defaultAppointmentMinutes
        };
    }


    // ===== DTOs =====
    public record CreateStaffDto(UserDto User, NewStaffDto Staff, string? Role);

    public record UserDto(
        [Required, MinLength(2)] string Name,
        [Required, EmailAddress] string Email,
        [Required, MinLength(6)] string Password
    );

    public record NewStaffDto([Required] string DisplayName, string? Bio, bool? Active);

    public record UpdateStaffUserDto(string? Name, string? Email, string? NewPassword);

    public record UpdateStaffDto(string? DisplayName, string? Bio, bool BioSet, bool? Active, UpdateStaffUserDto? User);

    public record StaffAvailabilityDto(int DayOfWeek, string StartLocal, string EndLocal);

    // Branding por staff
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

        public StaffSettingsOverrideDto() { }

        public StaffSettingsOverrideDto(
            string? timezone,
            string? openTime,
            string? closeTime,
            List<string>? businessDays,
            int? slotGranularityMinutes,
            int? defaultAppointmentMinutes)
        {
            Timezone = timezone;
            OpenTime = openTime;
            CloseTime = closeTime;
            BusinessDays = businessDays;
            SlotGranularityMinutes = slotGranularityMinutes;
            DefaultAppointmentMinutes = defaultAppointmentMinutes;
        }
    }

    // Shape de retorno do GET efetivo
    public class EffectiveSettings
    {
        public int SlotGranularityMinutes { get; set; }
        public bool AllowAnonymousAppointments { get; set; }
        public int CancellationWindowHours { get; set; }
        public string? Timezone { get; set; }
        public List<string> BusinessDays { get; set; } = new();
        public string OpenTime { get; set; } = "07:00";
        public string CloseTime { get; set; } = "20:00";
        public int DefaultAppointmentMinutes { get; set; }
    }

    

    private static List<string> NormalizeBusinessDays(object? src)
    {
        var outList = new List<string>();

        if (src is null) return outList;

        // já é lista de string?
        if (src is List<string> ls) return ls.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).ToList();
        if (src is IEnumerable<string> es) return es.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).ToList();

        // array de objetos (dynamic/Array)
        if (src is Array arr)
        {
            foreach (var item in arr)
            {
                if (item is null) continue;
                if (item is int ni) outList.Add(ni.ToString());
                else outList.Add(item.ToString()!.Trim());
            }
            return outList.Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
        }

        // JsonElement (quando desserializa sem tipar)
        if (src is JsonElement je)
        {
            if (je.ValueKind == JsonValueKind.Array)
            {
                foreach (var it in je.EnumerateArray())
                {
                    if (it.ValueKind == JsonValueKind.Number) outList.Add(it.GetInt32().ToString());
                    else if (it.ValueKind == JsonValueKind.String) outList.Add((it.GetString() ?? "").Trim());
                }
                return outList.Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
            }
            if (je.ValueKind == JsonValueKind.String)
            {
                var s = je.GetString() ?? "";
                return s.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
            }
        }

        // string com vírgulas
        var str = src.ToString();
        if (!string.IsNullOrWhiteSpace(str))
        {
            return str.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        }

        return outList;
    }

    private static StaffSettingsOverrideDto GetStaffOverrides(Staff staff)
    {
        if (string.IsNullOrWhiteSpace(staff.SettingsOverrideJson))
            return new StaffSettingsOverrideDto(null, null, null, null, null, null);

        try
        {
            using var doc = JsonDocument.Parse(staff.SettingsOverrideJson);
            var root = doc.RootElement;

            string? tz = root.TryGetProperty("timezone", out var tzEl) ? tzEl.GetString() : null;
            string? open = root.TryGetProperty("openTime", out var oEl) ? oEl.GetString() : null;
            string? close = root.TryGetProperty("closeTime", out var cEl) ? cEl.GetString() : null;

            List<string>? days = null;
            if (root.TryGetProperty("businessDays", out var bdEl))
            {
                days = NormalizeBusinessDays(bdEl);
            }

            int? step = null;
            if (root.TryGetProperty("slotGranularityMinutes", out var sEl) && sEl.ValueKind == JsonValueKind.Number)
                step = sEl.GetInt32();

            int? def = null;
            if (root.TryGetProperty("defaultAppointmentMinutes", out var dEl) && dEl.ValueKind == JsonValueKind.Number)
                def = dEl.GetInt32();

            return new StaffSettingsOverrideDto(tz, open, close, days, step, def);
        }
        catch
        {
            // JSON ruim? Ignora e usa vazio
            return new StaffSettingsOverrideDto(null, null, null, null, null, null);
        }
    }
}
