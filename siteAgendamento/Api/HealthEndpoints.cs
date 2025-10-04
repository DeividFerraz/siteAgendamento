namespace siteAgendamento.Api;

public static class HealthEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
        app.MapGet("/ready", () => Results.Ok(new { ready = true }));
    }
}
