namespace HomeExcursion.Api.Models;

public class ProjectClosureItem
{
    public int Id { get; set; }

    public int ProjectId { get; set; }

    public string Description { get; set; } = string.Empty;

    public string Status { get; set; } = "Planned";

    public DateOnly? DueDate { get; set; }

    public string? Notes { get; set; }

    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? CompletedAt { get; set; }

    public HomeProject Project { get; set; } = null!;
}
