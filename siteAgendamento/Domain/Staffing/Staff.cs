using siteAgendamento.Domain.Common;

namespace siteAgendamento.Domain.Staffing;

public class Staff : TenantEntity
{
    public Guid UserId { get; set; }          
    public string DisplayName { get; set; } = default!;
    public string? Bio { get; set; }
    public bool Active { get; set; } = true;

    public ICollection<StaffAvailability> Availabilities { get; set; } = new List<StaffAvailability>();
}

public class StaffAvailability : TenantEntity
{
    public Guid StaffId { get; set; }
    public int DayOfWeek { get; set; }         
    public TimeSpan StartLocal { get; set; }    
    public TimeSpan EndLocal { get; set; }
}
