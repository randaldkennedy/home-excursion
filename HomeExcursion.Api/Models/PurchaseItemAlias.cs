namespace HomeExcursion.Api.Models;

public class PurchaseItemAlias
{
    public int Id { get; set; }

    public int HouseholdId { get; set; }

    public string ReceiptText { get; set; } = string.Empty;

    public string NormalizedReceiptText { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
