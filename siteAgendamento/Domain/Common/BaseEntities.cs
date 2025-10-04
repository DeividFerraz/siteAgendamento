namespace siteAgendamento.Domain.Common;

public abstract class Entity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedUtc { get; set; }
}

public interface ITenantEntity { Guid TenantId { get; set; } }

public abstract class TenantEntity : Entity, ITenantEntity
{
    public Guid TenantId { get; set; }
    public byte[] RowVersion { get; set; } = Array.Empty<byte>(); // concurrency token
}
