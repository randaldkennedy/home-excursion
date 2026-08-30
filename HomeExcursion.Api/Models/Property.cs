namespace HomeExcursion.Api.Models;

public class Property
{
    public int Id { get; set; }

    public int HouseholdId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? Address1 { get; set; }

    public string? City { get; set; }

    public string? State { get; set; }

    public string? PostalCode { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<HomeProject> Projects { get; set; } = new List<HomeProject>();

    public ICollection<HomeTask> Tasks { get; set; } = new List<HomeTask>();

    public ICollection<Expense> Expenses { get; set; } = new List<Expense>();
}
