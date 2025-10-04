using siteAgendamento.Domain.Common;

namespace siteAgendamento.Domain.Waitlist;

public class WaitlistEntry : TenantEntity
{
    public Guid ClientId { get; set; }
    public Guid ServiceId { get; set; }
    public string PriorityMode { get; set; } = "FIFO"; 
    public string Status { get; set; } = "Active";    
    public string? PreferencesJson { get; set; }
}
