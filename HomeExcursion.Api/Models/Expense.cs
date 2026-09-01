namespace HomeExcursion.Api.Models;

public class Expense
{
    public int Id { get; set; }

    public int PropertyId { get; set; }

    public int? ProjectId { get; set; }

    public int? TaskId { get; set; }

    public int? VendorId { get; set; }

    public string Description { get; set; } = string.Empty;

    public string? Vendor { get; set; }

    public decimal Amount { get; set; }

    public DateOnly? ExpenseDate { get; set; }

    public string? Category { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Property Property { get; set; } = null!;

    public HomeProject? Project { get; set; }

    public HomeTask? Task { get; set; }

    public Vendor? VendorRecord { get; set; }
}
