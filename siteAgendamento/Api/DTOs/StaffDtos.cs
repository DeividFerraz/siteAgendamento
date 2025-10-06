using System.ComponentModel.DataAnnotations;

namespace siteAgendamento.Api.DTOs;

public enum StaffRole { Admin, Staff }

public record StaffRegisterDto(
    [property: Required, StringLength(120)] string DisplayName,
    [property: Required, EmailAddress] string Email,
    [property: Required, StringLength(100)] string Password,
    StaffRole Role,
    string? PhotoUrl,
    StaffSettingsDto? Settings // overrides (opcional)
);

public record StaffUpdateDto(
    string? DisplayName,
    string? Bio,
    StaffRole? Role,
    string? PhotoUrl,
    bool? Active
);

/// <summary>Qualquer campo nulo = herda do tenant</summary>
public record StaffSettingsDto(
    int? SlotGranularityMinutes,
    bool? AllowAnonymousAppointments,
    int? CancellationWindowHours,
    string? Timezone,
    List<string>? BusinessDays,
    string? OpenTime,
    string? CloseTime,
    int? DefaultAppointmentMinutes
);
