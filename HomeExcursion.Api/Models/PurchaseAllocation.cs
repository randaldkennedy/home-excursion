namespace HomeExcursion.Api.Models;

public class PurchaseAllocation
{
    public int Id { get; set; }

    public int PurchaseId { get; set; }

    public int? ProjectId { get; set; }

    public int? TaskId { get; set; }

    // Temporary bridge used only during the legacy Expense migration.
    public int? LegacyExpenseId { get; set; }

    public decimal Amount { get; set; }

    public string Description { get; set; } = string.Empty;

    public string? Category { get; set; }

    // Task | Project | GeneralHome | Maintenance | TaxFee |
    // PersonalExcluded | Unassigned
    public string AllocationType { get; set; } = "Unassigned";

    // False for PersonalExcluded and other non-house dollars.
    public bool IsIncludedInHomeSpend { get; set; } = true;

    // User | AI | Migration
    public string SuggestedBy { get; set; } = "User";

    public decimal? Confidence { get; set; }

    public bool IsVerified { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Purchase Purchase { get; set; } = null!;

    public HomeProject? Project { get; set; }

    public HomeTask? Task { get; set; }
}
