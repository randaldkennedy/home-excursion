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
    public List<HomeReceiptLineItem> LineItems { get; init; } = [];
    public string? RawText { get; init; }
    public List<string> Warnings { get; init; } = [];
    public bool IsReconciled { get; init; }
    public List<string> ValidationIssues { get; init; } = [];
}

public sealed class HomeReceiptLineItem
{
    public string? Description { get; init; }
    public decimal? Quantity { get; init; }
    public decimal? UnitPrice { get; init; }
    public decimal? LineTotal { get; init; }
}
