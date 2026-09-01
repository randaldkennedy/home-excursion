namespace HomeExcursion.Api.Models;

public class HomeProject
{
    public int Id { get; set; }

    public int PropertyId { get; set; }

    public int? ParentProjectId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Status { get; set; } = "Planned";

    public string? Purpose { get; set; }

    public decimal? EstimatedCost { get; set; }

    public decimal? CommittedCost { get; set; }

    public string? ContractorName { get; set; }

    public DateOnly? TargetDate { get; set; }

    public string? Notes { get; set; }

    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? CompletedAt { get; set; }

    public Property Property { get; set; } = null!;

    public HomeProject? ParentProject { get; set; }

    public ICollection<HomeProject> ChildProjects { get; set; } = new List<HomeProject>();

    public ICollection<HomeTask> Tasks { get; set; } = new List<HomeTask>();

    public ICollection<Expense> Expenses { get; set; } = new List<Expense>();
}
