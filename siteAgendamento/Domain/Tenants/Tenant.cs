namespace siteAgendamento.Domain.Tenants;

public class Tenant : siteAgendamento.Domain.Common.Entity
{
    public string Slug { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string Timezone { get; set; } = "America/Sao_Paulo";
    public bool Active { get; set; } = true;

    public TenantBranding Branding { get; set; } = new();
    public TenantSettings Settings { get; set; } = new();
}

public class TenantBranding
{
    public string? LogoUrl { get; set; }
    public string Primary { get; set; } = "#1976D2";
    public string Secondary { get; set; } = "#90CAF9";
    public string Tertiary { get; set; } = "#E3F2FD";
}

public class TenantSettings
{
    public int SlotGranularityMinutes { get; set; } = 10;
    public bool AllowAnonymousAppointments { get; set; } = false;
    public int CancellationWindowHours { get; set; } = 24;
    public string Timezone { get; internal set; }
    public string BusinessDays { get; internal set; }
    public string OpenTime { get; internal set; }
    public string CloseTime { get; internal set; }
    public int DefaultAppointmentMinutes { get; internal set; }
}
