namespace siteAgendamento.Domain.Identity;

public class User : siteAgendamento.Domain.Common.Entity
{
    public string Name { get; set; } = default!;
    public string Email { get; set; } = default!;
    public string PasswordHash { get; set; } = default!;
    public bool Active { get; set; } = true;

    public ICollection<UserTenant> Tenants { get; set; } = new List<UserTenant>();
}

public class UserTenant
{
    public Guid UserId { get; set; }
    public Guid TenantId { get; set; }
    public string Role { get; set; } = "Staff"; 
    public Guid? StaffId { get; set; }
}
