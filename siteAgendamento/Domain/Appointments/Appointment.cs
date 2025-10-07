// siteAgendamento.Domain.Appointments

using siteAgendamento.Domain.Common;

namespace siteAgendamento.Domain.Appointments;

public enum AppointmentStatus { Scheduled, Held, Confirmed, Rescheduled, Canceled, NoShow }

public class Appointment : TenantEntity
{
    public Guid ServiceId { get; set; }
    public Guid StaffId { get; set; }

    public Guid? ClientId { get; set; }
    public string ClientType { get; set; } = "Registered"; // Registered|Guest|Anonymous
    public string? GuestContactJson { get; set; }

    public DateTime StartUtc { get; set; }
    public DateTime EndUtc { get; set; }

    public AppointmentStatus Status { get; set; } = AppointmentStatus.Confirmed;

    // === novos campos p/ UI ===
    public string? ClientName { get; set; }  // p/ "Esporádico" ou "Nome Sobrenome"
    public string Kind { get; set; } = "appt"; // "appt" | "block" | "timeoff"

    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
}

public class AppointmentHold : TenantEntity
{
    public Guid ServiceId { get; set; }
    public Guid StaffId { get; set; }
    public DateTime StartUtc { get; set; }
    public DateTime EndUtc { get; set; }
    public string Token { get; set; } = default!;
    public DateTime ExpiresUtc { get; set; }
}
