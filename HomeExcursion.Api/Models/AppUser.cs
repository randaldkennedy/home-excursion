namespace HomeExcursion.Api.Models;

public class AppUser
{
    public int Id { get; set; }

    public string EntraObjectId { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string? GivenName { get; set; }

    public string? Surname { get; set; }

    public int? DefaultHouseholdId { get; set; }

    public int? DefaultVehicleId { get; set; }

    public DateTimeOffset CreatedUtc { get; set; } =
        DateTimeOffset.UtcNow;

    public ICollection<HouseholdMember> HouseholdMemberships { get; set; } =
        new List<HouseholdMember>();
}
