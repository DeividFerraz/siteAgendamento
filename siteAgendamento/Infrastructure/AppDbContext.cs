using Microsoft.EntityFrameworkCore;
using siteAgendamento.Domain.Tenants;
using siteAgendamento.Domain.Identity;
using siteAgendamento.Domain.Staffing;
using siteAgendamento.Domain.Clients;
using siteAgendamento.Domain.Catalog;
using siteAgendamento.Domain.Appointments;
using siteAgendamento.Domain.Waitlist;

namespace siteAgendamento.Infrastructure;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> opt) : base(opt) { }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Client> Clients => Set<Client>();
    public DbSet<Service> Services => Set<Service>();
    public DbSet<Resource> Resources => Set<Resource>();
    public DbSet<Staff> Staffs => Set<Staff>();
    public DbSet<StaffAvailability> StaffAvailabilities => Set<StaffAvailability>();
    public DbSet<BusinessHours> BusinessHours => Set<BusinessHours>();
    public DbSet<Block> Blocks => Set<Block>();
    public DbSet<Appointment> Appointments => Set<Appointment>();
    public DbSet<AppointmentHold> AppointmentHolds => Set<AppointmentHold>();
    public DbSet<WaitlistEntry> Waitlist => Set<WaitlistEntry>();
    public DbSet<UserTenant> UserTenants => Set<UserTenant>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Tenant>().OwnsOne(t => t.Branding);
        b.Entity<Tenant>().OwnsOne(t => t.Settings);

        b.Entity<User>()
          .HasIndex(u => u.Email).IsUnique();

        b.Entity<UserTenant>().HasKey(x => new { x.UserId, x.TenantId });
        b.Entity<UserTenant>().Property(p => p.Role).HasMaxLength(32);

        // Concurrency tokens
        b.Entity<Appointment>().Property<byte[]>("RowVersion").IsRowVersion();
        b.Entity<Service>().Property(s => s.RowVersion).IsRowVersion();
        b.Entity<Staff>().Property(s => s.RowVersion).IsRowVersion();

        // Clients: unique por tenant (+ email/phone quando não nulos)
        b.Entity<Client>()
          .HasIndex(c => new { c.TenantId, c.Email })
          .IsUnique()
          .HasFilter("[Email] IS NOT NULL");
        b.Entity<Client>()
          .HasIndex(c => new { c.TenantId, c.PhoneE164 })
          .IsUnique()
          .HasFilter("[PhoneE164] IS NOT NULL");

        // Índices para performance de agenda
        b.Entity<Appointment>()
          .HasIndex(a => new { a.TenantId, a.StaffId, a.StartUtc });
        b.Entity<AppointmentHold>()
          .HasIndex(h => new { h.TenantId, h.StaffId, h.StartUtc });
    }
}
