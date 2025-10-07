using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using siteAgendamento.Api;
using siteAgendamento.Application.Services;
using siteAgendamento.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// EF Core + SQL Server
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// JWT
var jwt = builder.Configuration.GetSection("Jwt");
var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt["Key"]!));

builder.Services
  .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
  .AddJwtBearer(o =>
  {
      o.TokenValidationParameters = new TokenValidationParameters
      {
          ValidateIssuer = true,
          ValidateAudience = true,
          ValidateIssuerSigningKey = true,
          ValidateLifetime = true,
          ValidIssuer = jwt["Issuer"],
          ValidAudience = jwt["Audience"],
          RoleClaimType = "role",
          IssuerSigningKey = key
      };
  });

builder.Services.AddAuthorization(options =>
{
    // **Empresa (somente adm master)**
    options.AddPolicy("AdminMasterOnly", p => p.RequireRole("adm master"));
    options.AddPolicy("ManageTenant", p => p.RequireRole("adm master"));

    // **Ver/gerenciar TODAS as agendas (adm master + admin)**
    options.AddPolicy("ManageAllCalendars", p => p.RequireRole("adm master", "admin"));

    // **Agendar/editar a própria agenda (qualquer usuário autenticado)**
    options.AddPolicy("ManageOwnCalendar", p => p.RequireAuthenticatedUser());
});

// Services
builder.Services.AddSingleton(new JwtTokenService(jwt["Issuer"]!, jwt["Audience"]!, key, int.Parse(jwt["ExpiresMinutes"]!)));
builder.Services.AddScoped<PasswordHasherService>();
builder.Services.AddScoped<AvailabilityService>();
builder.Services.AddScoped<BookingService>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.CustomSchemaIds(type => type.FullName!.Replace('+', '.'));
});

var app = builder.Build();

app.MapGet("/", () => Results.Redirect("/login.html"));
app.UseStaticFiles();

// Swagger
app.UseSwagger();
app.UseSwaggerUI();

app.UseAuthentication();
app.UseAuthorization();

// Módulos
AuthEndpoints.Map(app);
TenantEndpoints.Map(app);
StaffEndpoints.Map(app);
ClientEndpoints.Map(app);
CatalogEndpoints.Map(app);
AvailabilityEndpoints.Map(app);
AppointmentEndpoints.Map(app);
WaitlistEndpoints.Map(app);
ReportEndpoints.Map(app);
HealthEndpoints.Map(app);

app.Run();
