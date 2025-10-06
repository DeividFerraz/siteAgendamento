using System.Text.Json;
using siteAgendamento.Api.DTOs;
using siteAgendamento.Domain.Staffing;
using siteAgendamento.Domain.Tenants;

namespace siteAgendamento.Application.Services;

public static class EffectiveSettings
{
    public sealed record FlatSettings(
        int SlotGranularityMinutes,
        bool AllowAnonymousAppointments,
        int CancellationWindowHours,
        string Timezone,
        string BusinessDays, // "1,2,3,4,5"
        string OpenTime,     // "HH:mm"
        string CloseTime,    // "HH:mm"
        int DefaultAppointmentMinutes
    );

    public static FlatSettings For(Tenant t, Staff s)
    {
        // base = tenant
        int slot = t.Settings.SlotGranularityMinutes;
        bool anon = t.Settings.AllowAnonymousAppointments;
        int cancel = t.Settings.CancellationWindowHours;
        string tz = t.Settings.Timezone ?? "America/Sao_Paulo";
        string days = t.Settings.BusinessDays ?? "1,2,3,4,5";
        string open = t.Settings.OpenTime ?? "07:00";
        string close = t.Settings.CloseTime ?? "20:00";
        int def = t.Settings.DefaultAppointmentMinutes;

        // overlay staff (se houver)
        if (!string.IsNullOrWhiteSpace(s.SettingsOverrideJson))
        {
            var o = JsonSerializer.Deserialize<StaffSettingsDto>(s.SettingsOverrideJson);
            if (o is not null)
            {
                slot = o.SlotGranularityMinutes ?? slot;
                anon = o.AllowAnonymousAppointments ?? anon;
                cancel = o.CancellationWindowHours ?? cancel;
                tz = o.Timezone ?? tz;
                if (o.BusinessDays is not null) days = string.Join(",", o.BusinessDays);
                open = o.OpenTime ?? open;
                close = o.CloseTime ?? close;
                def = o.DefaultAppointmentMinutes ?? def;
            }
        }

        return new FlatSettings(slot, anon, cancel, tz, days, open, close, def);
    }
}
