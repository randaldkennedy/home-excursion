using Docnet.Core;
using Docnet.Core.Models;
using HomeExcursion.Api.Services.Receipts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

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
                    return Results.BadRequest(new { message = "Choose a receipt image or PDF to analyze." });

                const long MaxFileSize = 20L * 1024L * 1024L;

                if (file.Length > MaxFileSize)
                    return Results.BadRequest(new { message = "Receipt files must be 20 MB or smaller." });

                var allowedImageTypes = new HashSet<string>(
                    StringComparer.OrdinalIgnoreCase)
                {
                    "image/jpeg",
                    "image/png",
                    "image/webp"
                };

                var isPdf = string.Equals(
                    file.ContentType,
                    "application/pdf",
                    StringComparison.OrdinalIgnoreCase);

                if (!allowedImageTypes.Contains(file.ContentType) && !isPdf)
                {
                    return Results.BadRequest(new
                    {
                        message = "AI receipt reading supports JPEG, PNG, WebP, and PDF files."
                    });
                }

                if (isPdf)
                {
                    try
                    {
                        await using var renderedPage = await RenderFirstPdfPageAsync(
                            file,
                            cancellationToken);

                        var result = await analyzer.AnalyzeAsync(
                            renderedPage,
                            "image/png",
                            cancellationToken);

                        return Results.Ok(result);
                    }
                    catch (Exception ex)
                    {
                        return Results.BadRequest(new
                        {
                            message = $"Could not render the first page of that PDF: {ex.Message}"
                        });
                    }
                }

                await using var stream = file.OpenReadStream();

                var imageResult = await analyzer.AnalyzeAsync(
                    stream,
                    file.ContentType,
                    cancellationToken);

                return Results.Ok(imageResult);
            })
            .RequireAuthorization()
            .DisableAntiforgery();

        return endpoints;
    }

    private static async Task<MemoryStream> RenderFirstPdfPageAsync(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        await using var pdfStream = file.OpenReadStream();
        using var pdfBuffer = new MemoryStream();
        await pdfStream.CopyToAsync(pdfBuffer, cancellationToken);

        var pdfBytes = pdfBuffer.ToArray();

        using var docReader = DocLib.Instance.GetDocReader(
            pdfBytes,
            new PageDimensions(1800, 2400));

        if (docReader.GetPageCount() <= 0)
            throw new InvalidOperationException("The PDF does not contain any pages.");

        using var pageReader = docReader.GetPageReader(0);

        var rawBytes = pageReader.GetImage();
        var width = pageReader.GetPageWidth();
        var height = pageReader.GetPageHeight();

        using var image = Image.LoadPixelData<Bgra32>(
            rawBytes,
            width,
            height);

        // PDFium may return transparent page backgrounds.
        // Flatten onto white before sending the image to the receipt analyzer.
        image.Mutate(context => context.BackgroundColor(Color.White));

        var pngStream = new MemoryStream();
        await image.SaveAsPngAsync(pngStream, cancellationToken);
        pngStream.Position = 0;

        return pngStream;
    }
}
