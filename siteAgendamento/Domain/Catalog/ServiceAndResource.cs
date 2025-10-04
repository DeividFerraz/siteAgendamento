using siteAgendamento.Domain.Common;

namespace siteAgendamento.Domain.Catalog;

public class Service : TenantEntity
{
    public string Name { get; set; } = default!;
    public int DurationMin { get; set; }
    public int BufferBeforeMin { get; set; } = 0;
    public int BufferAfterMin { get; set; } = 0;
    public int Capacity { get; set; } = 1;
    public int? PriceCents { get; set; }
}

public class Resource : TenantEntity
{
    public string Name { get; set; } = default!;
    public string Type { get; set; } = "generic";
    public bool Active { get; set; } = true;
}

public class BusinessHours : TenantEntity
{
    public int DayOfWeek { get; set; }         
    public TimeSpan StartLocal { get; set; }
    public TimeSpan EndLocal { get; set; }
}

public class Block : TenantEntity
{
    public Guid? StaffId { get; set; }         
    public DateTime StartUtc { get; set; }
    public DateTime EndUtc { get; set; }
    public string Reason { get; set; } = "Block";
}
