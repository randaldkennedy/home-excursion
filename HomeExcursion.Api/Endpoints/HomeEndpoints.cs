using HomeExcursion.Api.Data;
using HomeExcursion.Api.Models;
using HomeExcursion.Api.Services.Attachments;
using Microsoft.EntityFrameworkCore;

namespace HomeExcursion.Api.Endpoints;

public static class HomeEndpoints
{
    public static IEndpointRouteBuilder MapHomeEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/home")
            .RequireAuthorization();

        group.MapGet("/dashboard", GetDashboardAsync);

        group.MapGet("/projects/{id:int}/details", GetProjectDetailsAsync);
        group.MapGet("/projects/{id:int}/attachments", GetProjectAttachmentsAsync);
        group.MapPost("/projects/{id:int}/attachments", UploadProjectAttachmentAsync)
            .DisableAntiforgery();

        group.MapPurchaseEndpoints();

        // Legacy Expense endpoints remain during the Purchase transition.
        group.MapGet("/expenses", GetExpensesAsync);
        group.MapPost("/expenses", CreateExpenseAsync);
        group.MapPut("/expenses/{id:int}", UpdateExpenseAsync);
        group.MapDelete("/expenses/{id:int}", DeleteExpenseAsync);
        group.MapPost("/expenses/{id:int}/attachments", UploadExpenseAttachmentAsync)
            .DisableAntiforgery();

        group.MapPost("/tasks", CreateTaskAsync);
        group.MapPut("/tasks/{id:int}", UpdateTaskAsync);
        group.MapPatch("/tasks/{id:int}/complete", SetTaskCompletionAsync);
        group.MapDelete("/tasks/{id:int}", DeleteTaskAsync);

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

        var projectRows = await db.Projects
            .AsNoTracking()
            .Where(p => p.PropertyId == property.Id)
            .Select(p => new
            {
                p.Id,
                p.ParentProjectId,
                ParentProjectName = p.ParentProject != null ? p.ParentProject.Name : null,
                p.Name,
                p.Status,
                p.Purpose,
                p.EstimatedCost,
                p.CommittedCost,
                p.ContractorName,
                p.TargetDate,
                p.Notes,
                p.CompletedAt,
                p.SortOrder
            })
            .ToListAsync(cancellationToken);

        var directProjectSpend = await db.PurchaseAllocations
            .AsNoTracking()
            .Where(a =>
                a.Purchase.PropertyId == property.Id &&
                a.IsIncludedInHomeSpend &&
                a.ProjectId != null)
            .GroupBy(a => a.ProjectId!.Value)
            .Select(g => new { ProjectId = g.Key, Amount = g.Sum(a => a.Amount) })
            .ToDictionaryAsync(x => x.ProjectId, x => x.Amount, cancellationToken);

        decimal RollupProjectSpend(int projectId)
        {
            var direct = directProjectSpend.GetValueOrDefault(projectId);
            var childSpend = projectRows
                .Where(p => p.ParentProjectId == projectId)
                .Sum(child => RollupProjectSpend(child.Id));
            return direct + childSpend;
        }

        var projects = projectRows
            .Select(p => new
            {
                p.Id,
                p.ParentProjectId,
                p.ParentProjectName,
                p.Name,
                p.Status,
                p.Purpose,
                p.EstimatedCost,
                p.CommittedCost,
                p.ContractorName,
                p.TargetDate,
                p.Notes,
                p.CompletedAt,
                p.SortOrder,
                DirectSpent = directProjectSpend.GetValueOrDefault(p.Id),
                ActualSpent = RollupProjectSpend(p.Id)
            })
            .ToList();

        var taskRows = await db.Tasks
            .AsNoTracking()
            .Include(t => t.Project)
            .Include(t => t.TaskAreas)
                .ThenInclude(ta => ta.Area)
            .Where(t => t.PropertyId == property.Id)
            .ToListAsync(cancellationToken);

        var tasks = taskRows
            .Select(t => new
            {
                t.Id,
                t.ProjectId,
                ProjectName = t.Project != null ? t.Project.Name : null,
                t.Title,
                Area = t.TaskAreas.Count > 0
                    ? t.TaskAreas.Select(ta => ta.Area.Name).OrderBy(x => x).FirstOrDefault()
                    : t.Area,
                Areas = t.TaskAreas.Count > 0
                    ? t.TaskAreas.Select(ta => ta.Area.Name).OrderBy(x => x).ToList()
                    : string.IsNullOrWhiteSpace(t.Area)
                        ? new List<string>()
                        : new List<string> { t.Area },
                t.Status,
                t.Priority,
                t.ContractorNeeded,
                t.ContractorName,
                t.EstimatedCost,
                t.TargetDate,
                t.CompletedAt,
                t.Notes,
                t.SortOrder
            })
            .ToList();

        var spent = await db.PurchaseAllocations
            .Where(a => a.Purchase.PropertyId == property.Id && a.IsIncludedInHomeSpend)
            .SumAsync(a => (decimal?)a.Amount, cancellationToken) ?? 0m;

        var maintenanceExpenses = await db.PurchaseAllocations
            .AsNoTracking()
            .Where(a =>
                a.Purchase.PropertyId == property.Id &&
                a.IsIncludedInHomeSpend &&
                (a.AllocationType == "Maintenance" ||
                 (a.Category != null && a.Category.Contains("Maintenance"))))
            .OrderByDescending(a => a.Purchase.PurchaseDate)
            .ThenByDescending(a => a.Id)
            .Select(a => new
            {
                a.Id,
                a.Description,
                a.Amount,
                ExpenseDate = a.Purchase.PurchaseDate,
                VendorName = a.Purchase.VendorRecord != null ? a.Purchase.VendorRecord.Name : a.Purchase.Vendor,
                a.Notes
            })
            .ToListAsync(cancellationToken);

        var maintenance = maintenanceExpenses.Sum(e => e.Amount);

        // "Committed" is work we have approved/contracted but that is not already finished.
        var committed = projects
            .Where(p =>
                !string.Equals(p.Status, "Complete", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(p.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
            .Sum(p => p.CommittedCost ?? 0m);

        // "Estimated" is known planned work, not historical completed work.
        // Example: the $27,000 kitchen bid belongs here until it is approved.
        var estimated =
            projects
                .Where(p =>
                    !string.Equals(p.Status, "Complete", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(p.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
                .Sum(p => p.EstimatedCost ?? 0m) +
            tasks
                .Where(t =>
                    !string.Equals(t.Status, "Complete", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(t.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
                .Sum(t => t.EstimatedCost ?? 0m);

        // Parent projects are organizational rollups. Do not count them again in progress,
        // otherwise "Bathroom Remodel" plus its two child bathroom projects would double-count work.
        var parentProjectIds = projects
            .Where(p => p.ParentProjectId is not null)
            .Select(p => p.ParentProjectId!.Value)
            .ToHashSet();

        var leafProjects = projects
            .Where(p => !parentProjectIds.Contains(p.Id))
            .ToList();

        var completeProjects = leafProjects.Count(p =>
            string.Equals(p.Status, "Complete", StringComparison.OrdinalIgnoreCase));

        var completeTasks = tasks.Count(t =>
            string.Equals(t.Status, "Complete", StringComparison.OrdinalIgnoreCase));

        var totalItems = leafProjects.Count + tasks.Count;
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
                maintenance,
                committed,
                estimated,
                completeItems,
                totalItems,
                progressPercent,
                taskCount = tasks.Count,
                completedTaskCount = completeTasks
            },
            projects,
            tasks,
            maintenanceExpenses
        });
    }

    private static async Task<IResult> GetProjectDetailsAsync(
        int id,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var project = await db.Projects
            .AsNoTracking()
            .Where(p => p.Id == id)
            .Select(p => new
            {
                p.Id,
                p.PropertyId,
                p.ParentProjectId,
                p.Name,
                p.Status,
                p.Purpose,
                p.EstimatedCost,
                p.CommittedCost,
                p.ContractorName,
                p.TargetDate,
                p.CompletedAt,
                p.Notes,
                HouseholdId = p.Property.HouseholdId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (project is null)
            return Results.NotFound();

        var scopeIds = await GetProjectScopeIdsAsync(id, project.PropertyId, db, cancellationToken);

        var children = await db.Projects
            .AsNoTracking()
            .Where(p => scopeIds.Contains(p.Id) && p.Id != id)
            .OrderBy(p => p.SortOrder)
            .ThenBy(p => p.Name)
            .Select(p => new
            {
                p.Id,
                p.ParentProjectId,
                p.Name,
                p.Status
            })
            .ToListAsync(cancellationToken);

        var expenses = await db.PurchaseAllocations
            .AsNoTracking()
            .Where(a =>
                a.IsIncludedInHomeSpend &&
                a.ProjectId != null &&
                scopeIds.Contains(a.ProjectId.Value))
            .OrderByDescending(a => a.Purchase.PurchaseDate)
            .ThenByDescending(a => a.Id)
            .Select(a => new
            {
                Id = a.Id,
                PurchaseId = a.PurchaseId,
                a.ProjectId,
                ProjectName = a.Project != null ? a.Project.Name : null,
                a.Description,
                Vendor = a.Purchase.Vendor,
                VendorName = a.Purchase.VendorRecord != null ? a.Purchase.VendorRecord.Name : a.Purchase.Vendor,
                a.Amount,
                ExpenseDate = a.Purchase.PurchaseDate,
                a.Category,
                a.Notes
            })
            .ToListAsync(cancellationToken);

        var purchaseEntityIds = expenses.Select(e => e.PurchaseId.ToString()).ToHashSet();
        var projectEntityIds = scopeIds.Select(x => x.ToString()).ToHashSet();

        var attachments = await platformDb.Attachments
            .AsNoTracking()
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == project.HouseholdId &&
                a.App == "home" &&
                (
                    (a.EntityType == "HomeProject" && a.EntityId != null && projectEntityIds.Contains(a.EntityId)) ||
                    (a.EntityType == "Purchase" && a.EntityId != null && purchaseEntityIds.Contains(a.EntityId))
                ))
            .OrderByDescending(a => a.UploadedUtc)
            .Select(a => new
            {
                a.Id,
                a.Category,
                a.EntityType,
                a.EntityId,
                a.FileName,
                a.ContentType,
                a.FileSizeBytes,
                a.UploadedUtc
            })
            .ToListAsync(cancellationToken);

        var actualSpent = expenses.Sum(e => e.Amount);

        return Results.Ok(new
        {
            project,
            children,
            expenses,
            attachments,
            actualSpent,
            documentCount = attachments.Count
        });
    }

    private static async Task<IResult> GetProjectAttachmentsAsync(
        int id,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var project = await db.Projects
            .AsNoTracking()
            .Where(p => p.Id == id)
            .Select(p => new
            {
                p.Id,
                p.PropertyId,
                HouseholdId = p.Property.HouseholdId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (project is null)
            return Results.NotFound();

        var scopeIds = await GetProjectScopeIdsAsync(id, project.PropertyId, db, cancellationToken);
        var entityIds = scopeIds.Select(x => x.ToString()).ToHashSet();

        var attachments = await platformDb.Attachments
            .AsNoTracking()
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == project.HouseholdId &&
                a.App == "home" &&
                a.EntityType == "HomeProject" &&
                a.EntityId != null &&
                entityIds.Contains(a.EntityId))
            .OrderByDescending(a => a.UploadedUtc)
            .Select(a => new
            {
                a.Id,
                a.Category,
                a.EntityType,
                a.EntityId,
                a.FileName,
                a.ContentType,
                a.FileSizeBytes,
                a.UploadedUtc
            })
            .ToListAsync(cancellationToken);

        return Results.Ok(attachments);
    }

    private static async Task<IResult> UploadProjectAttachmentAsync(
        int id,
        IFormFile file,
        HttpContext httpContext,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        const long MaxUploadBytes = 20L * 1024L * 1024L;

        if (file.Length <= 0)
            return Results.BadRequest(new { message = "Choose a file to upload." });

        if (file.Length > MaxUploadBytes)
            return Results.BadRequest(new { message = "Files must be 20 MB or smaller." });

        var isImage = file.ContentType?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) == true;
        var isPdf = string.Equals(file.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase);

        if (!isImage && !isPdf)
            return Results.BadRequest(new { message = "Home documents currently support images and PDF files." });

        var project = await db.Projects
            .AsNoTracking()
            .Where(p => p.Id == id)
            .Select(p => new
            {
                p.Id,
                HouseholdId = p.Property.HouseholdId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (project is null)
            return Results.NotFound();

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers
            .AnyAsync(
                hm => hm.UserId == userId.Value && hm.HouseholdId == project.HouseholdId,
                cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        StoredAttachment stored;
        await using (var stream = file.OpenReadStream())
        {
            stored = await storage.UploadAsync(
                project.HouseholdId,
                "home",
                "project-document",
                Path.GetFileName(file.FileName),
                file.ContentType ?? "application/octet-stream",
                stream,
                cancellationToken);
        }

        var attachment = new Attachment
        {
            HouseholdId = project.HouseholdId,
            UploadedByUserId = userId.Value,
            App = "home",
            Category = "project-document",
            EntityType = "HomeProject",
            EntityId = id.ToString(),
            FileName = Path.GetFileName(file.FileName),
            ContentType = file.ContentType ?? "application/octet-stream",
            BlobName = stored.BlobName,
            FileSizeBytes = stored.FileSizeBytes,
            UploadedUtc = DateTime.UtcNow,
            IsActive = true
        };

        try
        {
            platformDb.Attachments.Add(attachment);
            await platformDb.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            await storage.DeleteAsync(stored.BlobName, cancellationToken);
            throw;
        }

        if (isImage)
        {
            await AttachmentThumbnailHelper.EnsureCreatedAsync(
                attachment.BlobName,
                storage,
                cancellationToken);
        }

        return Results.Created(
            $"/api/attachments/{attachment.Id}",
            new
            {
                attachment.Id,
                attachment.FileName,
                attachment.ContentType,
                attachment.FileSizeBytes,
                attachment.UploadedUtc
            });
    }

    private static async Task<IResult> GetExpensesAsync(
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var property = await db.Properties
            .AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.Id)
            .Select(p => new { p.Id, p.HouseholdId })
            .FirstOrDefaultAsync(cancellationToken);

        if (property is null)
            return Results.NotFound(new { message = "No active Home Excursion property was found." });

        var expenses = await db.Expenses
            .AsNoTracking()
            .Where(e => e.PropertyId == property.Id)
            .OrderByDescending(e => e.ExpenseDate)
            .ThenByDescending(e => e.Id)
            .Select(e => new
            {
                e.Id,
                e.PropertyId,
                e.ProjectId,
                ProjectName = e.Project != null ? e.Project.Name : null,
                e.TaskId,
                TaskTitle = e.Task != null ? e.Task.Title : null,
                e.Description,
                e.Vendor,
                VendorName = e.VendorRecord != null ? e.VendorRecord.Name : e.Vendor,
                e.Amount,
                e.ExpenseDate,
                e.Category,
                e.Notes
            })
            .ToListAsync(cancellationToken);

        var expenseEntityIds = expenses.Select(e => e.Id.ToString()).ToHashSet();

        var attachments = await platformDb.Attachments
            .AsNoTracking()
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == property.HouseholdId &&
                a.App == "home" &&
                a.EntityType == "Expense" &&
                a.EntityId != null &&
                expenseEntityIds.Contains(a.EntityId))
            .OrderByDescending(a => a.UploadedUtc)
            .Select(a => new
            {
                a.Id,
                a.EntityId,
                a.Category,
                a.FileName,
                a.ContentType,
                a.FileSizeBytes,
                a.UploadedUtc
            })
            .ToListAsync(cancellationToken);

        return Results.Ok(expenses.Select(e => new
        {
            e.Id,
            e.PropertyId,
            e.ProjectId,
            e.ProjectName,
            e.TaskId,
            e.TaskTitle,
            e.Description,
            e.Vendor,
            e.VendorName,
            e.Amount,
            e.ExpenseDate,
            e.Category,
            e.Notes,
            Attachments = attachments
                .Where(a => a.EntityId == e.Id.ToString())
                .ToList()
        }));
    }

    private sealed record SaveExpenseRequest(
        int PropertyId,
        int? ProjectId,
        int? TaskId,
        string Description,
        string? Vendor,
        decimal Amount,
        DateOnly? ExpenseDate,
        string? Category,
        string? Notes);

    private static async Task<IResult> CreateExpenseAsync(
        SaveExpenseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var validation = await ValidateExpenseRequestAsync(request, db, cancellationToken);
        if (validation.Result is not null) return validation.Result;

        var expense = new Expense
        {
            PropertyId = request.PropertyId,
            ProjectId = validation.ProjectId,
            TaskId = request.TaskId,
            Description = request.Description.Trim(),
            Vendor = Clean(request.Vendor),
            Amount = request.Amount,
            ExpenseDate = request.ExpenseDate,
            Category = Clean(request.Category),
            Notes = Clean(request.Notes),
            CreatedAt = DateTime.UtcNow
        };

        db.Expenses.Add(expense);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/home/expenses/{expense.Id}", new { expense.Id });
    }

    private static async Task<IResult> UpdateExpenseAsync(
        int id,
        SaveExpenseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var expense = await db.Expenses
            .FirstOrDefaultAsync(e => e.Id == id, cancellationToken);

        if (expense is null)
            return Results.NotFound();

        var validation = await ValidateExpenseRequestAsync(request, db, cancellationToken);
        if (validation.Result is not null) return validation.Result;

        expense.PropertyId = request.PropertyId;
        expense.ProjectId = validation.ProjectId;
        expense.TaskId = request.TaskId;
        expense.Description = request.Description.Trim();
        expense.Vendor = Clean(request.Vendor);
        expense.Amount = request.Amount;
        expense.ExpenseDate = request.ExpenseDate;
        expense.Category = Clean(request.Category);
        expense.Notes = Clean(request.Notes);

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { expense.Id });
    }

    private static async Task<IResult> DeleteExpenseAsync(
        int id,
        HttpContext httpContext,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        var expense = await db.Expenses
            .Include(e => e.Property)
            .FirstOrDefaultAsync(e => e.Id == id, cancellationToken);

        if (expense is null)
            return Results.NotFound();

        var householdId = expense.Property.HouseholdId;

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers
            .AnyAsync(
                hm => hm.UserId == userId.Value && hm.HouseholdId == householdId,
                cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        var entityId = id.ToString();
        var attachments = await platformDb.Attachments
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == householdId &&
                a.App == "home" &&
                a.EntityType == "Expense" &&
                a.EntityId == entityId)
            .ToListAsync(cancellationToken);

        foreach (var attachment in attachments)
        {
            await storage.DeleteAsync(
                AttachmentThumbnailHelper.GetThumbnailBlobName(attachment.BlobName),
                cancellationToken);

            await storage.DeleteAsync(
                attachment.BlobName,
                cancellationToken);
        }

        if (attachments.Count > 0)
        {
            platformDb.Attachments.RemoveRange(attachments);
            await platformDb.SaveChangesAsync(cancellationToken);
        }

        db.Expenses.Remove(expense);
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    private static async Task<IResult> UploadExpenseAttachmentAsync(
        int id,
        IFormFile file,
        HttpContext httpContext,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        const long MaxUploadBytes = 20L * 1024L * 1024L;

        if (file.Length <= 0)
            return Results.BadRequest(new { message = "Choose a receipt or document to upload." });

        if (file.Length > MaxUploadBytes)
            return Results.BadRequest(new { message = "Files must be 20 MB or smaller." });

        var isImage = file.ContentType?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) == true;
        var isPdf = string.Equals(file.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase);

        if (!isImage && !isPdf)
            return Results.BadRequest(new { message = "Expense attachments currently support images and PDF files." });

        var expense = await db.Expenses
            .AsNoTracking()
            .Where(e => e.Id == id)
            .Select(e => new
            {
                e.Id,
                HouseholdId = e.Property.HouseholdId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (expense is null)
            return Results.NotFound();

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers
            .AnyAsync(
                hm => hm.UserId == userId.Value && hm.HouseholdId == expense.HouseholdId,
                cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        StoredAttachment stored;
        await using (var stream = file.OpenReadStream())
        {
            stored = await storage.UploadAsync(
                expense.HouseholdId,
                "home",
                "expense-receipt",
                Path.GetFileName(file.FileName),
                file.ContentType ?? "application/octet-stream",
                stream,
                cancellationToken);
        }

        var attachment = new Attachment
        {
            HouseholdId = expense.HouseholdId,
            UploadedByUserId = userId.Value,
            App = "home",
            Category = "expense-receipt",
            EntityType = "Expense",
            EntityId = id.ToString(),
            FileName = Path.GetFileName(file.FileName),
            ContentType = file.ContentType ?? "application/octet-stream",
            BlobName = stored.BlobName,
            FileSizeBytes = stored.FileSizeBytes,
            UploadedUtc = DateTime.UtcNow,
            IsActive = true
        };

        try
        {
            platformDb.Attachments.Add(attachment);
            await platformDb.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            await storage.DeleteAsync(stored.BlobName, cancellationToken);
            throw;
        }

        if (isImage)
        {
            await AttachmentThumbnailHelper.EnsureCreatedAsync(
                attachment.BlobName,
                storage,
                cancellationToken);
        }

        return Results.Created(
            $"/api/attachments/{attachment.Id}",
            new
            {
                attachment.Id,
                attachment.FileName,
                attachment.ContentType,
                attachment.FileSizeBytes,
                attachment.UploadedUtc
            });
    }

    private sealed record ExpenseValidationResult(IResult? Result, int? ProjectId);

    private static async Task<ExpenseValidationResult> ValidateExpenseRequestAsync(
        SaveExpenseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Description))
            return new(Results.BadRequest(new { message = "Description is required." }), null);

        if (request.Description.Trim().Length > 300)
            return new(Results.BadRequest(new { message = "Description must be 300 characters or fewer." }), null);

        if (request.Amount < 0)
            return new(Results.BadRequest(new { message = "Amount cannot be negative." }), null);

        if (request.Vendor?.Trim().Length > 200)
            return new(Results.BadRequest(new { message = "Vendor must be 200 characters or fewer." }), null);

        if (request.Category?.Trim().Length > 100)
            return new(Results.BadRequest(new { message = "Category must be 100 characters or fewer." }), null);

        var propertyExists = await db.Properties
            .AnyAsync(p => p.Id == request.PropertyId, cancellationToken);

        if (!propertyExists)
            return new(Results.BadRequest(new { message = "Property was not found." }), null);

        int? projectId = request.ProjectId;

        if (request.ProjectId is not null)
        {
            var projectExists = await db.Projects.AnyAsync(
                p => p.Id == request.ProjectId && p.PropertyId == request.PropertyId,
                cancellationToken);

            if (!projectExists)
                return new(Results.BadRequest(new { message = "Selected project does not belong to this property." }), null);
        }

        if (request.TaskId is not null)
        {
            var task = await db.Tasks
                .AsNoTracking()
                .Where(t => t.Id == request.TaskId && t.PropertyId == request.PropertyId)
                .Select(t => new { t.Id, t.ProjectId })
                .FirstOrDefaultAsync(cancellationToken);

            if (task is null)
                return new(Results.BadRequest(new { message = "Selected task does not belong to this property." }), null);

            if (projectId is null)
                projectId = task.ProjectId;
            else if (task.ProjectId is not null && task.ProjectId != projectId)
                return new(Results.BadRequest(new { message = "Selected task belongs to a different project." }), null);
        }

        return new(null, projectId);
    }

    private static async Task<HashSet<int>> GetProjectScopeIdsAsync(
        int rootProjectId,
        int propertyId,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var projectTree = await db.Projects
            .AsNoTracking()
            .Where(p => p.PropertyId == propertyId)
            .Select(p => new { p.Id, p.ParentProjectId })
            .ToListAsync(cancellationToken);

        var result = new HashSet<int> { rootProjectId };
        var queue = new Queue<int>();
        queue.Enqueue(rootProjectId);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var child in projectTree.Where(p => p.ParentProjectId == current))
            {
                if (result.Add(child.Id))
                    queue.Enqueue(child.Id);
            }
        }

        return result;
    }

    private const string EntraObjectIdClaim =
        "http://schemas.microsoft.com/identity/claims/objectidentifier";

    private static async Task<int?> GetCurrentUserIdAsync(
        HttpContext httpContext,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var entraObjectId =
            httpContext.User.FindFirst(EntraObjectIdClaim)?.Value
            ?? httpContext.User.FindFirst("oid")?.Value;

        if (string.IsNullOrWhiteSpace(entraObjectId))
            return null;

        return await platformDb.Users
            .Where(u => u.EntraObjectId == entraObjectId)
            .Select(u => (int?)u.Id)
            .SingleOrDefaultAsync(cancellationToken);
    }

    private sealed record SaveTaskRequest(
        int PropertyId,
        int? ProjectId,
        string Title,
        string? Area,
        List<string>? Areas,
        string? Status,
        string? Priority,
        bool ContractorNeeded,
        string? ContractorName,
        decimal? EstimatedCost,
        DateOnly? TargetDate,
        string? Notes);

    private static async Task<IResult> CreateTaskAsync(
        SaveTaskRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var validation = await ValidateTaskRequestAsync(request, db, cancellationToken);
        if (validation is not null) return validation;

        var nextSortOrder = await db.Tasks
            .Where(t => t.PropertyId == request.PropertyId)
            .Select(t => (int?)t.SortOrder)
            .MaxAsync(cancellationToken) ?? 0;

        var task = new HomeTask
        {
            PropertyId = request.PropertyId,
            ProjectId = request.ProjectId,
            Title = request.Title.Trim(),
            Area = NormalizeAreaNames(request).FirstOrDefault(),
            Status = NormalizeStatus(request.Status),
            Priority = NormalizePriority(request.Priority),
            ContractorNeeded = request.ContractorNeeded,
            ContractorName = Clean(request.ContractorName),
            EstimatedCost = request.EstimatedCost,
            TargetDate = request.TargetDate,
            Notes = Clean(request.Notes),
            SortOrder = nextSortOrder + 10,
            CreatedAt = DateTime.UtcNow
        };

        if (string.Equals(task.Status, "Complete", StringComparison.OrdinalIgnoreCase))
            task.CompletedAt = DateTime.UtcNow;

        db.Tasks.Add(task);
        await SetTaskAreasAsync(task, request, db, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/home/tasks/{task.Id}", new { task.Id });
    }

    private static async Task<IResult> UpdateTaskAsync(
        int id,
        SaveTaskRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var task = await db.Tasks
            .Include(t => t.TaskAreas)
                .ThenInclude(ta => ta.Area)
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (task is null) return Results.NotFound();

        var validation = await ValidateTaskRequestAsync(request, db, cancellationToken);
        if (validation is not null) return validation;

        var oldStatus = task.Status;
        var newStatus = NormalizeStatus(request.Status);

        task.PropertyId = request.PropertyId;
        task.ProjectId = request.ProjectId;
        task.Title = request.Title.Trim();
        task.Area = NormalizeAreaNames(request).FirstOrDefault();
        task.Status = newStatus;
        task.Priority = NormalizePriority(request.Priority);
        task.ContractorNeeded = request.ContractorNeeded;
        task.ContractorName = Clean(request.ContractorName);
        task.EstimatedCost = request.EstimatedCost;
        task.TargetDate = request.TargetDate;
        task.Notes = Clean(request.Notes);

        await SetTaskAreasAsync(task, request, db, cancellationToken);

        if (!string.Equals(oldStatus, "Complete", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(newStatus, "Complete", StringComparison.OrdinalIgnoreCase))
            task.CompletedAt = DateTime.UtcNow;
        else if (string.Equals(oldStatus, "Complete", StringComparison.OrdinalIgnoreCase) &&
                 !string.Equals(newStatus, "Complete", StringComparison.OrdinalIgnoreCase))
            task.CompletedAt = null;

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { task.Id });
    }

    private sealed record SetTaskCompletionRequest(bool Completed);

    private static async Task<IResult> SetTaskCompletionAsync(
        int id,
        SetTaskCompletionRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var task = await db.Tasks.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (task is null) return Results.NotFound();

        task.Status = request.Completed ? "Complete" : "To Do";
        task.CompletedAt = request.Completed ? DateTime.UtcNow : null;

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new { task.Id, task.Status, task.CompletedAt });
    }

    private static async Task<IResult> DeleteTaskAsync(
        int id,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var task = await db.Tasks
            .Include(t => t.Expenses)
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken);

        if (task is null) return Results.NotFound();

        var hasPurchaseAllocations = await db.PurchaseAllocations
            .AnyAsync(a => a.TaskId == id, cancellationToken);

        if (task.Expenses.Count > 0 || hasPurchaseAllocations)
        {
            return Results.Conflict(new
            {
                message = "This task has purchase allocations attached to it. Remove or reassign them before deleting the task."
            });
        }

        db.Tasks.Remove(task);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult?> ValidateTaskRequestAsync(
        SaveTaskRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return Results.BadRequest(new { message = "Task title is required." });

        if (request.Title.Trim().Length > 300)
            return Results.BadRequest(new { message = "Task title must be 300 characters or fewer." });

        var areaNames = NormalizeAreaNames(request);

        if (areaNames.Any(area => area.Length > 100))
            return Results.BadRequest(new { message = "Each room / area must be 100 characters or fewer." });

        if (areaNames.Count > 25)
            return Results.BadRequest(new { message = "A task can have up to 25 rooms / areas." });

        if (request.EstimatedCost < 0)
            return Results.BadRequest(new { message = "Estimated cost cannot be negative." });

        var propertyExists = await db.Properties
            .AnyAsync(p => p.Id == request.PropertyId, cancellationToken);

        if (!propertyExists)
            return Results.BadRequest(new { message = "Property was not found." });

        if (request.ProjectId is not null)
        {
            var projectExists = await db.Projects.AnyAsync(
                p => p.Id == request.ProjectId && p.PropertyId == request.PropertyId,
                cancellationToken);

            if (!projectExists)
                return Results.BadRequest(new { message = "Selected project does not belong to this property." });
        }

        return null;
    }

    private static List<string> NormalizeAreaNames(SaveTaskRequest request)
    {
        var values = request.Areas is { Count: > 0 }
            ? request.Areas
            : string.IsNullOrWhiteSpace(request.Area)
                ? new List<string>()
                : new List<string> { request.Area };

        return values
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static async Task SetTaskAreasAsync(
        HomeTask task,
        SaveTaskRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var names = NormalizeAreaNames(request);

        if (task.TaskAreas.Count > 0)
        {
            db.TaskAreas.RemoveRange(task.TaskAreas);
            task.TaskAreas.Clear();
        }

        if (names.Count == 0)
        {
            task.Area = null;
            return;
        }

        var existingAreas = await db.Areas
            .Where(a => a.PropertyId == request.PropertyId && names.Contains(a.Name))
            .ToListAsync(cancellationToken);

        foreach (var name in names)
        {
            var area = existingAreas.FirstOrDefault(a =>
                string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase));

            if (area is null)
            {
                area = new Area
                {
                    PropertyId = request.PropertyId,
                    Name = name,
                    CreatedAt = DateTime.UtcNow
                };
                db.Areas.Add(area);
                existingAreas.Add(area);
            }

            task.TaskAreas.Add(new TaskArea
            {
                Task = task,
                Area = area
            });
        }

        // Keep the old Area column populated with the first value for now.
        task.Area = names[0];
    }

    private static string NormalizeStatus(string? value) =>
        value?.Trim() switch
        {
            "In Progress" => "In Progress",
            "Waiting" => "Waiting",
            "Ordered" => "Ordered",
            "Cancelled" => "Cancelled",
            "Complete" => "Complete",
            _ => "To Do"
        };

    private static string NormalizePriority(string? value) =>
        value?.Trim() switch
        {
            "Low" => "Low",
            "High" => "High",
            _ => "Normal"
        };

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
