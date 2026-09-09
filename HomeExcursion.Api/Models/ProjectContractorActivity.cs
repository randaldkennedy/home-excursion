namespace HomeExcursion.Api.Models;

public class ProjectContractorActivity
{
    public int Id { get; set; }

    public int ProjectContractorId { get; set; }

    public string ActivityType { get; set; } = "Note";

    public DateTime ActivityAt { get; set; } = DateTime.UtcNow;

    public string Summary { get; set; } = string.Empty;

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ProjectContractor ProjectContractor { get; set; } = null!;
}
