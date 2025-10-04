using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.IdentityModel.Tokens;

namespace siteAgendamento.Application.Services;

public sealed class JwtTokenService
{
    private readonly string _issuer, _audience;
    private readonly SymmetricSecurityKey _key;
    private readonly int _expiresMinutes;

    public JwtTokenService(string issuer, string audience, SymmetricSecurityKey key, int expiresMinutes)
    {
        _issuer = issuer; _audience = audience; _key = key; _expiresMinutes = expiresMinutes;
    }

    public string CreateToken(Guid userId, string email, Guid tenantId, string role, Guid? staffId = null)
    {
        var claims = new List<Claim>
        {
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, email),
            new Claim("tenant_id", tenantId.ToString()),
            new Claim(ClaimTypes.Role, role)
        };
        if (staffId.HasValue) claims.Add(new Claim("staff_id", staffId.Value.ToString()));

        var creds = new SigningCredentials(_key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(_issuer, _audience, claims,
            expires: DateTime.UtcNow.AddMinutes(_expiresMinutes), signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
