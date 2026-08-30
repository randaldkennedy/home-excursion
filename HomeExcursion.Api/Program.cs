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

builder.Services.AddDbContext<LaUltimaExcursionDbContext>(options =>
    options.UseSqlServer(connectionString));

if (builder.Environment.IsDevelopment())
{
    builder.Services
        .AddAuthentication("Development")
        .AddScheme<AuthenticationSchemeOptions, DevelopmentAuthenticationHandler>(
            "Development",
            options => { });
}
else
{
    builder.Services.AddAuthentication();
}

builder.Services.AddAuthorization();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => "Home Excursion foundation is running.");

app.MapAuthEndpoints();

app.Run();