using siteAgendamento.Domain.Common;

namespace siteAgendamento.Domain.Staffing;

public class Staff : TenantEntity
{
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = default!;
    public string? Bio { get; set; }
    public bool Active { get; set; } = true;

    // ===== NOVOS CAMPOS =====
    /// <summary>"admin" ou "staff". Serve só para facilitar filtros/visões de UI.</summary>
    public string Role { get; set; } = "staff";

    /// <summary>Foto/“logo” do colaborador (opcional). Se null, o front herda a Logo do tenant.</summary>
    public string? PhotoUrl { get; set; }

    /// <summary>
    /// JSON com overrides de configuração do colaborador.
    /// Shape esperado (todos opcionais):
    /// { "timezone": "...", "businessDays": ["1","2",...], "openTime":"HH:mm", "closeTime":"HH:mm",
    ///   "slotGranularityMinutes": 5, "defaultAppointmentMinutes": 30 }
    /// </summary>
    public string? SettingsOverrideJson { get; set; }
    // ========================

    public ICollection<StaffAvailability> Availabilities { get; set; } = new List<StaffAvailability>();
}

public class StaffAvailability : TenantEntity
{
    public Guid StaffId { get; set; }
    public int DayOfWeek { get; set; }         // 0..6 (Dom..Sáb)
    public TimeSpan StartLocal { get; set; }   // HH:mm
    public TimeSpan EndLocal { get; set; }     // HH:mm
}
