using HomeExcursion.Api.Data;
using HomeExcursion.Api.Models;
using HomeExcursion.Api.Services.Attachments;
using Microsoft.EntityFrameworkCore;

namespace HomeExcursion.Api.Endpoints;

public static class PurchaseEndpoints
{
    private const string EntraObjectIdClaim =
        "http://schemas.microsoft.com/identity/claims/objectidentifier";

    public static RouteGroupBuilder MapPurchaseEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/purchases", GetPurchasesAsync);
        group.MapGet("/purchases/{id:int}", GetPurchaseAsync);
        group.MapPost("/purchases", CreatePurchaseAsync);
        group.MapPut("/purchases/{id:int}", UpdatePurchaseAsync);
        group.MapPost("/purchases/{id:int}/verify", VerifyPurchaseAsync);
        group.MapDelete("/purchases/{id:int}", DeletePurchaseAsync);
        group.MapPost("/purchases/{id:int}/attachments", UploadPurchaseAttachmentAsync)
            .DisableAntiforgery();

        return group;
    }

    private sealed record SaveAllocationRequest(
        int? Id,
        int? ProjectId,
        int? TaskId,
        decimal Amount,
        string Description,
        string? Category,
        string? AllocationType,
        bool? IsIncludedInHomeSpend,
        string? Notes);

    private sealed record SavePurchaseRequest(
        int PropertyId,
        int? VendorId,
        string? Vendor,
        DateOnly? PurchaseDate,
        decimal? Subtotal,
        decimal? Tax,
        decimal Total,
        string? Notes,
        bool AllowPossibleDuplicate,
        List<SaveAllocationRequest>? Allocations);

    private static async Task<IResult> GetPurchasesAsync(
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

        var purchases = await db.Purchases
            .AsNoTracking()
            .Where(p => p.PropertyId == property.Id)
            .Include(p => p.Allocations)
                .ThenInclude(a => a.Project)
            .Include(p => p.Allocations)
                .ThenInclude(a => a.Task)
            .Include(p => p.VendorRecord)
            .OrderByDescending(p => p.PurchaseDate)
            .ThenByDescending(p => p.Id)
            .ToListAsync(cancellationToken);

        var purchaseIds = purchases.Select(p => p.Id.ToString()).ToHashSet();
        var attachments = await platformDb.Attachments
            .AsNoTracking()
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == property.HouseholdId &&
                a.App == "home" &&
                a.EntityType == "Purchase" &&
                a.EntityId != null &&
                purchaseIds.Contains(a.EntityId))
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

        return Results.Ok(purchases.Select(p => ToPurchaseDto(
            p,
            attachments.Where(a => a.EntityId == p.Id.ToString()).Cast<object>().ToList())));
    }

    private static async Task<IResult> GetPurchaseAsync(
        int id,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var purchase = await db.Purchases
            .AsNoTracking()
            .Include(p => p.Property)
            .Include(p => p.VendorRecord)
            .Include(p => p.Allocations)
                .ThenInclude(a => a.Project)
            .Include(p => p.Allocations)
                .ThenInclude(a => a.Task)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (purchase is null) return Results.NotFound();

        var attachments = await platformDb.Attachments
            .AsNoTracking()
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == purchase.Property.HouseholdId &&
                a.App == "home" &&
                a.EntityType == "Purchase" &&
                a.EntityId == id.ToString())
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

        return Results.Ok(ToPurchaseDto(purchase, attachments.Cast<object>().ToList()));
    }

    private static object ToPurchaseDto(Purchase p, List<object> attachments)
    {
        var allocated = p.Allocations.Sum(a => a.Amount);
        var homeSpend = p.Allocations.Where(a => a.IsIncludedInHomeSpend).Sum(a => a.Amount);
        var excluded = p.Allocations.Where(a => !a.IsIncludedInHomeSpend).Sum(a => a.Amount);

        return new
        {
            p.Id,
            p.PropertyId,
            p.VendorId,
            VendorName = p.VendorRecord != null ? p.VendorRecord.Name : p.Vendor,
            p.Vendor,
            p.PurchaseDate,
            p.Subtotal,
            p.Tax,
            p.Total,
            p.Status,
            p.Source,
            p.Notes,
            p.CreatedAt,
            p.VerifiedAt,
            Allocated = allocated,
            HomeSpend = homeSpend,
            Excluded = excluded,
            Difference = p.Total - allocated,
            HasUnassigned = p.Allocations.Any(a => a.AllocationType == "Unassigned"),
            Allocations = p.Allocations
                .OrderBy(a => a.Id)
                .Select(a => new
                {
                    a.Id,
                    a.ProjectId,
                    ProjectName = a.Project != null ? a.Project.Name : null,
                    a.TaskId,
                    TaskTitle = a.Task != null ? a.Task.Title : null,
                    a.Amount,
                    a.Description,
                    a.Category,
                    a.AllocationType,
                    a.IsIncludedInHomeSpend,
                    a.SuggestedBy,
                    a.Confidence,
                    a.IsVerified,
                    a.Notes
                }),
            Attachments = attachments
        };
    }

    private static async Task<IResult> CreatePurchaseAsync(
        SavePurchaseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var validation = await ValidatePurchaseRequestAsync(request, db, cancellationToken);
        if (validation is not null) return validation;

        var duplicateCandidates = await FindDuplicateCandidatesAsync(request, null, db, cancellationToken);
        if (duplicateCandidates.Count > 0 && !request.AllowPossibleDuplicate)
        {
            return Results.Conflict(new
            {
                message = "This looks like a purchase that may already be in Home Excursion.",
                possibleDuplicate = true,
                duplicates = duplicateCandidates
            });
        }

        var purchase = new Purchase
        {
            PropertyId = request.PropertyId,
            VendorId = request.VendorId,
            Vendor = Clean(request.Vendor),
            PurchaseDate = request.PurchaseDate,
            Subtotal = request.Subtotal,
            Tax = request.Tax,
            Total = request.Total,
            Status = "Unreviewed",
            Source = "Manual",
            Notes = Clean(request.Notes),
            CreatedAt = DateTime.UtcNow
        };

        db.Purchases.Add(purchase);
        await ReplaceAllocationsAsync(purchase, request, db, cancellationToken);
        purchase.Status = DetermineReviewStatus(purchase);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/home/purchases/{purchase.Id}", new { purchase.Id });
    }

    private static async Task<IResult> UpdatePurchaseAsync(
        int id,
        SavePurchaseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var purchase = await db.Purchases
            .Include(p => p.Allocations)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (purchase is null) return Results.NotFound();

        var validation = await ValidatePurchaseRequestAsync(request, db, cancellationToken);
        if (validation is not null) return validation;

        var duplicateCandidates = await FindDuplicateCandidatesAsync(request, id, db, cancellationToken);
        if (duplicateCandidates.Count > 0 && !request.AllowPossibleDuplicate)
        {
            return Results.Conflict(new
            {
                message = "This looks like another purchase already in Home Excursion.",
                possibleDuplicate = true,
                duplicates = duplicateCandidates
            });
        }

        purchase.PropertyId = request.PropertyId;
        purchase.VendorId = request.VendorId;
        purchase.Vendor = Clean(request.Vendor);
        purchase.PurchaseDate = request.PurchaseDate;
        purchase.Subtotal = request.Subtotal;
        purchase.Tax = request.Tax;
        purchase.Total = request.Total;
        purchase.Notes = Clean(request.Notes);
        purchase.VerifiedAt = null;

        await ReplaceAllocationsAsync(purchase, request, db, cancellationToken);
        purchase.Status = DetermineReviewStatus(purchase);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new { purchase.Id, purchase.Status });
    }

    private static async Task<IResult> VerifyPurchaseAsync(
        int id,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var purchase = await db.Purchases
            .Include(p => p.Allocations)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (purchase is null) return Results.NotFound();

        var allocated = purchase.Allocations.Sum(a => a.Amount);
        if (allocated != purchase.Total)
        {
            return Results.Conflict(new
            {
                message = $"Receipt does not reconcile. Difference: {(purchase.Total - allocated):C2}."
            });
        }

        if (purchase.Allocations.Count == 0 || purchase.Allocations.Any(a => a.AllocationType == "Unassigned"))
        {
            return Results.Conflict(new
            {
                message = "Assign every dollar before verifying this receipt."
            });
        }

        purchase.Status = "Verified";
        purchase.VerifiedAt = DateTime.UtcNow;
        foreach (var allocation in purchase.Allocations)
            allocation.IsVerified = true;

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { purchase.Id, purchase.Status, purchase.VerifiedAt });
    }

    private static async Task<IResult> DeletePurchaseAsync(
        int id,
        HttpContext httpContext,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        var purchase = await db.Purchases
            .Include(p => p.Property)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (purchase is null) return Results.NotFound();

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue) return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers.AnyAsync(
            hm => hm.UserId == userId.Value && hm.HouseholdId == purchase.Property.HouseholdId,
            cancellationToken);
        if (!hasAccess) return Results.NotFound();

        var entityId = id.ToString();
        var attachments = await platformDb.Attachments
            .Where(a => a.IsActive &&
                        a.HouseholdId == purchase.Property.HouseholdId &&
                        a.App == "home" &&
                        a.EntityType == "Purchase" &&
                        a.EntityId == entityId)
            .ToListAsync(cancellationToken);

        foreach (var attachment in attachments)
        {
            await storage.DeleteAsync(
                AttachmentThumbnailHelper.GetThumbnailBlobName(attachment.BlobName), cancellationToken);
            await storage.DeleteAsync(attachment.BlobName, cancellationToken);
        }

        if (attachments.Count > 0)
        {
            platformDb.Attachments.RemoveRange(attachments);
            await platformDb.SaveChangesAsync(cancellationToken);
        }

        db.Purchases.Remove(purchase);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> UploadPurchaseAttachmentAsync(
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
            return Results.BadRequest(new { message = "Purchase receipts currently support images and PDF files." });

        var purchase = await db.Purchases
            .AsNoTracking()
            .Where(p => p.Id == id)
            .Select(p => new { p.Id, HouseholdId = p.Property.HouseholdId })
            .FirstOrDefaultAsync(cancellationToken);
        if (purchase is null) return Results.NotFound();

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue) return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers.AnyAsync(
            hm => hm.UserId == userId.Value && hm.HouseholdId == purchase.HouseholdId,
            cancellationToken);
        if (!hasAccess) return Results.NotFound();

        StoredAttachment stored;
        await using (var stream = file.OpenReadStream())
        {
            stored = await storage.UploadAsync(
                purchase.HouseholdId,
                "home",
                "purchase-receipt",
                Path.GetFileName(file.FileName),
                file.ContentType ?? "application/octet-stream",
                stream,
                cancellationToken);
        }

        var attachment = new Attachment
        {
            HouseholdId = purchase.HouseholdId,
            UploadedByUserId = userId.Value,
            App = "home",
            Category = "purchase-receipt",
            EntityType = "Purchase",
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
                attachment.BlobName, storage, cancellationToken);
        }

        return Results.Created($"/api/attachments/{attachment.Id}", new
        {
            attachment.Id,
            attachment.FileName,
            attachment.ContentType,
            attachment.FileSizeBytes,
            attachment.UploadedUtc
        });
    }

    private static async Task<IResult?> ValidatePurchaseRequestAsync(
        SavePurchaseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Total < 0)
            return Results.BadRequest(new { message = "Receipt total cannot be negative." });
        if (request.Subtotal < 0 || request.Tax < 0)
            return Results.BadRequest(new { message = "Subtotal and tax cannot be negative." });
        if (request.Vendor?.Trim().Length > 200)
            return Results.BadRequest(new { message = "Vendor must be 200 characters or fewer." });

        var propertyExists = await db.Properties.AnyAsync(
            p => p.Id == request.PropertyId, cancellationToken);
        if (!propertyExists)
            return Results.BadRequest(new { message = "Property was not found." });

        if (request.VendorId is not null)
        {
            var vendorExists = await db.Vendors.AnyAsync(v => v.Id == request.VendorId, cancellationToken);
            if (!vendorExists)
                return Results.BadRequest(new { message = "Vendor was not found." });
        }

        foreach (var allocation in request.Allocations ?? new())
        {
            if (allocation.Amount < 0)
                return Results.BadRequest(new { message = "Allocation amounts cannot be negative." });
            if (string.IsNullOrWhiteSpace(allocation.Description))
                return Results.BadRequest(new { message = "Each allocation needs a description." });
            if (allocation.Description.Trim().Length > 300)
                return Results.BadRequest(new { message = "Allocation descriptions must be 300 characters or fewer." });
            if (!ValidAllocationTypes.Contains(NormalizeAllocationType(allocation.AllocationType)))
                return Results.BadRequest(new { message = "Allocation type is invalid." });

            if (allocation.ProjectId is not null)
            {
                var projectExists = await db.Projects.AnyAsync(
                    p => p.Id == allocation.ProjectId && p.PropertyId == request.PropertyId,
                    cancellationToken);
                if (!projectExists)
                    return Results.BadRequest(new { message = "An allocation points to a project outside this property." });
            }

            if (allocation.TaskId is not null)
            {
                var task = await db.Tasks
                    .AsNoTracking()
                    .Where(t => t.Id == allocation.TaskId && t.PropertyId == request.PropertyId)
                    .Select(t => new { t.Id, t.ProjectId })
                    .FirstOrDefaultAsync(cancellationToken);
                if (task is null)
                    return Results.BadRequest(new { message = "An allocation points to a task outside this property." });
                if (allocation.ProjectId is not null && task.ProjectId is not null && allocation.ProjectId != task.ProjectId)
                    return Results.BadRequest(new { message = "An allocation task belongs to a different project." });
            }
        }

        return null;
    }

    private static async Task ReplaceAllocationsAsync(
        Purchase purchase,
        SavePurchaseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        if (purchase.Allocations.Count > 0)
        {
            db.PurchaseAllocations.RemoveRange(purchase.Allocations);
            purchase.Allocations.Clear();
        }

        var requests = request.Allocations ?? new List<SaveAllocationRequest>();
        if (requests.Count == 0)
        {
            purchase.Allocations.Add(new PurchaseAllocation
            {
                Amount = request.Total,
                Description = "Unassigned purchase",
                AllocationType = "Unassigned",
                IsIncludedInHomeSpend = true,
                SuggestedBy = "User",
                IsVerified = false,
                CreatedAt = DateTime.UtcNow
            });
            return;
        }

        foreach (var item in requests)
        {
            var projectId = item.ProjectId;
            if (item.TaskId is not null && projectId is null)
            {
                projectId = await db.Tasks
                    .Where(t => t.Id == item.TaskId)
                    .Select(t => t.ProjectId)
                    .FirstOrDefaultAsync(cancellationToken);
            }

            var type = NormalizeAllocationType(item.AllocationType);
            purchase.Allocations.Add(new PurchaseAllocation
            {
                ProjectId = projectId,
                TaskId = item.TaskId,
                Amount = item.Amount,
                Description = item.Description.Trim(),
                Category = Clean(item.Category),
                AllocationType = type,
                IsIncludedInHomeSpend = type == "PersonalExcluded"
                    ? false
                    : item.IsIncludedInHomeSpend ?? true,
                SuggestedBy = "User",
                IsVerified = false,
                Notes = Clean(item.Notes),
                CreatedAt = DateTime.UtcNow
            });
        }
    }

    private static string DetermineReviewStatus(Purchase purchase)
    {
        if (purchase.Allocations.Count == 0 || purchase.Allocations.Any(a => a.AllocationType == "Unassigned"))
            return "Unreviewed";

        return "Needs Review";
    }

    private static readonly HashSet<string> ValidAllocationTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "Task", "Project", "GeneralHome", "Maintenance", "TaxFee", "PersonalExcluded", "Unassigned"
    };

    private static string NormalizeAllocationType(string? value) => value?.Trim() switch
    {
        "Task" => "Task",
        "Project" => "Project",
        "GeneralHome" => "GeneralHome",
        "Maintenance" => "Maintenance",
        "TaxFee" => "TaxFee",
        "PersonalExcluded" => "PersonalExcluded",
        _ => "Unassigned"
    };

    private static async Task<List<object>> FindDuplicateCandidatesAsync(
        SavePurchaseRequest request,
        int? excludePurchaseId,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var query = db.Purchases
            .AsNoTracking()
            .Where(p => p.PropertyId == request.PropertyId && p.Total == request.Total);

        if (excludePurchaseId is not null)
            query = query.Where(p => p.Id != excludePurchaseId.Value);

        if (request.PurchaseDate is not null)
        {
            var from = request.PurchaseDate.Value.AddDays(-2);
            var to = request.PurchaseDate.Value.AddDays(2);
            query = query.Where(p => p.PurchaseDate != null && p.PurchaseDate >= from && p.PurchaseDate <= to);
        }
        else
        {
            query = query.Where(p => p.PurchaseDate == null);
        }

        var rows = await query
            .Include(p => p.VendorRecord)
            .OrderByDescending(p => p.PurchaseDate)
            .ThenByDescending(p => p.Id)
            .Take(10)
            .ToListAsync(cancellationToken);

        var wantedVendor = NormalizeVendor(request.Vendor);
        var result = new List<object>();

        foreach (var p in rows)
        {
            var candidateVendor = NormalizeVendor(p.VendorRecord?.Name ?? p.Vendor);
            var sameVendor = !string.IsNullOrEmpty(wantedVendor) && wantedVendor == candidateVendor;
            var sameDate = request.PurchaseDate == p.PurchaseDate;

            if (!sameVendor && !string.IsNullOrEmpty(wantedVendor))
                continue;

            var level = sameVendor && sameDate ? "High" : "Medium";
            result.Add(new
            {
                p.Id,
                Vendor = p.VendorRecord?.Name ?? p.Vendor,
                p.PurchaseDate,
                p.Total,
                p.Status,
                Level = level
            });
        }

        return result;
    }

    private static string NormalizeVendor(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        return new string(value
            .ToLowerInvariant()
            .Where(char.IsLetterOrDigit)
            .ToArray());
    }

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static async Task<int?> GetCurrentUserIdAsync(
        HttpContext httpContext,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var entraObjectId =
            httpContext.User.FindFirst(EntraObjectIdClaim)?.Value
            ?? httpContext.User.FindFirst("oid")?.Value;

        if (string.IsNullOrWhiteSpace(entraObjectId)) return null;

        return await platformDb.Users
            .Where(u => u.EntraObjectId == entraObjectId)
            .Select(u => (int?)u.Id)
            .SingleOrDefaultAsync(cancellationToken);
    }
}
