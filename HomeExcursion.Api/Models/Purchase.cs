namespace HomeExcursion.Api.Models;

public class Purchase
{
    public int Id { get; set; }

    public int PropertyId { get; set; }

    public int? VendorId { get; set; }

    // Temporary bridge used only to make the legacy Expense -> Purchase migration
    // deterministic and idempotent. New purchases leave this null.
    public int? LegacyExpenseId { get; set; }

    public string? Vendor { get; set; }

    public DateOnly? PurchaseDate { get; set; }

    public decimal? Subtotal { get; set; }

    public decimal? Tax { get; set; }

    public decimal Total { get; set; }

    // Unreviewed | Needs Review | Verified | Ignored
    public string Status { get; set; } = "Unreviewed";

    // Manual | Quick Receipt | AI Import | Legacy Expense Migration
    public string Source { get; set; } = "Manual";

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? VerifiedAt { get; set; }

    public Property Property { get; set; } = null!;

    public Vendor? VendorRecord { get; set; }

    public ICollection<PurchaseAllocation> Allocations { get; set; } = new List<PurchaseAllocation>();
}
