using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using siteAgendamento.Application.Services;
using siteAgendamento.Domain.Appointments;
using siteAgendamento.Domain.Staffing;
using siteAgendamento.Infrastructure;

namespace siteAgendamento.Api;

public static class AvailabilityEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/{tenantSlug}/availability").RequireAuthorization();

        // --------------------------------------------------------------------
        // MANTIDO: busca de slots (funcionava no seu projeto)
        // --------------------------------------------------------------------
        g.MapPost("/slots:search", async (
            string tenantSlug,
            [FromBody] SearchDto dto,
            AppDbContext db,
            AvailabilityService availability) =>
        {
            var t = await db.Tenants.FirstAsync(x => x.Slug == tenantSlug);

            var hasService = await db.Services
                .AnyAsync(s => s.TenantId == t.Id && s.Id == dto.ServiceId);

            if (!hasService)
                return Results.NotFound("Serviço não encontrado para esta empresa.");

            var slots = await availability.FindSlotsAsync(
                t.Id, dto.ServiceId, dto.DateRange.FromUtc, dto.DateRange.ToUtc, dto.StaffIds);

            return Results.Ok(slots);
        });

        // --------------------------------------------------------------------
        // NOVO: disponibilidade agregada do DIA do staff
        // GET /api/v1/{tenantSlug}/availability/day?staffId=GUID&date=YYYY-MM-DD
        // --------------------------------------------------------------------
        g.MapGet("/day", async (
            [FromRoute] string tenantSlug,
            [FromQuery] Guid staffId,
            [FromQuery] string? date,
            AppDbContext db) =>
        {
            // tenant
            var tenant = await db.Tenants.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Slug == tenantSlug);
            if (tenant is null)
                return Results.NotFound(new { message = "Tenant não encontrado." });

            // staff
            var staff = await db.Staffs.AsNoTracking()
                .FirstOrDefaultAsync(s => s.TenantId == tenant.Id && s.Id == staffId);
            if (staff is null)
                return Results.NotFound(new { message = "Staff não encontrado." });

            // dia alvo (UTC midnight)
            DateTime dayUtc = DateTime.UtcNow.Date;
            if (TryParseDate(date, out var dto))
                dayUtc = dto.UtcDateTime.Date;

            // settings efetivos (tenant + override do staff)
            var eff = BuildEffectiveSettings(tenant, staff);

            // se o dia não estiver nos businessDays ou staff inativo → offline
            var dow = (int)dayUtc.DayOfWeek; // 0..6 (Dom..Sáb)
            var online = staff.Active && eff.BusinessDays.Contains(dow);
            if (!online)
            {
                return Results.Ok(new
                {
                    userOnline = false,
                    free = Array.Empty<string[]>(),
                    stepMinutes = eff.SlotGranularityMinutes,
                    defaultAppointmentMinutes = eff.DefaultAppointmentMinutes
                });
            }

            // janela base da empresa para o dia (open/close)
            var open = ParseHm(eff.OpenTime);
            var close = ParseHm(eff.CloseTime);
            if (close <= open) close = open.Add(TimeSpan.FromHours(12)); // guarda

            var baseStart = dayUtc + open;
            var baseEnd = dayUtc + close;

            // availability do staff para esse dia
            var avDay = await db.StaffAvailabilities.AsNoTracking()
                .Where(a => a.TenantId == tenant.Id && a.StaffId == staffId && a.DayOfWeek == dow)
                .OrderBy(a => a.StartLocal)
                .ToListAsync();

            // interseção availability x empresa
            var windows = new List<(DateTime s, DateTime e)>();
            if (avDay.Count == 0)
            {
                windows.Add((baseStart, baseEnd));
            }
            else
            {
                foreach (var a in avDay)
                {
                    var s = dayUtc + a.StartLocal;
                    var e = dayUtc + a.EndLocal;
                    var isecS = s > baseStart ? s : baseStart;
                    var isecE = e < baseEnd ? e : baseEnd;
                    if (isecE > isecS) windows.Add((isecS, isecE));
                }
            }

            // ocupados (agendamentos e holds válidos)
            var dayEndUtc = dayUtc.AddDays(1);
            var busy = await db.Appointments.AsNoTracking()
                .Where(ap => ap.TenantId == tenant.Id
                             && ap.StaffId == staffId
                             && ap.Status != AppointmentStatus.Canceled
                             && ap.StartUtc < dayEndUtc
                             && ap.EndUtc > dayUtc)
                .Select(ap => new { ap.StartUtc, ap.EndUtc })
                .ToListAsync();

            var holds = await db.AppointmentHolds.AsNoTracking()
                .Where(h => h.TenantId == tenant.Id
                            && h.StaffId == staffId
                            && h.ExpiresUtc > DateTime.UtcNow
                            && h.StartUtc < dayEndUtc
                            && h.EndUtc > dayUtc)
                .Select(h => new { h.StartUtc, h.EndUtc })
                .ToListAsync();

            // corta janelas livres removendo ocupações
            var freeRanges = new List<(DateTime s, DateTime e)>();
            foreach (var w in windows)
            {
                var segs = new List<(DateTime s, DateTime e)> { w };

                static void Cut(List<(DateTime s, DateTime e)> list, DateTime bs, DateTime be)
                {
                    for (int i = 0; i < list.Count; i++)
                    {
                        var seg = list[i];
                        if (seg.e <= bs || seg.s >= be) continue;

                        var left = (seg.s, bs);
                        var right = (be, seg.e);

                        list.RemoveAt(i);
                        if (left.Item2 > left.Item1) { list.Insert(i, left); i++; }
                        if (right.Item2 > right.Item1) { list.Insert(i, right); }
                        i--;
                    }
                }

                foreach (var b in busy) Cut(segs, b.StartUtc, b.EndUtc);
                foreach (var h in holds) Cut(segs, h.StartUtc, h.EndUtc);

                foreach (var s in segs)
                    if (s.e > s.s) freeRanges.Add(s);
            }

            var free = freeRanges
                .OrderBy(x => x.s)
                .Select(x => new[] { x.s.ToString("o"), x.e.ToString("o") })
                .ToArray();

            return Results.Ok(new
            {
                userOnline = true,
                free,
                stepMinutes = eff.SlotGranularityMinutes,
                defaultAppointmentMinutes = eff.DefaultAppointmentMinutes
            });
        });
    }

    // ===================== DTOs mantidos =====================
    public record SearchDto(Guid ServiceId, DateRangeDto DateRange, IEnumerable<Guid>? StaffIds);
    public record DateRangeDto(DateTime FromUtc, DateTime ToUtc);

    // ===================== Helpers =====================
    static bool TryParseDate(string? s, out DateTimeOffset dto)
    {
        dto = default;
        if (string.IsNullOrWhiteSpace(s)) return false;

        var fmts = new[]
        {
            "yyyy-MM-dd",
            "yyyy-MM-dd HH:mm",
            "yyyy-MM-ddTHH:mm:ss",
            "yyyy-MM-ddTHH:mm:ssK",
            "o",
            "dd/MM/yyyy",
            "dd/MM/yyyy HH:mm",
            "dd/MM/yyyy HH:mm:ss"
        };

        return DateTimeOffset.TryParseExact(
            s.Trim(),
            fmts,
            CultureInfo.GetCultureInfo("pt-BR"),
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out dto);
    }

    static TimeSpan ParseHm(string hm)
    {
        if (TimeSpan.TryParse(hm, out var ts)) return ts;
        return new TimeSpan(7, 0, 0); // fallback
    }

    // efetivo = Tenant.Settings (+ overrides via Staff.SettingsOverrideJson)
    static Effective BuildEffectiveSettings(
        siteAgendamento.Domain.Tenants.Tenant tenant,
        Staff staff)
    {
        var ts = tenant.Settings;

        string timezone = ts.Timezone ?? tenant.Timezone ?? "America/Sao_Paulo";
        int step = ts.SlotGranularityMinutes;
        int def = ts.DefaultAppointmentMinutes;
        string open = ts.OpenTime ?? "07:00";
        string close = ts.CloseTime ?? "19:00";
        var days = ParseDaysCsv(ts.BusinessDays);

        if (!string.IsNullOrWhiteSpace(staff.SettingsOverrideJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(staff.SettingsOverrideJson);
                var root = doc.RootElement;

                if (root.TryGetProperty("timezone", out var tzEl) && tzEl.ValueKind == JsonValueKind.String)
                    timezone = tzEl.GetString() ?? timezone;

                if (root.TryGetProperty("openTime", out var oEl) && oEl.ValueKind == JsonValueKind.String)
                    open = oEl.GetString() ?? open;

                if (root.TryGetProperty("closeTime", out var cEl) && cEl.ValueKind == JsonValueKind.String)
                    close = cEl.GetString() ?? close;

                if (root.TryGetProperty("slotGranularityMinutes", out var sEl) && sEl.ValueKind == JsonValueKind.Number)
                    step = sEl.GetInt32();

                if (root.TryGetProperty("defaultAppointmentMinutes", out var dEl) && dEl.ValueKind == JsonValueKind.Number)
                    def = dEl.GetInt32();

                if (root.TryGetProperty("businessDays", out var bdEl))
                    days = ParseBusinessDaysElement(bdEl);
            }
            catch { /* JSON ruim → ignora overrides */ }
        }

        return new Effective(timezone, step, def, open, close, days);
    }

    static HashSet<int> ParseDaysCsv(string? csv)
    {
        var set = new HashSet<int>();
        if (string.IsNullOrWhiteSpace(csv)) return set;

        foreach (var s in csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            if (int.TryParse(s, out var n) && n is >= 0 and <= 6) set.Add(n);

        return set;
    }

    static HashSet<int> ParseBusinessDaysElement(JsonElement el)
    {
        var set = new HashSet<int>();

        if (el.ValueKind == JsonValueKind.Array)
        {
            foreach (var it in el.EnumerateArray())
            {
                if (it.ValueKind == JsonValueKind.Number && it.TryGetInt32(out var n) && n is >= 0 and <= 6) set.Add(n);
                else if (it.ValueKind == JsonValueKind.String && int.TryParse(it.GetString(), out var ns) && ns is >= 0 and <= 6) set.Add(ns);
            }
            return set;
        }

        if (el.ValueKind == JsonValueKind.String)
            return ParseDaysCsv(el.GetString());

        return set;
    }

    // shape interno
    sealed record Effective(
        string Timezone,
        int SlotGranularityMinutes,
        int DefaultAppointmentMinutes,
        string OpenTime,
        string CloseTime,
        HashSet<int> BusinessDays
    );
}
