using Microsoft.EntityFrameworkCore;
using HomeExcursion.Api.Data;
using HomeExcursion.Api.Services.Attachments;

namespace HomeExcursion.Api.Endpoints;

public static class AttachmentEndpoints
{
    private const string EntraObjectIdClaim =
        "http://schemas.microsoft.com/identity/claims/objectidentifier";

    public static IEndpointRouteBuilder MapAttachmentEndpoints(
        this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/attachments/{attachmentId:long}", async (
            long attachmentId,
            HttpContext httpContext,
            LaUltimaExcursionDbContext platformDb,
            IAttachmentStorageService storage,
            CancellationToken cancellationToken) =>
        {
            var userId = await GetCurrentUserIdAsync(
                httpContext,
                platformDb,
                cancellationToken);

            if (!userId.HasValue)
            {
                return Results.Unauthorized();
            }

            var attachment = await platformDb.Attachments
                .SingleOrDefaultAsync(
                    a => a.Id == attachmentId,
                    cancellationToken);

            if (attachment == null)
            {
                return Results.NotFound();
            }

            var hasAccess = await platformDb.HouseholdMembers
                .AnyAsync(
                    hm =>
                        hm.UserId == userId.Value &&
                        hm.HouseholdId == attachment.HouseholdId,
                    cancellationToken);

            if (!hasAccess)
            {
                return Results.NotFound();
            }

            var download = await storage.OpenReadAsync(
                attachment.BlobName,
                cancellationToken);

            if (download == null)
            {
                return Results.NotFound();
            }

            var isImage =
                attachment.ContentType?.StartsWith(
                    "image/",
                    StringComparison.OrdinalIgnoreCase) == true;

            return isImage
                ? Results.File(
                    download.Content,
                    attachment.ContentType,
                    enableRangeProcessing: true)
                : Results.File(
                    download.Content,
                    attachment.ContentType,
                    attachment.FileName,
                    enableRangeProcessing: true);
        })
        .RequireAuthorization();

        app.MapGet("/api/attachments/{attachmentId:long}/thumbnail", async (
            long attachmentId,
            HttpContext httpContext,
            LaUltimaExcursionDbContext platformDb,
            IAttachmentStorageService storage,
            CancellationToken cancellationToken) =>
        {
            var userId = await GetCurrentUserIdAsync(
                httpContext,
                platformDb,
                cancellationToken);

            if (!userId.HasValue)
            {
                return Results.Unauthorized();
            }

            var attachment = await platformDb.Attachments
                .SingleOrDefaultAsync(
                    a => a.Id == attachmentId,
                    cancellationToken);

            if (attachment == null)
            {
                return Results.NotFound();
            }

            var hasAccess = await platformDb.HouseholdMembers
                .AnyAsync(
                    hm =>
                        hm.UserId == userId.Value &&
                        hm.HouseholdId == attachment.HouseholdId,
                    cancellationToken);

            if (!hasAccess)
            {
                return Results.NotFound();
            }

            if (attachment.ContentType?.StartsWith(
                    "image/",
                    StringComparison.OrdinalIgnoreCase) != true)
            {
                return Results.StatusCode(StatusCodes.Status415UnsupportedMediaType);
            }

            var thumbnail =
                await AttachmentThumbnailHelper.OpenOrCreateAsync(
                    attachment.BlobName,
                    storage,
                    cancellationToken);

            if (thumbnail == null)
            {
                return Results.NotFound();
            }

            httpContext.Response.Headers["Cache-Control"] =
                "private, max-age=31536000, immutable";

            return Results.File(
                thumbnail.Content,
                thumbnail.ContentType);
        })
        .RequireAuthorization();

        app.MapDelete("/api/attachments/{attachmentId:long}", async (
            long attachmentId,
            HttpContext httpContext,
            LaUltimaExcursionDbContext platformDb,
            IAttachmentStorageService storage,
            CancellationToken cancellationToken) =>
        {
            var userId = await GetCurrentUserIdAsync(
                httpContext,
                platformDb,
                cancellationToken);

            if (!userId.HasValue)
            {
                return Results.Unauthorized();
            }

            var attachment = await platformDb.Attachments
                .SingleOrDefaultAsync(
                    a => a.Id == attachmentId,
                    cancellationToken);

            if (attachment == null)
            {
                return Results.NotFound();
            }

            var hasAccess = await platformDb.HouseholdMembers
                .AnyAsync(
                    hm =>
                        hm.UserId == userId.Value &&
                        hm.HouseholdId == attachment.HouseholdId,
                    cancellationToken);

            if (!hasAccess)
            {
                return Results.NotFound();
            }

            await storage.DeleteAsync(
                AttachmentThumbnailHelper.GetThumbnailBlobName(attachment.BlobName),
                cancellationToken);

            await storage.DeleteAsync(
                attachment.BlobName,
                cancellationToken);

            platformDb.Attachments.Remove(attachment);
            await platformDb.SaveChangesAsync(cancellationToken);

            return Results.NoContent();
        })
        .RequireAuthorization();

        return app;
    }

    private static async Task<int?> GetCurrentUserIdAsync(
        HttpContext httpContext,
        LaUltimaExcursionDbContext platformDb,
        CancellationToken cancellationToken)
    {
        var entraObjectId =
            httpContext.User.FindFirst(EntraObjectIdClaim)?.Value
            ?? httpContext.User.FindFirst("oid")?.Value;

        if (string.IsNullOrWhiteSpace(entraObjectId))
        {
            return null;
        }

        return await platformDb.Users
            .Where(u => u.EntraObjectId == entraObjectId)
            .Select(u => (int?)u.Id)
            .SingleOrDefaultAsync(cancellationToken);
    }
}
