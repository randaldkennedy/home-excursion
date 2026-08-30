using HomeExcursion.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HomeExcursion.Api.Endpoints;

public static class HomeEndpoints
{
    public static IEndpointRouteBuilder MapHomeEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/home")
            .RequireAuthorization();

        group.MapGet("/dashboard", GetDashboardAsync);
        group.MapPatch("/tasks/{id:int}/complete", SetTaskCompletionAsync);

        return app;
    }

    private static async Task<IResult> GetDashboardAsync(
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var property = await db.Properties
            .AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (property is null)
        {
            return Results.NotFound(new { message = "No active Home Excursion property was found." });
        }

        var projects = await db.Projects
            .AsNoTracking()
            .Where(p => p.PropertyId == property.Id)
            .OrderBy(p => p.SortOrder)
            .ThenBy(p => p.Name)
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.Status,
                p.Purpose,
                p.EstimatedCost,
                p.CommittedCost,
                p.ContractorName,
                p.TargetDate,
                p.Notes,
                p.CompletedAt
            })
            .ToListAsync(cancellationToken);

        var tasks = await db.Tasks
            .AsNoTracking()
            .Where(t => t.PropertyId == property.Id)
            .OrderBy(t => t.SortOrder)
            .ThenBy(t => t.Title)
            .Select(t => new
            {
                t.Id,
                t.ProjectId,
                ProjectName = t.Project != null ? t.Project.Name : null,
                t.Title,
                t.Status,
                t.Priority,
                t.ContractorNeeded,
                t.ContractorName,
                t.EstimatedCost,
                t.TargetDate,
                t.CompletedAt,
                t.Notes
            })
            .ToListAsync(cancellationToken);

        var spent = await db.Expenses
            .Where(e => e.PropertyId == property.Id)
            .SumAsync(e => (decimal?)e.Amount, cancellationToken) ?? 0m;

        var committed = projects.Sum(p => p.CommittedCost ?? 0m);

        // "Remaining estimated" is intentionally simple for MVP:
        // estimated project/task cost not yet represented by posted expenses.
        var estimated =
            projects.Sum(p => p.EstimatedCost ?? 0m) +
            tasks.Sum(t => t.EstimatedCost ?? 0m);

        var remainingEstimated = Math.Max(0m, estimated - spent);

        var completeProjects = projects.Count(p =>
            string.Equals(p.Status, "Complete", StringComparison.OrdinalIgnoreCase));

        var completeTasks = tasks.Count(t =>
            string.Equals(t.Status, "Complete", StringComparison.OrdinalIgnoreCase));

        var totalItems = projects.Count + tasks.Count;
        var completeItems = completeProjects + completeTasks;
        var progressPercent = totalItems == 0
            ? 0
            : (int)Math.Round(100d * completeItems / totalItems);

        return Results.Ok(new
        {
            property = new
            {
                property.Id,
                property.Name,
                property.City,
                property.State,
                property.PostalCode
            },
            summary = new
            {
                spent,
                committed,
                remainingEstimated,
                completeItems,
                totalItems,
                progressPercent,
                taskCount = tasks.Count,
                completedTaskCount = completeTasks
            },
            projects,
            tasks
        });
    }

    private sealed record SetTaskCompletionRequest(bool Completed);

    private static async Task<IResult> SetTaskCompletionAsync(
        int id,
        SetTaskCompletionRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var task = await db.Tasks
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken);

        if (task is null)
        {
            return Results.NotFound();
        }

        task.Status = request.Completed ? "Complete" : "To Do";
        task.CompletedAt = request.Completed ? DateTime.UtcNow : null;

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new
        {
            task.Id,
            task.Status,
            task.CompletedAt
        });
    }
}
