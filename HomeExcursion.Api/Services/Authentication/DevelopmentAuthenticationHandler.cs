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
        // Development only: impersonate the first configured platform user.
        // Prefer the user already configured for Road so Home stays in the
        // same household authorization path while developing locally.
        var user = await _platformDb.Users
            .AsNoTracking()
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
                "No development platform user is available.");
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.EntraObjectId),
            new Claim(ClaimTypes.Name, "Development User"),
            new Claim(EntraObjectIdClaim, user.EntraObjectId),
            new Claim("oid", user.EntraObjectId)
        };

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);

        return AuthenticateResult.Success(ticket);
    }
}
