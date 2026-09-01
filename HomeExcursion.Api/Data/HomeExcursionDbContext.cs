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
    public DbSet<Vendor> Vendors => Set<Vendor>();
    public DbSet<Area> Areas => Set<Area>();
    public DbSet<TaskArea> TaskAreas => Set<TaskArea>();

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

            entity.HasOne(p => p.ParentProject)
                .WithMany(p => p.ChildProjects)
                .HasForeignKey(p => p.ParentProjectId)
                .OnDelete(DeleteBehavior.NoAction);

            entity.HasIndex(p => new { p.PropertyId, p.Status });
            entity.HasIndex(p => p.ParentProjectId);
        });

        modelBuilder.Entity<HomeTask>(entity =>
        {
            entity.ToTable("Tasks");

            entity.Property(t => t.Title)
                .HasMaxLength(300)
                .IsRequired();

            entity.Property(t => t.Area)
                .HasMaxLength(100);

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
            entity.HasIndex(t => new { t.PropertyId, t.Area });
            entity.HasIndex(t => t.ProjectId);
        });



        modelBuilder.Entity<Area>(entity =>
        {
            entity.ToTable("Areas");

            entity.Property(a => a.Name)
                .HasMaxLength(100)
                .IsRequired();

            entity.HasIndex(a => new { a.PropertyId, a.Name })
                .IsUnique();
        });

        modelBuilder.Entity<TaskArea>(entity =>
        {
            entity.ToTable("TaskAreas");

            entity.HasKey(ta => new { ta.TaskId, ta.AreaId });

            entity.HasOne(ta => ta.Task)
                .WithMany(t => t.TaskAreas)
                .HasForeignKey(ta => ta.TaskId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(ta => ta.Area)
                .WithMany(a => a.TaskAreas)
                .HasForeignKey(ta => ta.AreaId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(ta => ta.AreaId);
        });


        modelBuilder.Entity<Vendor>(entity =>
        {
            entity.Property(v => v.Name)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(v => v.Phone)
                .HasMaxLength(50);

            entity.Property(v => v.Email)
                .HasMaxLength(254);

            entity.Property(v => v.Website)
                .HasMaxLength(500);

            entity.Property(v => v.Address1)
                .HasMaxLength(250);

            entity.Property(v => v.Address2)
                .HasMaxLength(250);

            entity.Property(v => v.City)
                .HasMaxLength(100);

            entity.Property(v => v.State)
                .HasMaxLength(50);

            entity.Property(v => v.PostalCode)
                .HasMaxLength(20);

            entity.HasIndex(v => v.Name);
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

            entity.HasOne(e => e.VendorRecord)
                .WithMany(v => v.Expenses)
                .HasForeignKey(e => e.VendorId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => new { e.PropertyId, e.ExpenseDate });
            entity.HasIndex(e => e.ProjectId);
            entity.HasIndex(e => e.TaskId);
            entity.HasIndex(e => e.VendorId);
        });
    }
}
