using System.ComponentModel.DataAnnotations;

namespace HomeExcursion.Api.Models;

public class Attachment
{
    public long Id { get; set; }

    public int HouseholdId { get; set; }

    public int UploadedByUserId { get; set; }

    [MaxLength(50)]
    public string App { get; set; } = string.Empty;

    [MaxLength(100)]
    public string Category { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? EntityType { get; set; }

    [MaxLength(100)]
    public string? EntityId { get; set; }

    [MaxLength(260)]
    public string FileName { get; set; } = string.Empty;

    [MaxLength(200)]
    public string ContentType { get; set; } = string.Empty;

    [MaxLength(500)]
    public string BlobName { get; set; } = string.Empty;

    public long FileSizeBytes { get; set; }

    public DateTime UploadedUtc { get; set; } = DateTime.UtcNow;

    public bool IsActive { get; set; } = true;

    public DateTime? EffectiveDate { get; set; }

    public DateTime? ExpirationDate { get; set; }

    public long? SupersedesId { get; set; }

    public Household Household { get; set; } = null!;

    public AppUser UploadedByUser { get; set; } = null!;

    public Attachment? Supersedes { get; set; }
}
