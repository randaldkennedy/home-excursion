namespace HomeExcursion.Api.Models;

public class HomeTask
{
    public int Id { get; set; }

    public int PropertyId { get; set; }

    public int? ProjectId { get; set; }

    public string Title { get; set; } = string.Empty;

    public string Status { get; set; } = "To Do";

    public string Priority { get; set; } = "Normal";

    public bool ContractorNeeded { get; set; }

    public string? ContractorName { get; set; }

    public decimal? EstimatedCost { get; set; }

    public DateOnly? TargetDate { get; set; }

    public DateTime? CompletedAt { get; set; }

    public string? Notes { get; set; }

    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Property Property { get; set; } = null!;

    public HomeProject? Project { get; set; }

    public ICollection<Expense> Expenses { get; set; } = new List<Expense>();
}
