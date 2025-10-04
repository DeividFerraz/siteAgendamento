using siteAgendamento.Domain.Common;

namespace siteAgendamento.Domain.Clients;

public class Client : TenantEntity
{
    public string FirstName { get; set; } = default!;
    public string LastName { get; set; } = default!;
    public string? Email { get; set; }
    public string? PhoneE164 { get; set; }     
}
