using HomeExcursion.Api.Data;
using HomeExcursion.Api.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.EntityFrameworkCore;

namespace HomeExcursion.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(
        this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/auth/me", async (
            HttpContext httpContext,
            LaUltimaExcursionDbContext platformDb) =>
        {
            var principal = httpContext.User;

            var entraObjectId =
                principal.FindFirst(
                    "http://schemas.microsoft.com/identity/claims/objectidentifier"
                )?.Value;

            var email =
                principal.FindFirst("emails")?.Value
                ?? principal.FindFirst("preferred_username")?.Value
                ?? principal.Identity?.Name;

            var givenName =
                principal.FindFirst(
                    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"
                )?.Value;

            if (string.IsNullOrWhiteSpace(entraObjectId))
            {
                return Results.BadRequest(
                    "Authenticated user is missing the Entra object identifier.");
            }

            var user = await platformDb.Users
                .Include(u => u.HouseholdMemberships)
                .SingleOrDefaultAsync(
                    u => u.EntraObjectId == entraObjectId);

            if (user == null)
            {
                user = new AppUser
                {
                    EntraObjectId = entraObjectId,
                    Email = email ?? string.Empty,
                    GivenName = givenName
                };

                platformDb.Users.Add(user);
                await platformDb.SaveChangesAsync();
            }
            else
            {
                user.Email = email ?? user.Email;
                user.GivenName = givenName ?? user.GivenName;
            }

            if (user.HouseholdMemberships.Count == 0)
            {
                var householdName =
                    !string.IsNullOrWhiteSpace(user.GivenName)
                        ? $"{user.GivenName}'s Household"
                        : "My Household";

                var household = new Household
                {
                    Name = householdName
                };

                var membership = new HouseholdMember
                {
                    User = user,
                    Household = household,
                    Role = "Owner"
                };

                platformDb.Households.Add(household);
                platformDb.HouseholdMembers.Add(membership);

                await platformDb.SaveChangesAsync();

                user.DefaultHouseholdId = household.Id;
            }
            else if (user.DefaultHouseholdId == null)
            {
                user.DefaultHouseholdId =
                    user.HouseholdMemberships
                        .OrderBy(hm => hm.JoinedUtc)
                        .Select(hm => (int?)hm.HouseholdId)
                        .FirstOrDefault();
            }

            await platformDb.SaveChangesAsync();

            return Results.Ok(new
            {
                isAuthenticated = true,
                userId = user.Id,
                user.EntraObjectId,
                user.Email,
                user.GivenName,
                user.DefaultHouseholdId
            });
        })
        .RequireAuthorization();

        app.MapGet("/api/auth/logout", async (
            HttpContext httpContext,
            IWebHostEnvironment environment) =>
        {
            if (environment.IsDevelopment())
            {
                return Results.Redirect("/");
            }

            await httpContext.SignOutAsync(
                CookieAuthenticationDefaults.AuthenticationScheme);

            await httpContext.SignOutAsync(
                OpenIdConnectDefaults.AuthenticationScheme,
                new AuthenticationProperties
                {
                    RedirectUri = "https://laultimaexcursion.com"
                });

            return Results.Empty;
        })
        .RequireAuthorization();

        app.MapGet("/api/auth/claims", (HttpContext httpContext) =>
        {
            return Results.Ok(
                httpContext.User.Claims
                    .Select(c => new
                    {
                        c.Type,
                        c.Value
                    })
                    .OrderBy(c => c.Type));
        })
        .RequireAuthorization();

        return app;
    }
}
