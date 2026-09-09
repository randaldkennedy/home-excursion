namespace HomeExcursion.Api.Models;

public class ProjectContractor
{
    public int Id { get; set; }

    public int ProjectId { get; set; }

    public int? VendorId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Status { get; set; } = "Considering";

    public string? Phone { get; set; }

    public decimal? BidAmount { get; set; }

    public string? Notes { get; set; }

    public bool IsSelected { get; set; }

    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public HomeProject Project { get; set; } = null!;

    public Vendor? Vendor { get; set; }

    public ICollection<ProjectContractorActivity> Activities { get; set; } = new List<ProjectContractorActivity>();

    public ICollection<ProjectContractorProposal> Proposals { get; set; } = new List<ProjectContractorProposal>();
}
