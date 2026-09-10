using System.Security.Claims;
using System.Text.Encodings.Web;
using HomeExcursion.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace HomeExcursion.Api.Services.Authentication;

public sealed class DevelopmentAuthenticationHandler
    : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "Development";

    private const string EntraObjectIdClaim =
        "http://schemas.microsoft.com/identity/claims/objectidentifier";

    private readonly LaUltimaExcursionDbContext _platformDb;

    public DevelopmentAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        LaUltimaExcursionDbContext platformDb)
        : base(options, logger, encoder)
    {
        _platformDb = platformDb;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // Development only:
        // - Default behavior stays exactly as before.
        // - Add ?devUser=<email> to any local request to impersonate a specific
        //   platform user for authorization testing.
        //
        // Example:
        // https://localhost:5065/api/home/dashboard?devUser=LaUltimaExcursion@gmail.com
        var requestedEmail = Context.Request.Query["devUser"].FirstOrDefault();

        var users = _platformDb.Users.AsNoTracking();

        var user = !string.IsNullOrWhiteSpace(requestedEmail)
            ? await users.FirstOrDefaultAsync(
                u => u.Email != null && u.Email == requestedEmail,
                Context.RequestAborted)
            : await users
                .Where(u =>
                    u.EntraObjectId != null &&
                    u.EntraObjectId != "" &&
                    u.DefaultHouseholdId != null)
                .OrderByDescending(u => u.DefaultVehicleId != null)
                .ThenBy(u => u.Id)
                .FirstOrDefaultAsync(Context.RequestAborted);

        if (user == null)
        {
            return AuthenticateResult.Fail(
                string.IsNullOrWhiteSpace(requestedEmail)
                    ? "No development platform user is available."
                    : $"Development platform user '{requestedEmail}' was not found.");
        }

        if (string.IsNullOrWhiteSpace(user.EntraObjectId))
        {
            return AuthenticateResult.Fail(
                $"Development platform user '{user.Email ?? user.Id.ToString()}' does not have an Entra object ID.");
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.EntraObjectId),
            new Claim(ClaimTypes.Name, user.Email ?? "Development User"),
            new Claim(ClaimTypes.Email, user.Email ?? string.Empty),
            new Claim(EntraObjectIdClaim, user.EntraObjectId),
            new Claim("oid", user.EntraObjectId)
        };

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);

        return AuthenticateResult.Success(ticket);
    }
}
