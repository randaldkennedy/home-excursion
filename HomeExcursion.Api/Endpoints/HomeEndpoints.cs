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

        // Home Excursion is private household data. Signing into another
        // La Ultima Excursion app does NOT grant access to Home.
        // Every /api/home endpoint must belong to the household that owns
        // the Home properties, and the signed-in user must be an explicit
        // HouseholdMember of that household.
        group.AddEndpointFilter(async (context, next) =>
        {
            var httpContext = context.HttpContext;
            var homeDb = httpContext.RequestServices.GetRequiredService<HomeExcursionDbContext>();
            var platformDb = httpContext.RequestServices.GetRequiredService<LaUltimaExcursionDbContext>();

            var access = await GetHomeAccessAsync(
                httpContext,
                homeDb,
                platformDb,
                httpContext.RequestAborted);

            if (!access.IsAuthenticated)
                return Results.Unauthorized();

            if (!access.IsAuthorized)
                return Results.Json(
                    new
                    {
                        message = "This account does not have access to Home Excursion. Access is invitation-only."
                    },
                    statusCode: StatusCodes.Status403Forbidden);

            httpContext.Items[HomeHouseholdIdItemKey] = access.HouseholdId!.Value;
            return await next(context);
        });

        group.MapGet("/dashboard", GetDashboardAsync);

        group.MapGet("/properties", GetPropertiesAsync);
        group.MapPost("/properties", CreatePropertyAsync);
        group.MapPut("/properties/{id:int}", UpdatePropertyAsync);
        group.MapPost("/properties/{id:int}/photo", UploadPropertyPhotoAsync)
            .DisableAntiforgery();

        group.MapGet("/contractors", GetContractorsAsync);
        group.MapPost("/contractors", CreateContractorAsync);
        group.MapPut("/contractors/{vendorId:int}", UpdateContractorAsync);
        group.MapPost("/contractors/{vendorId:int}/contacts", CreateContractorContactAsync);
        group.MapPut("/contractors/{vendorId:int}/contacts/{contactId:int}", UpdateContractorContactAsync);
        group.MapDelete("/contractors/{vendorId:int}/contacts/{contactId:int}", DeleteContractorContactAsync);

        group.MapPost("/projects", CreateProjectAsync);
        group.MapPut("/projects/{id:int}", UpdateProjectAsync);
        group.MapGet("/projects/{id:int}/details", GetProjectDetailsAsync);
        group.MapGet("/projects/{id:int}/attachments", GetProjectAttachmentsAsync);
        group.MapPost("/projects/{id:int}/attachments", UploadProjectAttachmentAsync)
            .DisableAntiforgery();

        group.MapPost("/projects/{id:int}/contractors", CreateProjectContractorAsync);
        group.MapPut("/projects/{id:int}/contractors/{contractorId:int}", UpdateProjectContractorAsync);
        group.MapDelete("/projects/{id:int}/contractors/{contractorId:int}", DeleteProjectContractorAsync);
        group.MapPost("/projects/{id:int}/contractors/{contractorId:int}/attachments", UploadProjectContractorAttachmentAsync)
            .DisableAntiforgery();
        group.MapPost("/projects/{id:int}/contractors/{contractorId:int}/activities", CreateProjectContractorActivityAsync);
        group.MapPost("/projects/{id:int}/contractors/{contractorId:int}/proposals", CreateProjectContractorProposalAsync);
        group.MapPost("/projects/{id:int}/contractors/{contractorId:int}/proposals/{proposalId:int}/attachment", UploadProjectContractorProposalAttachmentAsync)
            .DisableAntiforgery();
        group.MapPut("/projects/{id:int}/contractors/{contractorId:int}/proposals/{proposalId:int}", UpdateProjectContractorProposalAsync);
        group.MapDelete("/projects/{id:int}/contractors/{contractorId:int}/proposals/{proposalId:int}", DeleteProjectContractorProposalAsync);

        group.MapPost("/projects/{id:int}/closure-items", CreateProjectClosureItemAsync);
        group.MapPut("/projects/{id:int}/closure-items/{itemId:int}", UpdateProjectClosureItemAsync);
        group.MapDelete("/projects/{id:int}/closure-items/{itemId:int}", DeleteProjectClosureItemAsync);

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
        int? propertyId,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var propertyQuery = db.Properties.AsNoTracking();

        var property = propertyId.HasValue
            ? await propertyQuery
                .FirstOrDefaultAsync(p => p.Id == propertyId.Value, cancellationToken)
            : await propertyQuery
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
                property.Address1,
                property.City,
                property.State,
                property.PostalCode,
                property.IsActive
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

    private sealed record SavePropertyRequest(
        string Name,
        string Address1,
        string? City,
        string? State,
        string? PostalCode,
        bool IsActive);

    private static async Task<IResult> GetPropertiesAsync(
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var properties = await db.Properties
            .AsNoTracking()
            .OrderByDescending(p => p.IsActive)
            .ThenBy(p => p.Name)
            .Select(p => new
            {
                p.Id,
                p.HouseholdId,
                p.Name,
                p.Address1,
                p.City,
                p.State,
                p.PostalCode,
                p.IsActive,
                p.CreatedAt
            })
            .ToListAsync(cancellationToken);

        var householdIds = properties.Select(p => p.HouseholdId).Distinct().ToList();
        var propertyIds = properties.Select(p => p.Id.ToString()).ToHashSet();

        var photos = await platformDb.Attachments
            .AsNoTracking()
            .Where(a =>
                a.IsActive &&
                householdIds.Contains(a.HouseholdId) &&
                a.App == "home" &&
                a.EntityType == "Property" &&
                a.Category == "property-photo" &&
                a.EntityId != null &&
                propertyIds.Contains(a.EntityId))
            .OrderByDescending(a => a.UploadedUtc)
            .Select(a => new
            {
                a.Id,
                a.EntityId,
                a.UploadedUtc
            })
            .ToListAsync(cancellationToken);

        var photoByPropertyId = photos
            .Where(a => int.TryParse(a.EntityId, out _))
            .GroupBy(a => int.Parse(a.EntityId!))
            .ToDictionary(g => g.Key, g => (int?)g.First().Id);

        return Results.Ok(properties.Select(p => new
        {
            p.Id,
            p.Name,
            p.Address1,
            p.City,
            p.State,
            p.PostalCode,
            p.IsActive,
            p.CreatedAt,
            PhotoAttachmentId = photoByPropertyId.GetValueOrDefault(p.Id)
        }));
    }

    private static async Task<IResult> CreatePropertyAsync(
        SavePropertyRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var validation = ValidatePropertyRequest(request);
        if (validation is not null)
            return validation;

        var householdId = await db.Properties
            .AsNoTracking()
            .OrderBy(p => p.Id)
            .Select(p => (int?)p.HouseholdId)
            .FirstOrDefaultAsync(cancellationToken);

        if (!householdId.HasValue)
            return Results.BadRequest(new { message = "Home Excursion needs an existing household before another house can be added." });

        var property = new Property
        {
            HouseholdId = householdId.Value,
            Name = request.Name.Trim(),
            Address1 = request.Address1.Trim(),
            City = Clean(request.City),
            State = Clean(request.State),
            PostalCode = Clean(request.PostalCode),
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow
        };

        db.Properties.Add(property);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/home/properties/{property.Id}", new { property.Id });
    }

    private static async Task<IResult> UpdatePropertyAsync(
        int id,
        SavePropertyRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var validation = ValidatePropertyRequest(request);
        if (validation is not null)
            return validation;

        var property = await db.Properties
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (property is null)
            return Results.NotFound();

        property.Name = request.Name.Trim();
        property.Address1 = request.Address1.Trim();
        property.City = Clean(request.City);
        property.State = Clean(request.State);
        property.PostalCode = Clean(request.PostalCode);
        property.IsActive = request.IsActive;

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { property.Id });
    }

    private static IResult? ValidatePropertyRequest(SavePropertyRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return Results.BadRequest(new { message = "House name is required." });

        if (request.Name.Trim().Length > 200)
            return Results.BadRequest(new { message = "House name must be 200 characters or fewer." });

        if (string.IsNullOrWhiteSpace(request.Address1))
            return Results.BadRequest(new { message = "Street address is required." });

        if (request.Address1.Trim().Length > 250)
            return Results.BadRequest(new { message = "Street address must be 250 characters or fewer." });

        if (Clean(request.City)?.Length > 100)
            return Results.BadRequest(new { message = "City must be 100 characters or fewer." });

        if (Clean(request.State)?.Length > 50)
            return Results.BadRequest(new { message = "State must be 50 characters or fewer." });

        if (Clean(request.PostalCode)?.Length > 20)
            return Results.BadRequest(new { message = "ZIP/postal code must be 20 characters or fewer." });

        return null;
    }

    private static async Task<IResult> UploadPropertyPhotoAsync(
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
            return Results.BadRequest(new { message = "Choose a photo to upload." });

        if (file.Length > MaxUploadBytes)
            return Results.BadRequest(new { message = "Property photos must be 20 MB or smaller." });

        var isImage = file.ContentType?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) == true;
        if (!isImage)
            return Results.BadRequest(new { message = "Property photos must be image files." });

        var property = await db.Properties
            .AsNoTracking()
            .Where(p => p.Id == id)
            .Select(p => new
            {
                p.Id,
                p.HouseholdId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (property is null)
            return Results.NotFound();

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers
            .AnyAsync(
                hm => hm.UserId == userId.Value && hm.HouseholdId == property.HouseholdId,
                cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        StoredAttachment stored;
        await using (var stream = file.OpenReadStream())
        {
            stored = await storage.UploadAsync(
                property.HouseholdId,
                "home",
                "property-photo",
                Path.GetFileName(file.FileName),
                file.ContentType ?? "application/octet-stream",
                stream,
                cancellationToken);
        }

        var priorPhotos = await platformDb.Attachments
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == property.HouseholdId &&
                a.App == "home" &&
                a.EntityType == "Property" &&
                a.EntityId == id.ToString() &&
                a.Category == "property-photo")
            .ToListAsync(cancellationToken);

        foreach (var prior in priorPhotos)
            prior.IsActive = false;

        var attachment = new Attachment
        {
            HouseholdId = property.HouseholdId,
            UploadedByUserId = userId.Value,
            App = "home",
            Category = "property-photo",
            EntityType = "Property",
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

        await AttachmentThumbnailHelper.EnsureCreatedAsync(
            attachment.BlobName,
            storage,
            cancellationToken);

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

    private sealed record SaveContractorRequest(
        string Name,
        string? Phone,
        string? Email,
        string? Website,
        string? Address1,
        string? Address2,
        string? City,
        string? State,
        string? PostalCode,
        string? Notes);

    private static async Task<IResult> GetContractorsAsync(
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var contractors = await db.Vendors
            .AsNoTracking()
            .Where(v => v.IsActive && v.IsContractor)
            .OrderBy(v => v.Name)
            .Select(v => new
            {
                v.Id,
                v.Name,
                v.Phone,
                v.Email,
                v.Website,
                v.Address1,
                v.Address2,
                v.City,
                v.State,
                v.PostalCode,
                v.Notes,
                Contacts = v.Contacts
                    .OrderByDescending(c => c.IsPrimary)
                    .ThenBy(c => c.Name)
                    .Select(c => new
                    {
                        c.Id,
                        c.Name,
                        c.Title,
                        c.Phone,
                        c.Email,
                        c.Notes,
                        c.IsPrimary
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        return Results.Ok(contractors);
    }

    private static async Task<IResult> CreateContractorAsync(
        SaveContractorRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var validation = ValidateContractorRequest(request);
        if (validation is not null)
            return validation;

        var vendor = new Vendor
        {
            Name = request.Name.Trim(),
            Phone = Clean(request.Phone),
            Email = Clean(request.Email),
            Website = Clean(request.Website),
            Address1 = Clean(request.Address1),
            Address2 = Clean(request.Address2),
            City = Clean(request.City),
            State = Clean(request.State),
            PostalCode = Clean(request.PostalCode),
            Notes = Clean(request.Notes),
            IsActive = true,
            IsContractor = true,
            CreatedAt = DateTime.UtcNow
        };

        db.Vendors.Add(vendor);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/home/contractors/{vendor.Id}", new { vendor.Id });
    }

    private static async Task<IResult> UpdateContractorAsync(
        int vendorId,
        SaveContractorRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var vendor = await db.Vendors
            .FirstOrDefaultAsync(v => v.Id == vendorId && v.IsActive, cancellationToken);

        if (vendor is null)
            return Results.NotFound();

        var validation = ValidateContractorRequest(request);
        if (validation is not null)
            return validation;

        vendor.Name = request.Name.Trim();
        vendor.Phone = Clean(request.Phone);
        vendor.Email = Clean(request.Email);
        vendor.Website = Clean(request.Website);
        vendor.Address1 = Clean(request.Address1);
        vendor.Address2 = Clean(request.Address2);
        vendor.City = Clean(request.City);
        vendor.State = Clean(request.State);
        vendor.PostalCode = Clean(request.PostalCode);
        vendor.Notes = Clean(request.Notes);
        vendor.IsContractor = true;

        var linkedRows = await db.ProjectContractors
            .Where(c => c.VendorId == vendorId)
            .ToListAsync(cancellationToken);

        foreach (var linked in linkedRows)
        {
            linked.Name = vendor.Name;
            linked.Phone = vendor.Phone;
            linked.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { vendor.Id });
    }

    private static IResult? ValidateContractorRequest(SaveContractorRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return Results.BadRequest(new { message = "Contractor name is required." });

        if (request.Name.Trim().Length > 200)
            return Results.BadRequest(new { message = "Contractor name must be 200 characters or fewer." });

        if (Clean(request.Phone)?.Length > 50)
            return Results.BadRequest(new { message = "Phone number must be 50 characters or fewer." });

        if (Clean(request.Email)?.Length > 254)
            return Results.BadRequest(new { message = "Email must be 254 characters or fewer." });

        if (Clean(request.Website)?.Length > 500)
            return Results.BadRequest(new { message = "Website must be 500 characters or fewer." });

        if (Clean(request.Address1)?.Length > 250 || Clean(request.Address2)?.Length > 250)
            return Results.BadRequest(new { message = "Address lines must be 250 characters or fewer." });

        if (Clean(request.City)?.Length > 100)
            return Results.BadRequest(new { message = "City must be 100 characters or fewer." });

        if (Clean(request.State)?.Length > 50)
            return Results.BadRequest(new { message = "State must be 50 characters or fewer." });

        if (Clean(request.PostalCode)?.Length > 20)
            return Results.BadRequest(new { message = "Postal code must be 20 characters or fewer." });

        if (Clean(request.Notes)?.Length > 4000)
            return Results.BadRequest(new { message = "Contractor notes must be 4,000 characters or fewer." });

        return null;
    }

    private static async Task<IResult> CreateContractorContactAsync(
        int vendorId,
        SaveVendorContactRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var vendorExists = await db.Vendors
            .AnyAsync(v => v.Id == vendorId && v.IsActive, cancellationToken);

        if (!vendorExists)
            return Results.NotFound();

        var validation = ValidateVendorContactRequest(request);
        if (validation is not null)
            return validation;

        if (request.IsPrimary)
        {
            var existingPrimary = await db.VendorContacts
                .Where(c => c.VendorId == vendorId && c.IsPrimary)
                .ToListAsync(cancellationToken);

            foreach (var existing in existingPrimary)
            {
                existing.IsPrimary = false;
                existing.UpdatedAt = DateTime.UtcNow;
            }
        }

        var contact = new VendorContact
        {
            VendorId = vendorId,
            Name = request.Name.Trim(),
            Title = Clean(request.Title),
            Phone = Clean(request.Phone),
            Email = Clean(request.Email),
            Notes = Clean(request.Notes),
            IsPrimary = request.IsPrimary,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        db.VendorContacts.Add(contact);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/home/contractors/{vendorId}/contacts/{contact.Id}",
            new { contact.Id });
    }

    private static async Task<IResult> UpdateContractorContactAsync(
        int vendorId,
        int contactId,
        SaveVendorContactRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var contact = await db.VendorContacts
            .FirstOrDefaultAsync(c => c.Id == contactId && c.VendorId == vendorId, cancellationToken);

        if (contact is null)
            return Results.NotFound();

        var validation = ValidateVendorContactRequest(request);
        if (validation is not null)
            return validation;

        if (request.IsPrimary)
        {
            var existingPrimary = await db.VendorContacts
                .Where(c => c.VendorId == vendorId && c.Id != contactId && c.IsPrimary)
                .ToListAsync(cancellationToken);

            foreach (var existing in existingPrimary)
            {
                existing.IsPrimary = false;
                existing.UpdatedAt = DateTime.UtcNow;
            }
        }

        contact.Name = request.Name.Trim();
        contact.Title = Clean(request.Title);
        contact.Phone = Clean(request.Phone);
        contact.Email = Clean(request.Email);
        contact.Notes = Clean(request.Notes);
        contact.IsPrimary = request.IsPrimary;
        contact.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { contact.Id });
    }

    private static async Task<IResult> DeleteContractorContactAsync(
        int vendorId,
        int contactId,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var contact = await db.VendorContacts
            .FirstOrDefaultAsync(c => c.Id == contactId && c.VendorId == vendorId, cancellationToken);

        if (contact is null)
            return Results.NotFound();

        db.VendorContacts.Remove(contact);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private sealed record SaveProjectRequest(
        int PropertyId,
        int? ParentProjectId,
        string Name,
        string? Status,
        string? Purpose,
        decimal? EstimatedCost,
        decimal? CommittedCost,
        string? ContractorName,
        DateOnly? TargetDate,
        string? Notes);

    private static async Task<IResult> CreateProjectAsync(
        SaveProjectRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var validation = await ValidateProjectRequestAsync(
            request,
            null,
            db,
            cancellationToken);

        if (validation is not null)
            return validation;

        var nextSortOrder = await db.Projects
            .Where(p => p.PropertyId == request.PropertyId)
            .Select(p => (int?)p.SortOrder)
            .MaxAsync(cancellationToken) ?? 0;

        var project = new HomeProject
        {
            PropertyId = request.PropertyId,
            ParentProjectId = request.ParentProjectId,
            Name = request.Name.Trim(),
            Status = NormalizeProjectStatus(request.Status),
            Purpose = Clean(request.Purpose),
            EstimatedCost = request.EstimatedCost,
            CommittedCost = request.CommittedCost,
            ContractorName = Clean(request.ContractorName),
            TargetDate = request.TargetDate,
            Notes = Clean(request.Notes),
            SortOrder = nextSortOrder + 10,
            CreatedAt = DateTime.UtcNow
        };

        if (string.Equals(project.Status, "Complete", StringComparison.OrdinalIgnoreCase))
            project.CompletedAt = DateTime.UtcNow;

        db.Projects.Add(project);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/home/projects/{project.Id}/details",
            new { project.Id });
    }

    private static async Task<IResult> UpdateProjectAsync(
        int id,
        SaveProjectRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var project = await db.Projects
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (project is null)
            return Results.NotFound();

        if (project.PropertyId != request.PropertyId)
        {
            return Results.BadRequest(new
            {
                message = "A project cannot be moved to a different property."
            });
        }

        var validation = await ValidateProjectRequestAsync(
            request,
            id,
            db,
            cancellationToken);

        if (validation is not null)
            return validation;

        var oldStatus = project.Status;
        var newStatus = NormalizeProjectStatus(request.Status);

        project.ParentProjectId = request.ParentProjectId;
        project.Name = request.Name.Trim();
        project.Status = newStatus;
        project.Purpose = Clean(request.Purpose);
        project.EstimatedCost = request.EstimatedCost;
        project.CommittedCost = request.CommittedCost;
        project.ContractorName = Clean(request.ContractorName);
        project.TargetDate = request.TargetDate;
        project.Notes = Clean(request.Notes);

        if (!string.Equals(oldStatus, "Complete", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(newStatus, "Complete", StringComparison.OrdinalIgnoreCase))
        {
            project.CompletedAt = DateTime.UtcNow;
        }
        else if (string.Equals(oldStatus, "Complete", StringComparison.OrdinalIgnoreCase) &&
                 !string.Equals(newStatus, "Complete", StringComparison.OrdinalIgnoreCase))
        {
            project.CompletedAt = null;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { project.Id });
    }

    private static async Task<IResult?> ValidateProjectRequestAsync(
        SaveProjectRequest request,
        int? existingProjectId,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return Results.BadRequest(new { message = "Project name is required." });

        if (request.Name.Trim().Length > 200)
            return Results.BadRequest(new { message = "Project name must be 200 characters or fewer." });

        if (Clean(request.Purpose)?.Length > 60)
            return Results.BadRequest(new { message = "Purpose must be 60 characters or fewer." });

        if (Clean(request.ContractorName)?.Length > 200)
            return Results.BadRequest(new { message = "Contractor / vendor must be 200 characters or fewer." });

        if (request.EstimatedCost < 0)
            return Results.BadRequest(new { message = "Estimated cost cannot be negative." });

        if (request.CommittedCost < 0)
            return Results.BadRequest(new { message = "Committed cost cannot be negative." });

        var propertyExists = await db.Properties
            .AnyAsync(p => p.Id == request.PropertyId, cancellationToken);

        if (!propertyExists)
            return Results.BadRequest(new { message = "Property was not found." });

        if (request.ParentProjectId is null)
            return null;

        if (existingProjectId == request.ParentProjectId)
            return Results.BadRequest(new { message = "A project cannot be its own parent." });

        var parentExists = await db.Projects.AnyAsync(
            p => p.Id == request.ParentProjectId &&
                 p.PropertyId == request.PropertyId,
            cancellationToken);

        if (!parentExists)
            return Results.BadRequest(new { message = "Selected parent project does not belong to this property." });

        if (existingProjectId is not null)
        {
            var descendants = await GetProjectScopeIdsAsync(
                existingProjectId.Value,
                request.PropertyId,
                db,
                cancellationToken);

            descendants.Remove(existingProjectId.Value);

            if (descendants.Contains(request.ParentProjectId.Value))
            {
                return Results.BadRequest(new
                {
                    message = "A project cannot be placed under one of its own child projects."
                });
            }
        }

        return null;
    }

    private static string NormalizeProjectStatus(string? value) =>
        value?.Trim() switch
        {
            "Research" => "Research",
            "Getting Bids" => "Getting Bids",
            "Bid Received" => "Bid Received",
            "Approved" => "Approved",
            "Scheduled" => "Scheduled",
            "In Progress" => "In Progress",
            "Waiting" => "Waiting",
            "On Hold" => "On Hold",
            "Ordered" => "Ordered",
            "Closing / Punch List" => "Closing / Punch List",
            "Closed" => "Closed",
            "Complete" => "Complete",
            "Cancelled" => "Cancelled",
            _ => "Planned"
        };

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

        var contractors = await db.ProjectContractors
            .AsNoTracking()
            .Where(c => c.ProjectId == id)
            .OrderByDescending(c => c.IsSelected)
            .ThenBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .Select(c => new
            {
                c.Id,
                c.ProjectId,
                c.VendorId,
                Name = c.Vendor != null ? c.Vendor.Name : c.Name,
                Phone = c.Vendor != null ? c.Vendor.Phone : c.Phone,
                Email = c.Vendor != null ? c.Vendor.Email : null,
                Website = c.Vendor != null ? c.Vendor.Website : null,
                Address1 = c.Vendor != null ? c.Vendor.Address1 : null,
                Address2 = c.Vendor != null ? c.Vendor.Address2 : null,
                City = c.Vendor != null ? c.Vendor.City : null,
                State = c.Vendor != null ? c.Vendor.State : null,
                PostalCode = c.Vendor != null ? c.Vendor.PostalCode : null,
                VendorNotes = c.Vendor != null ? c.Vendor.Notes : null,
                c.Status,
                c.BidAmount,
                c.Notes,
                c.IsSelected,
                c.SortOrder,
                c.CreatedAt,
                c.UpdatedAt
            })
            .ToListAsync(cancellationToken);

        var vendorIds = contractors
            .Where(c => c.VendorId.HasValue)
            .Select(c => c.VendorId!.Value)
            .Distinct()
            .ToList();

        var contacts = await db.VendorContacts
            .AsNoTracking()
            .Where(c => vendorIds.Contains(c.VendorId))
            .OrderByDescending(c => c.IsPrimary)
            .ThenBy(c => c.Name)
            .Select(c => new
            {
                c.Id,
                c.VendorId,
                c.Name,
                c.Title,
                c.Phone,
                c.Email,
                c.Notes,
                c.IsPrimary
            })
            .ToListAsync(cancellationToken);

        var projectContractorIds = contractors
            .Select(c => c.Id)
            .ToList();

        var activities = await db.ProjectContractorActivities
            .AsNoTracking()
            .Where(a => projectContractorIds.Contains(a.ProjectContractorId))
            .OrderByDescending(a => a.ActivityAt)
            .ThenByDescending(a => a.Id)
            .Select(a => new
            {
                a.Id,
                a.ProjectContractorId,
                a.ActivityType,
                a.ActivityAt,
                a.Summary,
                a.Notes
            })
            .ToListAsync(cancellationToken);

        var proposals = await db.ProjectContractorProposals
            .AsNoTracking()
            .Where(p => projectContractorIds.Contains(p.ProjectContractorId))
            .OrderByDescending(p => p.IsCurrent)
            .ThenByDescending(p => p.ReceivedDate)
            .ThenByDescending(p => p.Id)
            .Select(p => new
            {
                p.Id,
                p.ProjectContractorId,
                p.ReceivedDate,
                p.RevisionLabel,
                p.Amount,
                p.Notes,
                p.IsCurrent,
                p.CreatedAt,
                p.UpdatedAt
            })
            .ToListAsync(cancellationToken);

        var closureItems = await db.ProjectClosureItems
            .AsNoTracking()
            .Where(i => i.ProjectId == id)
            .OrderBy(i => i.SortOrder)
            .ThenBy(i => i.Id)
            .Select(i => new
            {
                i.Id,
                i.ProjectId,
                i.Description,
                i.Status,
                i.DueDate,
                i.Notes,
                i.SortOrder,
                i.CreatedAt,
                i.CompletedAt
            })
            .ToListAsync(cancellationToken);

        var purchaseEntityIds = expenses.Select(e => e.PurchaseId.ToString()).ToHashSet();
        var projectEntityIds = scopeIds.Select(x => x.ToString()).ToHashSet();
        var contractorEntityIds = contractors.Select(c => c.Id.ToString()).ToHashSet();
        var proposalEntityIds = proposals.Select(p => p.Id.ToString()).ToHashSet();

        var attachments = await platformDb.Attachments
            .AsNoTracking()
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == project.HouseholdId &&
                a.App == "home" &&
                (
                    (a.EntityType == "HomeProject" && a.EntityId != null && projectEntityIds.Contains(a.EntityId)) ||
                    (a.EntityType == "Purchase" && a.EntityId != null && purchaseEntityIds.Contains(a.EntityId)) ||
                    (a.EntityType == "ProjectContractor" && a.EntityId != null && contractorEntityIds.Contains(a.EntityId)) ||
                    (a.EntityType == "ProjectContractorProposal" && a.EntityId != null && proposalEntityIds.Contains(a.EntityId))
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
            contractors,
            contacts,
            activities,
            proposals,
            closureItems,
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

    private sealed record SaveProjectContractorRequest(
        int VendorId,
        string? Status,
        decimal? BidAmount,
        string? Notes,
        bool IsSelected);

    private static async Task<IResult> CreateProjectContractorAsync(
        int id,
        SaveProjectContractorRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var project = await db.Projects
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (project is null)
            return Results.NotFound();

        var validation = ValidateProjectContractorRequest(request);
        if (validation is not null)
            return validation;

        var vendor = await db.Vendors
            .FirstOrDefaultAsync(v => v.Id == request.VendorId && v.IsActive, cancellationToken);

        if (vendor is null)
            return Results.BadRequest(new { message = "Contractor was not found." });

        var alreadyLinked = await db.ProjectContractors
            .AnyAsync(c => c.ProjectId == id && c.VendorId == request.VendorId, cancellationToken);

        if (alreadyLinked)
            return Results.Conflict(new { message = "That contractor is already associated with this project." });

        var nextSortOrder = await db.ProjectContractors
            .Where(c => c.ProjectId == id)
            .Select(c => (int?)c.SortOrder)
            .MaxAsync(cancellationToken) ?? 0;

        if (request.IsSelected)
        {
            var selected = await db.ProjectContractors
                .Where(c => c.ProjectId == id && c.IsSelected)
                .ToListAsync(cancellationToken);

            foreach (var existing in selected)
            {
                existing.IsSelected = false;
                existing.UpdatedAt = DateTime.UtcNow;
            }
        }

        var contractor = new ProjectContractor
        {
            ProjectId = id,
            VendorId = vendor.Id,
            Name = vendor.Name,
            Phone = vendor.Phone,
            Status = NormalizeProjectContractorStatus(request.Status),
            BidAmount = request.BidAmount,
            Notes = Clean(request.Notes),
            IsSelected = request.IsSelected,
            SortOrder = nextSortOrder + 10,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        if (contractor.IsSelected)
            project.ContractorName = vendor.Name;

        db.ProjectContractors.Add(contractor);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/home/projects/{id}/contractors/{contractor.Id}",
            new { contractor.Id });
    }

    private static async Task<IResult> UpdateProjectContractorAsync(
        int id,
        int contractorId,
        SaveProjectContractorRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var contractor = await db.ProjectContractors
            .Include(c => c.Project)
            .Include(c => c.Vendor)
            .FirstOrDefaultAsync(
                c => c.Id == contractorId && c.ProjectId == id,
                cancellationToken);

        if (contractor is null)
            return Results.NotFound();

        var validation = ValidateProjectContractorRequest(request);
        if (validation is not null)
            return validation;

        if (contractor.VendorId != request.VendorId)
        {
            return Results.BadRequest(new
            {
                message = "A project-contractor record cannot be switched to a different contractor. Remove it and associate the other contractor instead."
            });
        }

        var wasSelected = contractor.IsSelected;

        if (request.IsSelected)
        {
            var selected = await db.ProjectContractors
                .Where(c => c.ProjectId == id && c.Id != contractorId && c.IsSelected)
                .ToListAsync(cancellationToken);

            foreach (var existing in selected)
            {
                existing.IsSelected = false;
                existing.UpdatedAt = DateTime.UtcNow;
            }
        }

        contractor.Status = NormalizeProjectContractorStatus(request.Status);
        contractor.BidAmount = request.BidAmount;
        contractor.Notes = Clean(request.Notes);
        contractor.IsSelected = request.IsSelected;
        contractor.UpdatedAt = DateTime.UtcNow;

        if (contractor.IsSelected)
            contractor.Project.ContractorName = contractor.Vendor?.Name ?? contractor.Name;
        else if (wasSelected)
            contractor.Project.ContractorName = null;

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { contractor.Id });
    }

    private static async Task<IResult> DeleteProjectContractorAsync(
        int id,
        int contractorId,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        var contractor = await db.ProjectContractors
            .Include(c => c.Project)
            .FirstOrDefaultAsync(
                c => c.Id == contractorId && c.ProjectId == id,
                cancellationToken);

        if (contractor is null)
            return Results.NotFound();

        var attachments = await platformDb.Attachments
            .Where(a =>
                a.IsActive &&
                a.App == "home" &&
                a.EntityType == "ProjectContractor" &&
                a.EntityId == contractorId.ToString())
            .ToListAsync(cancellationToken);

        foreach (var attachment in attachments)
        {
            await storage.DeleteAsync(attachment.BlobName, cancellationToken);
            platformDb.Attachments.Remove(attachment);
        }

        if (attachments.Count > 0)
            await platformDb.SaveChangesAsync(cancellationToken);

        if (contractor.IsSelected &&
            string.Equals(
                contractor.Project.ContractorName,
                contractor.Name,
                StringComparison.OrdinalIgnoreCase))
        {
            contractor.Project.ContractorName = null;
        }

        db.ProjectContractors.Remove(contractor);
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    private static IResult? ValidateProjectContractorRequest(
        SaveProjectContractorRequest request)
    {
        if (request.VendorId <= 0)
            return Results.BadRequest(new { message = "Choose a contractor." });

        if (request.BidAmount < 0)
            return Results.BadRequest(new { message = "Bid amount cannot be negative." });

        if (Clean(request.Notes)?.Length > 2000)
            return Results.BadRequest(new { message = "Project-contractor notes must be 2,000 characters or fewer." });

        return null;
    }

    private static string NormalizeProjectContractorStatus(string? value) =>
        value?.Trim() switch
        {
            "Contacted" => "Contacted",
            "Callback Pending" => "Callback Pending",
            "Appointment Scheduled" => "Appointment Scheduled",
            "Walkthrough Scheduled" => "Walkthrough Scheduled",
            "Awaiting Bid" => "Awaiting Bid",
            "Bid Received" => "Bid Received",
            "Revision Requested" => "Revision Requested",
            "Shortlisted" => "Shortlisted",
            "Selected" => "Selected",
            "Declined" => "Declined",
            "No Response" => "No Response",
            _ => "Considering"
        };

    private sealed record SaveVendorContactRequest(
        string Name,
        string? Title,
        string? Phone,
        string? Email,
        string? Notes,
        bool IsPrimary);

    private sealed record SaveProjectContractorActivityRequest(
        string? ActivityType,
        DateTime? ActivityAt,
        string Summary,
        string? Notes);

    private static IResult? ValidateVendorContactRequest(SaveVendorContactRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return Results.BadRequest(new { message = "Contact name is required." });

        if (request.Name.Trim().Length > 200)
            return Results.BadRequest(new { message = "Contact name must be 200 characters or fewer." });

        if (Clean(request.Title)?.Length > 120)
            return Results.BadRequest(new { message = "Contact title must be 120 characters or fewer." });

        if (Clean(request.Phone)?.Length > 50)
            return Results.BadRequest(new { message = "Contact phone must be 50 characters or fewer." });

        if (Clean(request.Email)?.Length > 254)
            return Results.BadRequest(new { message = "Contact email must be 254 characters or fewer." });

        if (Clean(request.Notes)?.Length > 2000)
            return Results.BadRequest(new { message = "Contact notes must be 2,000 characters or fewer." });

        return null;
    }

    private static async Task<IResult> CreateProjectContractorActivityAsync(
        int id,
        int contractorId,
        SaveProjectContractorActivityRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var contractorExists = await db.ProjectContractors
            .AnyAsync(c => c.Id == contractorId && c.ProjectId == id, cancellationToken);

        if (!contractorExists)
            return Results.NotFound();

        if (string.IsNullOrWhiteSpace(request.Summary))
            return Results.BadRequest(new { message = "Activity summary is required." });

        if (request.Summary.Trim().Length > 300)
            return Results.BadRequest(new { message = "Activity summary must be 300 characters or fewer." });

        if (Clean(request.Notes)?.Length > 4000)
            return Results.BadRequest(new { message = "Activity notes must be 4,000 characters or fewer." });

        var activity = new ProjectContractorActivity
        {
            ProjectContractorId = contractorId,
            ActivityType = NormalizeProjectContractorActivityType(request.ActivityType),
            ActivityAt = request.ActivityAt ?? DateTime.UtcNow,
            Summary = request.Summary.Trim(),
            Notes = Clean(request.Notes),
            CreatedAt = DateTime.UtcNow
        };

        db.ProjectContractorActivities.Add(activity);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/home/projects/{id}/contractors/{contractorId}/activities/{activity.Id}",
            new { activity.Id });
    }

    private static string NormalizeProjectContractorActivityType(string? value) =>
        value?.Trim() switch
        {
            "Called" => "Called",
            "Email" => "Email",
            "Text" => "Text",
            "Meeting" => "Meeting",
            "Walkthrough" => "Walkthrough",
            "Estimate" => "Estimate",
            _ => "Note"
        };

    private sealed record SaveProjectContractorProposalRequest(
        DateOnly ReceivedDate,
        string? RevisionLabel,
        decimal? Amount,
        string? Notes,
        bool IsCurrent);

    private static async Task<IResult> CreateProjectContractorProposalAsync(
        int id,
        int contractorId,
        SaveProjectContractorProposalRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var contractor = await db.ProjectContractors
            .FirstOrDefaultAsync(c => c.Id == contractorId && c.ProjectId == id, cancellationToken);

        if (contractor is null)
            return Results.NotFound();

        var validation = ValidateProjectContractorProposalRequest(request);
        if (validation is not null)
            return validation;

        if (request.IsCurrent)
        {
            var currentRows = await db.ProjectContractorProposals
                .Where(p => p.ProjectContractorId == contractorId && p.IsCurrent)
                .ToListAsync(cancellationToken);

            foreach (var current in currentRows)
            {
                current.IsCurrent = false;
                current.UpdatedAt = DateTime.UtcNow;
            }
        }

        var proposal = new ProjectContractorProposal
        {
            ProjectContractorId = contractorId,
            ReceivedDate = request.ReceivedDate,
            RevisionLabel = Clean(request.RevisionLabel),
            Amount = request.Amount,
            Notes = Clean(request.Notes),
            IsCurrent = request.IsCurrent,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        db.ProjectContractorProposals.Add(proposal);

        if (proposal.IsCurrent)
            contractor.BidAmount = proposal.Amount;

        contractor.Status = "Bid Received";
        contractor.UpdatedAt = DateTime.UtcNow;

        var proposalSummary = proposal.Amount.HasValue
            ? $"Proposal received - {proposal.Amount.Value:C2}"
            : "Proposal received";

        if (!string.IsNullOrWhiteSpace(proposal.RevisionLabel))
            proposalSummary += $" - {proposal.RevisionLabel}";

        db.ProjectContractorActivities.Add(new ProjectContractorActivity
        {
            ProjectContractorId = contractorId,
            ActivityType = "Estimate",
            ActivityAt = request.ReceivedDate.ToDateTime(new TimeOnly(12, 0)),
            Summary = proposalSummary,
            Notes = proposal.Notes,
            CreatedAt = DateTime.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/home/projects/{id}/contractors/{contractorId}/proposals/{proposal.Id}",
            new { proposal.Id });
    }

    private static async Task<IResult> UploadProjectContractorProposalAttachmentAsync(
        int id,
        int contractorId,
        int proposalId,
        IFormFile file,
        HttpContext httpContext,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        const long MaxUploadBytes = 20L * 1024L * 1024L;

        if (file.Length <= 0)
            return Results.BadRequest(new { message = "Choose a bid file to upload." });

        if (file.Length > MaxUploadBytes)
            return Results.BadRequest(new { message = "Bid files must be 20 MB or smaller." });

        var isImage = file.ContentType?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) == true;
        var isPdf = string.Equals(file.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase);

        if (!isImage && !isPdf)
            return Results.BadRequest(new { message = "Bid files currently support images and PDF files." });

        var proposal = await db.ProjectContractorProposals
            .AsNoTracking()
            .Where(p =>
                p.Id == proposalId &&
                p.ProjectContractorId == contractorId &&
                p.ProjectContractor.ProjectId == id)
            .Select(p => new
            {
                p.Id,
                HouseholdId = p.ProjectContractor.Project.Property.HouseholdId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (proposal is null)
            return Results.NotFound();

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers
            .AnyAsync(
                hm => hm.UserId == userId.Value && hm.HouseholdId == proposal.HouseholdId,
                cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        StoredAttachment stored;
        await using (var stream = file.OpenReadStream())
        {
            stored = await storage.UploadAsync(
                proposal.HouseholdId,
                "home",
                "bid-document",
                Path.GetFileName(file.FileName),
                file.ContentType ?? "application/octet-stream",
                stream,
                cancellationToken);
        }

        var attachment = new Attachment
        {
            HouseholdId = proposal.HouseholdId,
            UploadedByUserId = userId.Value,
            App = "home",
            Category = "bid-document",
            EntityType = "ProjectContractorProposal",
            EntityId = proposal.Id.ToString(),
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

    private static async Task<IResult> UpdateProjectContractorProposalAsync(
        int id,
        int contractorId,
        int proposalId,
        SaveProjectContractorProposalRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var proposal = await db.ProjectContractorProposals
            .Include(p => p.ProjectContractor)
            .FirstOrDefaultAsync(
                p => p.Id == proposalId &&
                     p.ProjectContractorId == contractorId &&
                     p.ProjectContractor.ProjectId == id,
                cancellationToken);

        if (proposal is null)
            return Results.NotFound();

        var validation = ValidateProjectContractorProposalRequest(request);
        if (validation is not null)
            return validation;

        if (request.IsCurrent)
        {
            var currentRows = await db.ProjectContractorProposals
                .Where(p => p.ProjectContractorId == contractorId &&
                            p.Id != proposalId &&
                            p.IsCurrent)
                .ToListAsync(cancellationToken);

            foreach (var current in currentRows)
            {
                current.IsCurrent = false;
                current.UpdatedAt = DateTime.UtcNow;
            }
        }

        proposal.ReceivedDate = request.ReceivedDate;
        proposal.RevisionLabel = Clean(request.RevisionLabel);
        proposal.Amount = request.Amount;
        proposal.Notes = Clean(request.Notes);
        proposal.IsCurrent = request.IsCurrent;
        proposal.UpdatedAt = DateTime.UtcNow;

        if (proposal.IsCurrent)
            proposal.ProjectContractor.BidAmount = proposal.Amount;

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { proposal.Id });
    }

    private static async Task<IResult> DeleteProjectContractorProposalAsync(
        int id,
        int contractorId,
        int proposalId,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var proposal = await db.ProjectContractorProposals
            .Include(p => p.ProjectContractor)
            .FirstOrDefaultAsync(
                p => p.Id == proposalId &&
                     p.ProjectContractorId == contractorId &&
                     p.ProjectContractor.ProjectId == id,
                cancellationToken);

        if (proposal is null)
            return Results.NotFound();

        var wasCurrent = proposal.IsCurrent;
        db.ProjectContractorProposals.Remove(proposal);
        await db.SaveChangesAsync(cancellationToken);

        if (wasCurrent)
        {
            var replacement = await db.ProjectContractorProposals
                .Where(p => p.ProjectContractorId == contractorId)
                .OrderByDescending(p => p.ReceivedDate)
                .ThenByDescending(p => p.Id)
                .FirstOrDefaultAsync(cancellationToken);

            var contractor = await db.ProjectContractors
                .FirstAsync(c => c.Id == contractorId, cancellationToken);

            if (replacement is not null)
            {
                replacement.IsCurrent = true;
                replacement.UpdatedAt = DateTime.UtcNow;
                contractor.BidAmount = replacement.Amount;
            }
            else
            {
                contractor.BidAmount = null;
            }

            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.NoContent();
    }

    private static IResult? ValidateProjectContractorProposalRequest(
        SaveProjectContractorProposalRequest request)
    {
        if (request.Amount < 0)
            return Results.BadRequest(new { message = "Proposal amount cannot be negative." });

        if (Clean(request.RevisionLabel)?.Length > 100)
            return Results.BadRequest(new { message = "Revision label must be 100 characters or fewer." });

        if (Clean(request.Notes)?.Length > 4000)
            return Results.BadRequest(new { message = "Proposal notes must be 4,000 characters or fewer." });

        return null;
    }

    private sealed record SaveProjectClosureItemRequest(
        string Description,
        string? Status,
        DateOnly? DueDate,
        string? Notes,
        int? SortOrder);

    private static async Task<IResult> CreateProjectClosureItemAsync(
        int id,
        SaveProjectClosureItemRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var projectExists = await db.Projects
            .AnyAsync(p => p.Id == id, cancellationToken);

        if (!projectExists)
            return Results.NotFound();

        var validation = ValidateProjectClosureItemRequest(request);
        if (validation is not null)
            return validation;

        var nextSortOrder = request.SortOrder ??
            ((await db.ProjectClosureItems
                .Where(i => i.ProjectId == id)
                .Select(i => (int?)i.SortOrder)
                .MaxAsync(cancellationToken)) ?? 0) + 10;

        var status = NormalizeProjectClosureItemStatus(request.Status);

        var item = new ProjectClosureItem
        {
            ProjectId = id,
            Description = request.Description.Trim(),
            Status = status,
            DueDate = request.DueDate,
            Notes = Clean(request.Notes),
            SortOrder = nextSortOrder,
            CreatedAt = DateTime.UtcNow,
            CompletedAt = status == "Complete" ? DateTime.UtcNow : null
        };

        db.ProjectClosureItems.Add(item);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/home/projects/{id}/closure-items/{item.Id}",
            new { item.Id });
    }

    private static async Task<IResult> UpdateProjectClosureItemAsync(
        int id,
        int itemId,
        SaveProjectClosureItemRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var item = await db.ProjectClosureItems
            .FirstOrDefaultAsync(i => i.Id == itemId && i.ProjectId == id, cancellationToken);

        if (item is null)
            return Results.NotFound();

        var validation = ValidateProjectClosureItemRequest(request);
        if (validation is not null)
            return validation;

        var oldStatus = item.Status;
        var newStatus = NormalizeProjectClosureItemStatus(request.Status);

        item.Description = request.Description.Trim();
        item.Status = newStatus;
        item.DueDate = request.DueDate;
        item.Notes = Clean(request.Notes);
        if (request.SortOrder.HasValue)
            item.SortOrder = request.SortOrder.Value;

        if (oldStatus != "Complete" && newStatus == "Complete")
            item.CompletedAt = DateTime.UtcNow;
        else if (oldStatus == "Complete" && newStatus != "Complete")
            item.CompletedAt = null;

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { item.Id });
    }

    private static async Task<IResult> DeleteProjectClosureItemAsync(
        int id,
        int itemId,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var item = await db.ProjectClosureItems
            .FirstOrDefaultAsync(i => i.Id == itemId && i.ProjectId == id, cancellationToken);

        if (item is null)
            return Results.NotFound();

        db.ProjectClosureItems.Remove(item);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static IResult? ValidateProjectClosureItemRequest(
        SaveProjectClosureItemRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Description))
            return Results.BadRequest(new { message = "Closure item description is required." });

        if (request.Description.Trim().Length > 300)
            return Results.BadRequest(new { message = "Closure item description must be 300 characters or fewer." });

        if (Clean(request.Notes)?.Length > 4000)
            return Results.BadRequest(new { message = "Closure item notes must be 4,000 characters or fewer." });

        return null;
    }

    private static string NormalizeProjectClosureItemStatus(string? value) =>
        value?.Trim() switch
        {
            "In Progress" => "In Progress",
            "Waiting" => "Waiting",
            "Complete" => "Complete",
            "Cancelled" => "Cancelled",
            _ => "Planned"
        };

    private static async Task<IResult> UploadProjectContractorAttachmentAsync(
        int id,
        int contractorId,
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
            return Results.BadRequest(new { message = "Contractor files currently support images and PDF files." });

        var contractor = await db.ProjectContractors
            .AsNoTracking()
            .Where(c => c.Id == contractorId && c.ProjectId == id)
            .Select(c => new
            {
                c.Id,
                HouseholdId = c.Project.Property.HouseholdId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (contractor is null)
            return Results.NotFound();

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers
            .AnyAsync(
                hm => hm.UserId == userId.Value && hm.HouseholdId == contractor.HouseholdId,
                cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        StoredAttachment stored;
        await using (var stream = file.OpenReadStream())
        {
            stored = await storage.UploadAsync(
                contractor.HouseholdId,
                "home",
                "project-contractor-document",
                Path.GetFileName(file.FileName),
                file.ContentType ?? "application/octet-stream",
                stream,
                cancellationToken);
        }

        var attachment = new Attachment
        {
            HouseholdId = contractor.HouseholdId,
            UploadedByUserId = userId.Value,
            App = "home",
            Category = "project-contractor-document",
            EntityType = "ProjectContractor",
            EntityId = contractorId.ToString(),
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

    private const string HomeHouseholdIdItemKey = "HomeExcursion.HouseholdId";

    private sealed record HomeAccessResult(
        bool IsAuthenticated,
        bool IsAuthorized,
        int? HouseholdId);

    private static async Task<HomeAccessResult> GetHomeAccessAsync(
        HttpContext httpContext,
        HomeExcursionDbContext homeDb,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var userId = await GetCurrentUserIdAsync(
            httpContext,
            platformDb,
            cancellationToken);

        if (!userId.HasValue)
            return new HomeAccessResult(false, false, null);

        // Home currently represents one private household with multiple
        // properties. Use the household already attached to the Home data
        // rather than granting access based on membership in any household.
        var homeHouseholdId = await homeDb.Properties
            .AsNoTracking()
            .OrderBy(p => p.Id)
            .Select(p => (int?)p.HouseholdId)
            .FirstOrDefaultAsync(cancellationToken);

        if (!homeHouseholdId.HasValue)
            return new HomeAccessResult(true, false, null);

        var isMember = await platformDb.HouseholdMembers
            .AsNoTracking()
            .AnyAsync(
                hm => hm.UserId == userId.Value &&
                      hm.HouseholdId == homeHouseholdId.Value,
                cancellationToken);

        return new HomeAccessResult(
            true,
            isMember,
            homeHouseholdId);
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
