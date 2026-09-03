namespace HomeExcursion.Api.Services.Receipts;

public interface IHomeReceiptAnalyzer
{
    Task<HomeReceiptAnalysisResult> AnalyzeAsync(
        Stream receiptImage,
        string contentType,
        CancellationToken cancellationToken);
}

public sealed class HomeReceiptAnalysisResult
{
    public string? Vendor { get; init; }
    public DateOnly? PurchaseDate { get; init; }
    public decimal? Subtotal { get; init; }
    public decimal? Tax { get; init; }
    public decimal? Total { get; init; }
    public string? RawText { get; init; }
    public List<string> Warnings { get; init; } = [];
}
