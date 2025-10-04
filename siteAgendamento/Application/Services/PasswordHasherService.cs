using System.Security.Cryptography;
using System.Text;

namespace siteAgendamento.Application.Services;

public class PasswordHasherService
{
    public string Hash(string password)
    {
        using var derive = new Rfc2898DeriveBytes(password, 16, 100_000, HashAlgorithmName.SHA256);
        var salt = derive.Salt;
        var key = derive.GetBytes(32);
        return Convert.ToBase64String(salt.Concat(key).ToArray()); // 16 + 32 = 48 bytes
    }

    public bool Verify(string password, string hash)
    {
        var bytes = Convert.FromBase64String(hash);
        var salt = bytes.Take(16).ToArray();
        var key = bytes.Skip(16).Take(32).ToArray();
        using var derive = new Rfc2898DeriveBytes(password, salt, 100_000, HashAlgorithmName.SHA256);
        var check = derive.GetBytes(32);
        return CryptographicOperations.FixedTimeEquals(key, check);
    }
}
