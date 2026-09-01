using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace HomeExcursion.Api.Services.Attachments;

public interface IAttachmentStorageService
{
    Task<StoredAttachment> UploadAsync(int householdId, string app, string category, string fileName, string contentType, Stream content, CancellationToken cancellationToken = default);
    Task<AttachmentDownload?> OpenReadAsync(string blobName, CancellationToken cancellationToken = default);
    Task SaveAsync(string blobName, string contentType, Stream content, CancellationToken cancellationToken = default);
    Task DeleteAsync(string blobName, CancellationToken cancellationToken = default);
}

public sealed record StoredAttachment(string BlobName, long FileSizeBytes);
public sealed record AttachmentDownload(Stream Content, string ContentType);

public sealed class AzureBlobAttachmentStorageService : IAttachmentStorageService
{
    private const string ContainerName = "documents";
    private readonly BlobContainerClient _container;

    public AzureBlobAttachmentStorageService(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("AttachmentStorage");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException("Connection string 'AttachmentStorage' is not configured.");

        _container = new BlobServiceClient(connectionString).GetBlobContainerClient(ContainerName);
    }

    public async Task<StoredAttachment> UploadAsync(int householdId, string app, string category, string fileName, string contentType, Stream content, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(app);
        ArgumentException.ThrowIfNullOrWhiteSpace(category);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentException.ThrowIfNullOrWhiteSpace(contentType);

        var extension = Path.GetExtension(fileName);
        if (extension.Length > 16) extension = string.Empty;

        var blobName = $"household-{householdId}/{Segment(app)}/{Segment(category)}/{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var blob = _container.GetBlobClient(blobName);

        await blob.UploadAsync(content, new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = contentType }
        }, cancellationToken);

        var properties = await blob.GetPropertiesAsync(cancellationToken: cancellationToken);
        return new StoredAttachment(blobName, properties.Value.ContentLength);
    }

    public async Task<AttachmentDownload?> OpenReadAsync(string blobName, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(blobName);
        var blob = _container.GetBlobClient(blobName);
        if (!await blob.ExistsAsync(cancellationToken)) return null;

        var download = await blob.DownloadStreamingAsync(cancellationToken: cancellationToken);
        return new AttachmentDownload(download.Value.Content, download.Value.Details.ContentType ?? "application/octet-stream");
    }

    public async Task SaveAsync(string blobName, string contentType, Stream content, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(blobName);
        ArgumentException.ThrowIfNullOrWhiteSpace(contentType);

        var blob = _container.GetBlobClient(blobName);
        await blob.UploadAsync(content, new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = contentType }
        }, cancellationToken);
    }

    public async Task DeleteAsync(string blobName, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(blobName);
        await _container.GetBlobClient(blobName).DeleteIfExistsAsync(DeleteSnapshotsOption.IncludeSnapshots, cancellationToken: cancellationToken);
    }

    private static string Segment(string value)
    {
        var result = new string(value.Trim().ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray()).Trim('-');
        return string.IsNullOrWhiteSpace(result) ? "other" : result;
    }
}

public sealed class DevelopmentAttachmentStorageService : IAttachmentStorageService
{
    private const string ReadOnlyContainerSasUrlKey =
        "DevelopmentAttachmentStorage:ReadOnlyContainerSasUrl";

    private readonly LocalAttachmentStorageService _local;
    private readonly BlobContainerClient? _readOnlyProductionContainer;
    private readonly ILogger<DevelopmentAttachmentStorageService> _logger;

    public DevelopmentAttachmentStorageService(
        IWebHostEnvironment environment,
        IConfiguration configuration,
        ILogger<DevelopmentAttachmentStorageService> logger)
    {
        _local = new LocalAttachmentStorageService(environment);
        _logger = logger;

        var readOnlyContainerSasUrl = configuration[ReadOnlyContainerSasUrlKey];
        if (string.IsNullOrWhiteSpace(readOnlyContainerSasUrl))
        {
            _logger.LogInformation(
                "Development attachment production fallback is disabled because {ConfigurationKey} is not configured.",
                ReadOnlyContainerSasUrlKey);
            return;
        }

        if (!Uri.TryCreate(readOnlyContainerSasUrl, UriKind.Absolute, out var containerUri) ||
            !string.Equals(containerUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Configuration '{ReadOnlyContainerSasUrlKey}' must be a valid HTTPS Azure Blob container SAS URL.");
        }

        _readOnlyProductionContainer = new BlobContainerClient(containerUri);

        _logger.LogInformation(
            "Development attachment storage will use local files first and fall back to the configured production Blob container for reads only.");
    }

    public Task<StoredAttachment> UploadAsync(
        int householdId,
        string app,
        string category,
        string fileName,
        string contentType,
        Stream content,
        CancellationToken cancellationToken = default) =>
        _local.UploadAsync(
            householdId,
            app,
            category,
            fileName,
            contentType,
            content,
            cancellationToken);

    public async Task<AttachmentDownload?> OpenReadAsync(
        string blobName,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(blobName);

        var local = await _local.OpenReadAsync(blobName, cancellationToken);
        if (local is not null)
            return local;

        if (_readOnlyProductionContainer is null)
            return null;

        var blob = _readOnlyProductionContainer.GetBlobClient(blobName);
        if (!await blob.ExistsAsync(cancellationToken))
            return null;

        var download = await blob.DownloadStreamingAsync(cancellationToken: cancellationToken);

        _logger.LogDebug(
            "Development attachment {BlobName} was read from the production Blob fallback.",
            blobName);

        return new AttachmentDownload(
            download.Value.Content,
            download.Value.Details.ContentType ?? "application/octet-stream");
    }

    public Task SaveAsync(
        string blobName,
        string contentType,
        Stream content,
        CancellationToken cancellationToken = default) =>
        _local.SaveAsync(blobName, contentType, content, cancellationToken);

    public Task DeleteAsync(
        string blobName,
        CancellationToken cancellationToken = default) =>
        _local.DeleteAsync(blobName, cancellationToken);
}

public sealed class LocalAttachmentStorageService : IAttachmentStorageService
{
    private readonly string _rootPath;

    public LocalAttachmentStorageService(IWebHostEnvironment environment)
    {
        _rootPath = Path.Combine(environment.ContentRootPath, "App_Data", "attachments");
        Directory.CreateDirectory(_rootPath);
    }

    public async Task<StoredAttachment> UploadAsync(int householdId, string app, string category, string fileName, string contentType, Stream content, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(app);
        ArgumentException.ThrowIfNullOrWhiteSpace(category);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentException.ThrowIfNullOrWhiteSpace(contentType);

        var extension = Path.GetExtension(fileName);
        if (extension.Length > 16) extension = string.Empty;

        var blobName = $"household-{householdId}/{Segment(app)}/{Segment(category)}/{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var fullPath = GetFullPath(blobName);

        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        await using var output = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
        await content.CopyToAsync(output, cancellationToken);
        await output.FlushAsync(cancellationToken);

        return new StoredAttachment(blobName, output.Length);
    }

    public Task<AttachmentDownload?> OpenReadAsync(string blobName, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(blobName);

        var fullPath = GetFullPath(blobName);
        if (!File.Exists(fullPath))
            return Task.FromResult<AttachmentDownload?>(null);

        Stream content = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        return Task.FromResult<AttachmentDownload?>(new AttachmentDownload(content, GetContentType(fullPath)));
    }

    public async Task SaveAsync(string blobName, string contentType, Stream content, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(blobName);
        ArgumentException.ThrowIfNullOrWhiteSpace(contentType);

        var fullPath = GetFullPath(blobName);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        await using var output = new FileStream(
            fullPath,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            81920,
            useAsync: true);

        await content.CopyToAsync(output, cancellationToken);
        await output.FlushAsync(cancellationToken);
    }

    public Task DeleteAsync(string blobName, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(blobName);

        var fullPath = GetFullPath(blobName);
        if (File.Exists(fullPath))
            File.Delete(fullPath);

        return Task.CompletedTask;
    }

    private string GetFullPath(string blobName)
    {
        var normalizedBlobName = blobName.Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine(_rootPath, normalizedBlobName));
        var rootPath = Path.GetFullPath(_rootPath) + Path.DirectorySeparatorChar;

        if (!fullPath.StartsWith(rootPath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Invalid attachment path.");

        return fullPath;
    }

    private static string GetContentType(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".pdf" => "application/pdf",
            _ => "application/octet-stream"
        };

    private static string Segment(string value)
    {
        var result = new string(value.Trim().ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray()).Trim('-');
        return string.IsNullOrWhiteSpace(result) ? "other" : result;
    }
}

