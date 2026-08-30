namespace HomeExcursion.Api.Models;

public class HouseholdMember
{
    public int HouseholdId { get; set; }

    public Household Household { get; set; } = null!;

    public int UserId { get; set; }

    public AppUser User { get; set; } = null!;

    public string Role { get; set; } = "Member";

    public DateTimeOffset JoinedUtc { get; set; } =
        DateTimeOffset.UtcNow;
}
