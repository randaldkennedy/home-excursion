using HomeExcursion.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace HomeExcursion.Api.Data;

public class LaUltimaExcursionDbContext : DbContext
{
    public LaUltimaExcursionDbContext(
        DbContextOptions<LaUltimaExcursionDbContext> options)
        : base(options)
    {
    }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Household> Households => Set<Household>();
    public DbSet<HouseholdMember> HouseholdMembers => Set<HouseholdMember>();
    public DbSet<Attachment> Attachments => Set<Attachment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("platform");

        modelBuilder.Entity<AppUser>()
            .HasIndex(u => u.EntraObjectId)
            .IsUnique();

        modelBuilder.Entity<AppUser>()
            .HasOne<Household>()
            .WithMany()
            .HasForeignKey(u => u.DefaultHouseholdId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<HouseholdMember>()
            .HasKey(hm => new
            {
                hm.HouseholdId,
                hm.UserId
            });

        modelBuilder.Entity<HouseholdMember>()
            .HasOne(hm => hm.Household)
            .WithMany(h => h.Members)
            .HasForeignKey(hm => hm.HouseholdId);

        modelBuilder.Entity<HouseholdMember>()
            .HasOne(hm => hm.User)
            .WithMany(u => u.HouseholdMemberships)
            .HasForeignKey(hm => hm.UserId);

        modelBuilder.Entity<Attachment>(entity =>
        {
            entity.HasIndex(a => new
            {
                a.HouseholdId,
                a.App,
                a.Category
            });

            entity.HasIndex(a => new
            {
                a.HouseholdId,
                a.EntityType,
                a.EntityId
            });

            entity.HasIndex(a => a.BlobName)
                .IsUnique();

            entity.HasOne(a => a.Household)
                .WithMany()
                .HasForeignKey(a => a.HouseholdId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(a => a.UploadedByUser)
                .WithMany()
                .HasForeignKey(a => a.UploadedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(a => a.Supersedes)
                .WithMany()
                .HasForeignKey(a => a.SupersedesId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
