using HomeExcursion.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace HomeExcursion.Api.Data;

public static class HomeSeedData
{
    public static async Task SeedAsync(
        HomeExcursionDbContext db,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken = default)
    {
        if (!environment.IsDevelopment())
        {
            return;
        }

        // Keep this development seed idempotent. If a Home property already exists,
        // assume the database has been initialized and leave user-entered data alone.
        if (await db.Properties.AnyAsync(cancellationToken))
        {
            return;
        }

        var property = new Property
        {
            HouseholdId = 1,
            Name = "Current House",
            City = "Spring",
            State = "TX",
            PostalCode = "77381",
            IsActive = true
        };

        db.Properties.Add(property);
        await db.SaveChangesAsync(cancellationToken);

        var projects = new[]
        {
            new HomeProject
            {
                PropertyId = property.Id,
                Name = "Fence Replacement",
                Status = "Complete",
                Purpose = "Repair",
                SortOrder = 10,
                CompletedAt = DateTime.UtcNow
            },
            new HomeProject
            {
                PropertyId = property.Id,
                Name = "Primary Bath Remodel",
                Status = "Complete",
                Purpose = "Resale Improvement",
                SortOrder = 20,
                CompletedAt = DateTime.UtcNow
            },
            new HomeProject
            {
                PropertyId = property.Id,
                Name = "Half Bath Remodel",
                Status = "Complete",
                Purpose = "Resale Improvement",
                SortOrder = 30,
                CompletedAt = DateTime.UtcNow
            },
            new HomeProject
            {
                PropertyId = property.Id,
                Name = "Back Door & Trim Replacement",
                Status = "Complete",
                Purpose = "Repair",
                SortOrder = 40,
                CompletedAt = DateTime.UtcNow
            },
            new HomeProject
            {
                PropertyId = property.Id,
                Name = "Kitchen Remodel",
                Status = "Bid Received",
                Purpose = "Resale Improvement",
                EstimatedCost = 27000m,
                ContractorName = "Exclusive Remodeling",
                Notes = "Bid received. Flooring was not listed in the estimate. Counter lights/top cabinets were handwritten additions and should be confirmed in a revised written scope.",
                SortOrder = 50
            }
        };

        db.Projects.AddRange(projects);
        await db.SaveChangesAsync(cancellationToken);

        var tasks = new[]
        {
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Replace second-bath shower panel",
                Status = "Ordered",
                Priority = "High",
                ContractorNeeded = false,
                Notes = "AKDY 65 in. 8-Jet Rainfall Shower Panel ordered from Home Depot.",
                SortOrder = 10
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Fix light switch in Grandmama's room",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 20
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Replace light switches in master bath",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 30
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Paint laundry room",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 40
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Power wash exterior, driveway, walkways, porches and brick",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 50
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Fresh landscaping and mulch; sod if needed",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                Notes = "Do just prior to listing.",
                SortOrder = 60
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Clean gutters",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 70
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Clean windows inside and out",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 80
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Trim tree branches away from roof",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = true,
                SortOrder = 90
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Paint interior existing light gray color",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 100
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Paint banisters white",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 110
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Paint and caulk baseboards where needed",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 120
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Install new carpet in bedrooms",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = true,
                SortOrder = 130
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Install matching bright lightbulbs throughout",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 140
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Clean tile and grout",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 150
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Replace shower curtain and rod in upstairs bath",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 160
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Install closet door on bedroom closet",
                Status = "To Do",
                Priority = "Normal",
                ContractorNeeded = false,
                SortOrder = 170
            },
            new HomeTask
            {
                PropertyId = property.Id,
                Title = "Service HVAC and verify heating/AC operation",
                Status = "To Do",
                Priority = "High",
                ContractorNeeded = true,
                Notes = "Schedule just prior to listing.",
                SortOrder = 180
            }
        };

        db.Tasks.AddRange(tasks);
        await db.SaveChangesAsync(cancellationToken);

        var showerTask = tasks.First(t => t.Title == "Replace second-bath shower panel");

        db.Expenses.Add(new Expense
        {
            PropertyId = property.Id,
            TaskId = showerTask.Id,
            Description = "AKDY 65 in. 8-Jet Rainfall Shower Panel",
            Vendor = "Home Depot",
            Amount = 216.49m,
            ExpenseDate = new DateOnly(2026, 8, 26),
            Category = "Fixture",
            Notes = "Receipt total including sales tax."
        });

        await db.SaveChangesAsync(cancellationToken);
    }
}
