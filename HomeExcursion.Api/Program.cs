using HomeExcursion.Api.Data;
using HomeExcursion.Api.Endpoints;
using HomeExcursion.Api.Services.Authentication;
using HomeExcursion.Api.Services.Attachments;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web;

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
    builder.Services
        .AddAuthentication(OpenIdConnectDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApp(builder.Configuration.GetSection("AzureAd"));

    builder.Services.Configure<OpenIdConnectOptions>(
        OpenIdConnectDefaults.AuthenticationScheme,
        options =>
        {
            options.SignedOutRedirectUri = "https://laultimaexcursion.com";
        });
}

builder.Services.AddAuthorization();

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddSingleton<IAttachmentStorageService, DevelopmentAttachmentStorageService>();
}
else
{
    builder.Services.AddSingleton<IAttachmentStorageService, AzureBlobAttachmentStorageService>();
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var homeDb = scope.ServiceProvider.GetRequiredService<HomeExcursionDbContext>();
    await HomeSeedData.SeedAsync(homeDb, app.Environment);
}

app.UseAuthentication();
app.UseAuthorization();

app.UseDefaultFiles();
app.UseStaticFiles();

if (!app.Environment.IsDevelopment())
{
    app.MapGet("/", async (HttpContext context) =>
    {
        if (!(context.User.Identity?.IsAuthenticated ?? false))
        {
            await context.ChallengeAsync();
            return;
        }

        context.Response.ContentType = "text/html";
        await context.Response.SendFileAsync(
            Path.Combine(app.Environment.WebRootPath, "index.html"));
    });

    app.MapGet("/index.html", async (HttpContext context) =>
    {
        if (!(context.User.Identity?.IsAuthenticated ?? false))
        {
            await context.ChallengeAsync();
            return;
        }

        context.Response.ContentType = "text/html";
        await context.Response.SendFileAsync(
            Path.Combine(app.Environment.WebRootPath, "index.html"));
    });
}

app.MapAuthEndpoints();
app.MapAttachmentEndpoints();
app.MapHomeEndpoints();

app.Run();
