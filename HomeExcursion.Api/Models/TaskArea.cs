namespace HomeExcursion.Api.Models;

public class TaskArea
{
    public int TaskId { get; set; }
    public int AreaId { get; set; }

    public HomeTask Task { get; set; } = null!;
    public Area Area { get; set; } = null!;
}
