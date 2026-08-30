using HomeExcursion.Api.Data;
using HomeExcursion.Api.Endpoints;
using HomeExcursion.Api.Services.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var connectionString =
    builder.Configuration.GetConnectionString("HomeExcursion")
    ?? throw new InvalidOperationException(
        "Connection string 'HomeExcursion' was not found.");

builder.Services.AddDbContext<HomeExcursionDbContext>(options =>
    options.UseSqlServer(
        connectionString,
        sqlOptions =>
        {
            sqlOptions.MigrationsHistoryTable("__EFMigrationsHistory", "home");
            sqlOptions.EnableRetryOnFailure();
        }));

builder.Services.AddDbContext<LaUltimaExcursionDbContext>(options =>
    options.UseSqlServer(
        connectionString,
        sqlOptions =>
        {
            sqlOptions.MigrationsHistoryTable("__EFMigrationsHistory", "platform");
            sqlOptions.EnableRetryOnFailure();
        }));

if (builder.Environment.IsDevelopment())
{
    builder.Services
        .AddAuthentication(DevelopmentAuthenticationHandler.SchemeName)
        .AddScheme<AuthenticationSchemeOptions, DevelopmentAuthenticationHandler>(
            DevelopmentAuthenticationHandler.SchemeName,
            _ => { });
}
else
{
    builder.Services.AddAuthentication();
}

builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var homeDb = scope.ServiceProvider.GetRequiredService<HomeExcursionDbContext>();
    await HomeSeedData.SeedAsync(homeDb, app.Environment);
}

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapHomeEndpoints();

app.Run();
