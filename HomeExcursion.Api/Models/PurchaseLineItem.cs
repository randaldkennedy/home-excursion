namespace HomeExcursion.Api.Models;

public class PurchaseLineItem
{
    public int Id { get; set; }

    public int PurchaseId { get; set; }

    public string ReceiptText { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public decimal? Quantity { get; set; }

    public decimal? UnitPrice { get; set; }

    public decimal? LineTotal { get; set; }

    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Purchase Purchase { get; set; } = null!;

    public PurchaseAllocation? Allocation { get; set; }
}
