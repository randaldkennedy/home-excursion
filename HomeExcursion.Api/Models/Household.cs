namespace HomeExcursion.Api.Models;

public class Household
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public DateTimeOffset CreatedUtc { get; set; } =
        DateTimeOffset.UtcNow;

    public ICollection<HouseholdMember> Members { get; set; } =
        new List<HouseholdMember>();
}
