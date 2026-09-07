using System.Globalization;
using System.Text.Json;
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
        group.MapPost("/purchases/quick-receipt", CreateQuickReceiptAsync)
            .DisableAntiforgery();
        group.MapPost("/purchases/item-aliases/resolve", ResolvePurchaseItemAliasesAsync);
        group.MapPut("/purchases/item-aliases", SavePurchaseItemAliasAsync);
        group.MapPut("/purchases/{id:int}/line-items", SavePurchaseLineItemsAsync);
        group.MapPut("/purchases/{id:int}", UpdatePurchaseAsync);
        group.MapPost("/purchases/{id:int}/verify", VerifyPurchaseAsync);
        group.MapDelete("/purchases/{id:int}", DeletePurchaseAsync);
        group.MapPost("/purchases/bulk-delete", BulkDeletePurchasesAsync);
        group.MapPost("/purchases/{id:int}/attachments", UploadPurchaseAttachmentAsync)
            .DisableAntiforgery();

        return group;
    }

    private sealed record SaveAllocationRequest(
        int? Id,
        int? ProjectId,
        int? TaskId,
        int? PurchaseLineItemId,
        decimal Amount,
        string Description,
        string? Category,
        string? AllocationType,
        bool? IsIncludedInHomeSpend,
        string? Notes);

    private sealed record SavePurchaseLineItemRequest(
        string ReceiptText,
        string? DisplayName,
        decimal? Quantity,
        decimal? UnitPrice,
        decimal? LineTotal);

    private sealed record SavePurchaseLineItemsRequest(
        decimal? Subtotal,
        decimal? Tax,
        decimal? Total,
        List<SavePurchaseLineItemRequest>? LineItems);

    private sealed record ResolvePurchaseItemAliasesRequest(
        List<string>? ReceiptTexts);

    private sealed record SavePurchaseItemAliasRequest(
        string ReceiptText,
        string DisplayName);

    private sealed record BulkDeletePurchasesRequest(
        List<int>? PurchaseIds);

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
            .Include(p => p.LineItems)
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
            .Include(p => p.LineItems)
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
            CanBulkDelete = !p.Allocations.Any(a => a.ProjectId != null || a.TaskId != null),
            Allocations = p.Allocations
                .OrderBy(a => a.Id)
                .Select(a => new
                {
                    a.Id,
                    a.ProjectId,
                    ProjectName = a.Project != null ? a.Project.Name : null,
                    a.TaskId,
                    TaskTitle = a.Task != null ? a.Task.Title : null,
                    a.PurchaseLineItemId,
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
            LineItems = p.LineItems
                .OrderBy(i => i.SortOrder)
                .ThenBy(i => i.Id)
                .Select(i => new
                {
                    i.Id,
                    i.ReceiptText,
                    i.DisplayName,
                    i.Quantity,
                    i.UnitPrice,
                    i.LineTotal,
                    i.SortOrder
                }),
            Attachments = attachments
        };
    }

    private static async Task<IResult> ResolvePurchaseItemAliasesAsync(
        ResolvePurchaseItemAliasesRequest request,
        HttpContext httpContext,
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

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers.AnyAsync(
            hm => hm.UserId == userId.Value && hm.HouseholdId == property.HouseholdId,
            cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        var requested = (request.ReceiptTexts ?? [])
            .Select(text => Clean(text))
            .Where(text => !string.IsNullOrWhiteSpace(text))
            .Select(text => text!)
            .Where(text => text.Length <= 300)
            .Take(100)
            .Select(text => new
            {
                ReceiptText = text,
                Normalized = NormalizeReceiptItemText(text)
            })
            .Where(item => !string.IsNullOrWhiteSpace(item.Normalized))
            .GroupBy(item => item.Normalized, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();

        if (requested.Count == 0)
            return Results.Ok(new { aliases = Array.Empty<object>() });

        var normalizedValues = requested
            .Select(item => item.Normalized)
            .ToList();

        var aliases = await db.PurchaseItemAliases
            .AsNoTracking()
            .Where(a =>
                a.HouseholdId == property.HouseholdId &&
                normalizedValues.Contains(a.NormalizedReceiptText))
            .Select(a => new
            {
                a.ReceiptText,
                a.NormalizedReceiptText,
                a.DisplayName
            })
            .ToListAsync(cancellationToken);

        return Results.Ok(new { aliases });
    }

    private static async Task<IResult> SavePurchaseItemAliasAsync(
        SavePurchaseItemAliasRequest request,
        HttpContext httpContext,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var receiptText = Clean(request.ReceiptText);
        var displayName = Clean(request.DisplayName);

        if (receiptText is null)
            return Results.BadRequest(new { message = "Receipt text is required." });

        if (displayName is null)
            return Results.BadRequest(new { message = "Display name is required." });

        if (receiptText.Length > 300 || displayName.Length > 300)
            return Results.BadRequest(new { message = "Item names must be 300 characters or fewer." });

        var normalized = NormalizeReceiptItemText(receiptText);
        if (string.IsNullOrWhiteSpace(normalized))
            return Results.BadRequest(new { message = "Receipt text is invalid." });

        var property = await db.Properties
            .AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.Id)
            .Select(p => new { p.Id, p.HouseholdId })
            .FirstOrDefaultAsync(cancellationToken);

        if (property is null)
            return Results.NotFound(new { message = "No active Home Excursion property was found." });

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers.AnyAsync(
            hm => hm.UserId == userId.Value && hm.HouseholdId == property.HouseholdId,
            cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        var existing = await db.PurchaseItemAliases
            .SingleOrDefaultAsync(
                a => a.HouseholdId == property.HouseholdId &&
                     a.NormalizedReceiptText == normalized,
                cancellationToken);

        // If the edited name is effectively the same as the receipt text,
        // remove any old alias and fall back to the raw receipt wording.
        if (NormalizeReceiptItemText(displayName) == normalized)
        {
            if (existing is not null)
            {
                db.PurchaseItemAliases.Remove(existing);
                await db.SaveChangesAsync(cancellationToken);
            }

            return Results.Ok(new
            {
                receiptText,
                displayName = receiptText,
                remembered = false
            });
        }

        if (existing is null)
        {
            existing = new PurchaseItemAlias
            {
                HouseholdId = property.HouseholdId,
                ReceiptText = receiptText,
                NormalizedReceiptText = normalized,
                DisplayName = displayName,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            db.PurchaseItemAliases.Add(existing);
        }
        else
        {
            existing.ReceiptText = receiptText;
            existing.DisplayName = displayName;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new
        {
            existing.ReceiptText,
            existing.DisplayName,
            remembered = true
        });
    }

    private static async Task<IResult> SavePurchaseLineItemsAsync(
        int id,
        SavePurchaseLineItemsRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var purchase = await db.Purchases
            .Include(p => p.LineItems)
            .Include(p => p.Allocations)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (purchase is null)
            return Results.NotFound();

        // "Read receipt items" is an explicit rebuild of item-level reconciliation.
        // Any existing allocations are replaced below so old whole-receipt or
        // partially-created item allocations cannot be counted twice.
        var validation = ValidateLineItems(request.LineItems);
        if (validation is not null)
            return validation;

        if (request.Total is not null && request.Total <= 0)
            return Results.BadRequest(new { message = "Receipt total must be greater than zero." });

        if (request.Subtotal is not null && request.Subtotal < 0)
            return Results.BadRequest(new { message = "Receipt subtotal cannot be negative." });

        if (request.Tax is not null && request.Tax < 0)
            return Results.BadRequest(new { message = "Receipt tax / fees cannot be negative." });

        // Reading receipt items is an explicit conversion from old whole-receipt
        // allocations to item-level reconciliation. Remove the old unlinked
        // allocations so the same dollars are not counted twice.
        if (purchase.Allocations.Count > 0)
        {
            db.PurchaseAllocations.RemoveRange(purchase.Allocations);
            purchase.Allocations.Clear();
        }

        db.PurchaseLineItems.RemoveRange(purchase.LineItems);
        purchase.LineItems.Clear();

        if (request.Subtotal is not null)
            purchase.Subtotal = request.Subtotal;

        if (request.Tax is not null)
            purchase.Tax = request.Tax;

        if (request.Total is not null)
            purchase.Total = request.Total.Value;

        purchase.Status = "Unreviewed";
        purchase.VerifiedAt = null;

        var sortOrder = 10;
        foreach (var item in request.LineItems ?? [])
        {
            var receiptText = Clean(item.ReceiptText)!;
            var displayName = Clean(item.DisplayName) ?? receiptText;

            purchase.LineItems.Add(new PurchaseLineItem
            {
                ReceiptText = receiptText,
                DisplayName = displayName,
                Quantity = item.Quantity,
                UnitPrice = item.UnitPrice,
                LineTotal = item.LineTotal,
                SortOrder = sortOrder,
                CreatedAt = DateTime.UtcNow
            });

            sortOrder += 10;
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new
        {
            purchase.Id,
            lineItemCount = purchase.LineItems.Count
        });
    }

    private static IResult? ValidateLineItems(List<SavePurchaseLineItemRequest>? lineItems)
    {
        if (lineItems is null)
            return null;

        if (lineItems.Count > 100)
            return Results.BadRequest(new { message = "A receipt can contain at most 100 line items." });

        foreach (var item in lineItems)
        {
            var receiptText = Clean(item.ReceiptText);
            var displayName = Clean(item.DisplayName);

            if (receiptText is null)
                return Results.BadRequest(new { message = "Every receipt item needs a description." });

            if (receiptText.Length > 300 || (displayName?.Length ?? 0) > 300)
                return Results.BadRequest(new { message = "Receipt item names must be 300 characters or fewer." });

            if (item.Quantity < 0 || item.UnitPrice < 0 || item.LineTotal < 0)
                return Results.BadRequest(new { message = "Receipt item quantities and amounts cannot be negative." });
        }

        return null;
    }

    private static async Task<IResult> CreateQuickReceiptAsync(
        HttpRequest request,
        HttpContext httpContext,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType)
            return Results.BadRequest(new { message = "Quick Receipt requires form data." });

        var form = await request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");

        if (file is null || file.Length <= 0)
            return Results.BadRequest(new { message = "Take or choose a receipt photo first." });

        const long MaxUploadBytes = 20L * 1024L * 1024L;
        if (file.Length > MaxUploadBytes)
            return Results.BadRequest(new { message = "Receipt images must be 20 MB or smaller." });

        var isImage = file.ContentType?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) == true;
        var isPdf = string.Equals(file.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase);
        if (!isImage && !isPdf)
            return Results.BadRequest(new { message = "Quick Receipt supports images and PDF files." });

        var vendor = Clean(form["vendor"].ToString());
        if (vendor?.Length > 200)
            return Results.BadRequest(new { message = "Vendor must be 200 characters or fewer." });

        if (!decimal.TryParse(
                form["total"].ToString(),
                NumberStyles.Number,
                CultureInfo.InvariantCulture,
                out var total) ||
            total <= 0)
        {
            return Results.BadRequest(new { message = "Enter a receipt total greater than zero." });
        }

        decimal? subtotal = null;
        var subtotalText = form["subtotal"].ToString();
        if (!string.IsNullOrWhiteSpace(subtotalText))
        {
            if (!decimal.TryParse(
                    subtotalText,
                    NumberStyles.Number,
                    CultureInfo.InvariantCulture,
                    out var parsedSubtotal) ||
                parsedSubtotal < 0)
            {
                return Results.BadRequest(new { message = "Subtotal is invalid." });
            }

            subtotal = parsedSubtotal;
        }

        decimal? tax = null;
        var taxText = form["tax"].ToString();
        if (!string.IsNullOrWhiteSpace(taxText))
        {
            if (!decimal.TryParse(
                    taxText,
                    NumberStyles.Number,
                    CultureInfo.InvariantCulture,
                    out var parsedTax) ||
                parsedTax < 0)
            {
                return Results.BadRequest(new { message = "Tax / fees is invalid." });
            }

            tax = parsedTax;
        }

        DateOnly? purchaseDate = null;
        var purchaseDateText = form["purchaseDate"].ToString();
        if (!string.IsNullOrWhiteSpace(purchaseDateText))
        {
            if (!DateOnly.TryParseExact(
                    purchaseDateText,
                    "yyyy-MM-dd",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var parsedDate))
            {
                return Results.BadRequest(new { message = "Purchase date is invalid." });
            }

            purchaseDate = parsedDate;
        }

        var allowPossibleDuplicate =
            bool.TryParse(form["allowPossibleDuplicate"].ToString(), out var allowDuplicate) &&
            allowDuplicate;

        List<SavePurchaseLineItemRequest>? lineItems = null;
        var lineItemsJson = form["lineItems"].ToString();
        if (!string.IsNullOrWhiteSpace(lineItemsJson))
        {
            try
            {
                lineItems = JsonSerializer.Deserialize<List<SavePurchaseLineItemRequest>>(
                    lineItemsJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch (JsonException)
            {
                return Results.BadRequest(new { message = "Receipt line items are invalid." });
            }

            var lineItemValidation = ValidateLineItems(lineItems);
            if (lineItemValidation is not null)
                return lineItemValidation;
        }

        var property = await db.Properties
            .AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.Id)
            .Select(p => new { p.Id, p.HouseholdId })
            .FirstOrDefaultAsync(cancellationToken);

        if (property is null)
            return Results.NotFound(new { message = "No active Home Excursion property was found." });

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue)
            return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers.AnyAsync(
            hm => hm.UserId == userId.Value && hm.HouseholdId == property.HouseholdId,
            cancellationToken);

        if (!hasAccess)
            return Results.NotFound();

        var duplicateRequest = new SavePurchaseRequest(
            property.Id,
            null,
            vendor,
            purchaseDate,
            null,
            null,
            total,
            null,
            allowPossibleDuplicate,
            null);

        var duplicateCandidates = await FindDuplicateCandidatesAsync(
            duplicateRequest,
            null,
            db,
            cancellationToken);

        if (duplicateCandidates.Count > 0 && !allowPossibleDuplicate)
        {
            return Results.Conflict(new
            {
                message = "This looks like a receipt that may already be in Home Excursion.",
                possibleDuplicate = true,
                duplicates = duplicateCandidates
            });
        }

        var purchase = new Purchase
        {
            PropertyId = property.Id,
            Vendor = vendor,
            PurchaseDate = purchaseDate,
            Subtotal = subtotal,
            Tax = tax,
            Total = total,
            Status = "Unreviewed",
            Source = "Quick Receipt",
            CreatedAt = DateTime.UtcNow
        };

        var sortOrder = 10;
        foreach (var item in lineItems ?? [])
        {
            var receiptText = Clean(item.ReceiptText)!;
            purchase.LineItems.Add(new PurchaseLineItem
            {
                ReceiptText = receiptText,
                DisplayName = Clean(item.DisplayName) ?? receiptText,
                Quantity = item.Quantity,
                UnitPrice = item.UnitPrice,
                LineTotal = item.LineTotal,
                SortOrder = sortOrder,
                CreatedAt = DateTime.UtcNow
            });
            sortOrder += 10;
        }

        purchase.Allocations.Add(new PurchaseAllocation
        {
            Amount = total,
            Description = "Quick Receipt — unassigned",
            AllocationType = "Unassigned",
            IsIncludedInHomeSpend = false,
            SuggestedBy = "User",
            IsVerified = false,
            CreatedAt = DateTime.UtcNow
        });

        db.Purchases.Add(purchase);
        await db.SaveChangesAsync(cancellationToken);

        StoredAttachment? stored = null;
        Attachment? attachment = null;

        try
        {
            await using (var stream = file.OpenReadStream())
            {
                stored = await storage.UploadAsync(
                    property.HouseholdId,
                    "home",
                    "purchase-receipt",
                    Path.GetFileName(file.FileName),
                    file.ContentType ?? "application/octet-stream",
                    stream,
                    cancellationToken);
            }

            attachment = new Attachment
            {
                HouseholdId = property.HouseholdId,
                UploadedByUserId = userId.Value,
                App = "home",
                Category = "purchase-receipt",
                EntityType = "Purchase",
                EntityId = purchase.Id.ToString(),
                FileName = Path.GetFileName(file.FileName),
                ContentType = file.ContentType ?? "application/octet-stream",
                BlobName = stored.BlobName,
                FileSizeBytes = stored.FileSizeBytes,
                UploadedUtc = DateTime.UtcNow,
                IsActive = true
            };

            platformDb.Attachments.Add(attachment);
            await platformDb.SaveChangesAsync(cancellationToken);

            if (isImage)
            {
                await AttachmentThumbnailHelper.EnsureCreatedAsync(
                    attachment.BlobName,
                    storage,
                    cancellationToken);
            }
        }
        catch
        {
            if (attachment is not null && attachment.Id > 0)
            {
                platformDb.Attachments.Remove(attachment);
                await platformDb.SaveChangesAsync(cancellationToken);
            }

            if (stored is not null)
            {
                await storage.DeleteAsync(
                    AttachmentThumbnailHelper.GetThumbnailBlobName(stored.BlobName),
                    cancellationToken);
                await storage.DeleteAsync(stored.BlobName, cancellationToken);
            }

            db.Purchases.Remove(purchase);
            await db.SaveChangesAsync(cancellationToken);

            throw;
        }

        return Results.Created(
            $"/api/home/purchases/{purchase.Id}",
            new
            {
                purchase.Id,
                purchase.Status,
                purchase.Source,
                AttachmentId = attachment!.Id
            });
    }

    private static async Task<IResult> CreatePurchaseAsync(
        SavePurchaseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var validation = await ValidatePurchaseRequestAsync(request, db, cancellationToken, null);
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
            .Include(p => p.LineItems)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (purchase is null) return Results.NotFound();

        var validation = await ValidatePurchaseRequestAsync(request, db, cancellationToken, id);
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
        SavePurchaseRequest request,
        HomeExcursionDbContext db,
        CancellationToken cancellationToken)
    {
        var purchase = await db.Purchases
            .Include(p => p.Allocations)
            .Include(p => p.LineItems)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (purchase is null) return Results.NotFound();

        var validation = await ValidatePurchaseRequestAsync(
            request,
            db,
            cancellationToken,
            id);

        if (validation is not null) return validation;

        var duplicateCandidates = await FindDuplicateCandidatesAsync(
            request,
            id,
            db,
            cancellationToken);

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

        var allocated = purchase.Allocations.Sum(a => a.Amount);
        var difference = purchase.Total - allocated;

        if (Math.Abs(difference) >= 0.005m)
        {
            return Results.Conflict(new
            {
                message = $"Receipt does not reconcile. Difference: {difference:C2}."
            });
        }

        if (purchase.Allocations.Count == 0 ||
            purchase.Allocations.Any(a => a.AllocationType == "Unassigned"))
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

        return Results.Ok(new
        {
            purchase.Id,
            purchase.Status,
            purchase.VerifiedAt
        });
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
            .Include(p => p.Allocations)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (purchase is null) return Results.NotFound();

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue) return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers.AnyAsync(
            hm => hm.UserId == userId.Value && hm.HouseholdId == purchase.Property.HouseholdId,
            cancellationToken);
        if (!hasAccess) return Results.NotFound();

        if (purchase.Allocations.Any(a => a.ProjectId != null || a.TaskId != null))
        {
            return Results.Conflict(new
            {
                message = "This purchase is linked to a project or task and cannot be deleted until those links are removed."
            });
        }

        await DeletePurchaseAttachmentsAsync(
            [purchase.Id],
            purchase.Property.HouseholdId,
            platformDb,
            storage,
            cancellationToken);

        db.Purchases.Remove(purchase);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> BulkDeletePurchasesAsync(
        BulkDeletePurchasesRequest request,
        HttpContext httpContext,
        HomeExcursionDbContext db,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        var ids = (request.PurchaseIds ?? [])
            .Where(id => id > 0)
            .Distinct()
            .Take(200)
            .ToList();

        if (ids.Count == 0)
            return Results.BadRequest(new { message = "Select at least one purchase to delete." });

        var purchases = await db.Purchases
            .Include(p => p.Property)
            .Include(p => p.Allocations)
            .Where(p => ids.Contains(p.Id))
            .ToListAsync(cancellationToken);

        if (purchases.Count != ids.Count)
            return Results.NotFound(new { message = "One or more selected purchases could not be found." });

        var householdIds = purchases.Select(p => p.Property.HouseholdId).Distinct().ToList();
        if (householdIds.Count != 1)
            return Results.BadRequest(new { message = "Selected purchases must belong to the same household." });

        var householdId = householdIds[0];

        var userId = await GetCurrentUserIdAsync(httpContext, platformDb, cancellationToken);
        if (!userId.HasValue) return Results.Unauthorized();

        var hasAccess = await platformDb.HouseholdMembers.AnyAsync(
            hm => hm.UserId == userId.Value && hm.HouseholdId == householdId,
            cancellationToken);
        if (!hasAccess) return Results.NotFound();

        var protectedIds = purchases
            .Where(p => p.Allocations.Any(a => a.ProjectId != null || a.TaskId != null))
            .Select(p => p.Id)
            .OrderBy(id => id)
            .ToList();

        if (protectedIds.Count > 0)
        {
            return Results.Conflict(new
            {
                message = "One or more selected purchases are linked to a project or task and cannot be deleted.",
                protectedPurchaseIds = protectedIds
            });
        }

        await DeletePurchaseAttachmentsAsync(
            ids,
            householdId,
            platformDb,
            storage,
            cancellationToken);

        db.Purchases.RemoveRange(purchases);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new
        {
            deletedCount = purchases.Count,
            deletedPurchaseIds = ids
        });
    }

    private static async Task DeletePurchaseAttachmentsAsync(
        IReadOnlyCollection<int> purchaseIds,
        int householdId,
        LaUltimaExcursionDbContext platformDb,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken)
    {
        var entityIds = purchaseIds.Select(id => id.ToString()).ToList();

        var attachments = await platformDb.Attachments
            .Where(a =>
                a.IsActive &&
                a.HouseholdId == householdId &&
                a.App == "home" &&
                a.EntityType == "Purchase" &&
                a.EntityId != null &&
                entityIds.Contains(a.EntityId))
            .ToListAsync(cancellationToken);

        foreach (var attachment in attachments)
        {
            await storage.DeleteAsync(
                AttachmentThumbnailHelper.GetThumbnailBlobName(attachment.BlobName),
                cancellationToken);
            await storage.DeleteAsync(attachment.BlobName, cancellationToken);
        }

        if (attachments.Count > 0)
        {
            platformDb.Attachments.RemoveRange(attachments);
            await platformDb.SaveChangesAsync(cancellationToken);
        }
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
        CancellationToken cancellationToken,
        int? expectedPurchaseId)
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

        var allocations = request.Allocations ?? new List<SaveAllocationRequest>();

        foreach (var allocation in allocations)
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

        var requestedLineItemIds = allocations
            .Where(a => a.PurchaseLineItemId is not null)
            .Select(a => a.PurchaseLineItemId!.Value)
            .Distinct()
            .ToList();

        if (requestedLineItemIds.Count > 0)
        {
            if (expectedPurchaseId is null)
                return Results.BadRequest(new { message = "Receipt line items can only be allocated on an existing purchase." });

            var validLineItemCount = await db.PurchaseLineItems
                .CountAsync(i =>
                    requestedLineItemIds.Contains(i.Id) &&
                    i.PurchaseId == expectedPurchaseId.Value &&
                    i.Purchase.PropertyId == request.PropertyId,
                    cancellationToken);

            if (validLineItemCount != requestedLineItemIds.Count)
                return Results.BadRequest(new { message = "One or more receipt items do not belong to this purchase." });

            if (requestedLineItemIds.Count != allocations.Count(a => a.PurchaseLineItemId is not null))
                return Results.BadRequest(new { message = "Each receipt line item can only be allocated once." });
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
                IsIncludedInHomeSpend = false,
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
                PurchaseLineItemId = item.PurchaseLineItemId,
                Amount = item.Amount,
                Description = item.Description.Trim(),
                Category = Clean(item.Category),
                AllocationType = type,
                IsIncludedInHomeSpend = type is "PersonalExcluded" or "Unassigned"
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

    private static string NormalizeReceiptItemText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        return System.Text.RegularExpressions.Regex
            .Replace(value.Trim(), @"\s+", " ")
            .ToUpperInvariant();
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
