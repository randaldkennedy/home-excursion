namespace HomeExcursion.Api.Models;

public class Area
{
    public int Id { get; set; }
    public int PropertyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<TaskArea> TaskAreas { get; set; } = new List<TaskArea>();
}
