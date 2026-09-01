using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace HomeExcursion.Api.Services.Attachments;

public static class AttachmentThumbnailHelper
{
    public const string ThumbnailContentType = "image/webp";

    public static string GetThumbnailBlobName(string blobName) =>
        $"{blobName}.thumb.webp";

    public static async Task<AttachmentDownload?> OpenOrCreateAsync(
        string originalBlobName,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken = default)
    {
        var thumbnailBlobName = GetThumbnailBlobName(originalBlobName);

        var cached = await storage.OpenReadAsync(
            thumbnailBlobName,
            cancellationToken);

        if (cached != null)
            return cached;

        var original = await storage.OpenReadAsync(
            originalBlobName,
            cancellationToken);

        if (original == null)
            return null;

        await using var originalContent = original.Content;

        using var image = await Image.LoadAsync(
            originalContent,
            cancellationToken);

        image.Mutate(context =>
        {
            context.AutoOrient();

            if (image.Width > 640 || image.Height > 640)
            {
                context.Resize(new ResizeOptions
                {
                    Mode = ResizeMode.Max,
                    Size = new Size(640, 640)
                });
            }
        });

        // Delivery thumbnails do not need the original metadata payload.
        image.Metadata.ExifProfile = null;
        image.Metadata.IccProfile = null;
        image.Metadata.XmpProfile = null;

        await using var thumbnailContent = new MemoryStream();

        await image.SaveAsWebpAsync(
            thumbnailContent,
            new WebpEncoder
            {
                FileFormat = WebpFileFormatType.Lossy,
                Quality = 75
            },
            cancellationToken);

        var bytes = thumbnailContent.ToArray();

        await using var saveContent =
            new MemoryStream(bytes, writable: false);

        await storage.SaveAsync(
            thumbnailBlobName,
            ThumbnailContentType,
            saveContent,
            cancellationToken);

        return new AttachmentDownload(
            new MemoryStream(bytes, writable: false),
            ThumbnailContentType);
    }

    public static async Task EnsureCreatedAsync(
        string originalBlobName,
        IAttachmentStorageService storage,
        CancellationToken cancellationToken = default)
    {
        var thumbnail = await OpenOrCreateAsync(
            originalBlobName,
            storage,
            cancellationToken);

        if (thumbnail != null)
            await thumbnail.Content.DisposeAsync();
    }
}
