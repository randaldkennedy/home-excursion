using HomeExcursion.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace HomeExcursion.Api.Data;

public class HomeExcursionDbContext : DbContext
{
    public HomeExcursionDbContext(
        DbContextOptions<HomeExcursionDbContext> options)
        : base(options)
    {
    }

    public DbSet<Property> Properties => Set<Property>();
    public DbSet<HomeProject> Projects => Set<HomeProject>();
    public DbSet<HomeTask> Tasks => Set<HomeTask>();
    public DbSet<Expense> Expenses => Set<Expense>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("home");

        modelBuilder.Entity<Property>(entity =>
        {
            entity.Property(p => p.Name)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(p => p.Address1)
                .HasMaxLength(250);

            entity.Property(p => p.City)
                .HasMaxLength(100);

            entity.Property(p => p.State)
                .HasMaxLength(50);

            entity.Property(p => p.PostalCode)
                .HasMaxLength(20);

            entity.HasIndex(p => new { p.HouseholdId, p.IsActive });
        });

        modelBuilder.Entity<HomeProject>(entity =>
        {
            entity.ToTable("Projects");

            entity.Property(p => p.Name)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(p => p.Status)
                .HasMaxLength(40)
                .IsRequired();

            entity.Property(p => p.Purpose)
                .HasMaxLength(60);

            entity.Property(p => p.EstimatedCost)
                .HasPrecision(12, 2);

            entity.Property(p => p.CommittedCost)
                .HasPrecision(12, 2);

            entity.Property(p => p.ContractorName)
                .HasMaxLength(200);

            entity.HasOne(p => p.Property)
                .WithMany(p => p.Projects)
                .HasForeignKey(p => p.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(p => new { p.PropertyId, p.Status });
        });

        modelBuilder.Entity<HomeTask>(entity =>
        {
            entity.ToTable("Tasks");

            entity.Property(t => t.Title)
                .HasMaxLength(300)
                .IsRequired();

            entity.Property(t => t.Status)
                .HasMaxLength(40)
                .IsRequired();

            entity.Property(t => t.Priority)
                .HasMaxLength(30)
                .IsRequired();

            entity.Property(t => t.ContractorName)
                .HasMaxLength(200);

            entity.Property(t => t.EstimatedCost)
                .HasPrecision(12, 2);

            entity.HasOne(t => t.Property)
                .WithMany(p => p.Tasks)
                .HasForeignKey(t => t.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(t => t.Project)
                .WithMany(p => p.Tasks)
                .HasForeignKey(t => t.ProjectId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasIndex(t => new { t.PropertyId, t.Status, t.SortOrder });
            entity.HasIndex(t => t.ProjectId);
        });

        modelBuilder.Entity<Expense>(entity =>
        {
            entity.Property(e => e.Description)
                .HasMaxLength(300)
                .IsRequired();

            entity.Property(e => e.Vendor)
                .HasMaxLength(200);

            entity.Property(e => e.Category)
                .HasMaxLength(60);

            entity.Property(e => e.Amount)
                .HasPrecision(12, 2);

            entity.HasOne(e => e.Property)
                .WithMany(p => p.Expenses)
                .HasForeignKey(e => e.PropertyId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Project)
                .WithMany(p => p.Expenses)
                .HasForeignKey(e => e.ProjectId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasOne(e => e.Task)
                .WithMany(t => t.Expenses)
                .HasForeignKey(e => e.TaskId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasIndex(e => new { e.PropertyId, e.ExpenseDate });
            entity.HasIndex(e => e.ProjectId);
            entity.HasIndex(e => e.TaskId);
        });
    }
}
