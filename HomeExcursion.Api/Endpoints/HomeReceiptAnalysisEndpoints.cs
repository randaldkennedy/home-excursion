using HomeExcursion.Api.Services.Receipts;

namespace HomeExcursion.Api.Endpoints;

public static class HomeReceiptAnalysisEndpoints
{
    public static IEndpointRouteBuilder MapHomeReceiptAnalysisEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
            "/api/home/receipt-analysis/analyze",
            async (
                IFormFile file,
                IHomeReceiptAnalyzer analyzer,
                CancellationToken cancellationToken) =>
            {
                if (file.Length <= 0)
                    return Results.BadRequest(new { message = "Choose a receipt image to analyze." });

                const long MaxFileSize = 20L * 1024L * 1024L;

                if (file.Length > MaxFileSize)
                    return Results.BadRequest(new { message = "Receipt images must be 20 MB or smaller." });

                var allowedTypes = new HashSet<string>(
                    StringComparer.OrdinalIgnoreCase)
                {
                    "image/jpeg",
                    "image/png",
                    "image/webp"
                };

                if (!allowedTypes.Contains(file.ContentType))
                {
                    return Results.BadRequest(new
                    {
                        message = "AI receipt reading currently supports JPEG, PNG, and WebP images."
                    });
                }

                await using var stream = file.OpenReadStream();

                var result = await analyzer.AnalyzeAsync(
                    stream,
                    file.ContentType,
                    cancellationToken);

                return Results.Ok(result);
            })
            .RequireAuthorization()
            .DisableAntiforgery();

        return endpoints;
    }
}
