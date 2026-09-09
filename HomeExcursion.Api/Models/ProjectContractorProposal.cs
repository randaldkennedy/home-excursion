namespace HomeExcursion.Api.Models;

public class ProjectContractorProposal
{
    public int Id { get; set; }

    public int ProjectContractorId { get; set; }

    public DateOnly ReceivedDate { get; set; }

    public string? RevisionLabel { get; set; }

    public decimal? Amount { get; set; }

    public string? Notes { get; set; }

    public bool IsCurrent { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ProjectContractor ProjectContractor { get; set; } = null!;
}
