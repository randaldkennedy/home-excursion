using OpenAI;
using OpenAI.Chat;
using System.ClientModel;
using System.Globalization;
using System.Text.Json;

namespace HomeExcursion.Api.Services.Receipts;

public sealed class AiHomeReceiptAnalyzer : IHomeReceiptAnalyzer
{
    private readonly ChatClient _chatClient;

    public AiHomeReceiptAnalyzer(IConfiguration configuration)
    {
        var endpoint = configuration["AzureOpenAI:Endpoint"];
        var key = configuration["AzureOpenAI:Key"];
        var deployment = configuration["AzureOpenAI:Deployment"];

        if (string.IsNullOrWhiteSpace(endpoint))
            throw new InvalidOperationException("AzureOpenAI:Endpoint is not configured.");

        if (string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("AzureOpenAI:Key is not configured.");

        if (string.IsNullOrWhiteSpace(deployment))
            throw new InvalidOperationException("AzureOpenAI:Deployment is not configured.");

        endpoint = endpoint.TrimEnd('/') + "/";

        _chatClient = new ChatClient(
            model: deployment,
            credential: new ApiKeyCredential(key),
            options: new OpenAIClientOptions
            {
                Endpoint = new Uri(endpoint)
            });
    }

    public async Task<HomeReceiptAnalysisResult> AnalyzeAsync(
        Stream receiptImage,
        string contentType,
        CancellationToken cancellationToken)
    {
        using var memoryStream = new MemoryStream();
        await receiptImage.CopyToAsync(memoryStream, cancellationToken);

        var base64 = Convert.ToBase64String(memoryStream.ToArray());
        var imageDataUri = $"data:{contentType};base64,{base64}";

        var prompt = """
            Analyze this image as a retail, home-improvement, contractor,
            maintenance, service, utility, tax, fee, or other household receipt.

            Extract only information clearly supported by the receipt image.
            Do not guess.

            Rules:
            - vendor: merchant, contractor, service provider, or payee name.
            - purchaseDate: transaction/service/payment date printed on the receipt.
            - For United States receipts, interpret dates as MM/DD/YY or MM/DD/YYYY
              unless the receipt clearly indicates another format.
            - purchaseDate must be YYYY-MM-DD.
            - subtotal: amount before sales tax/fees when clearly printed.
            - tax: sales tax or clearly identified tax amount. Do not include the
              entire total as tax.
            - total: final amount paid/charged for the transaction.
            - Prefer a clearly labeled TOTAL, AMOUNT PAID, BALANCE PAID, or equivalent.
            - Do not confuse change due, cash tendered, card number, authorization
              codes, loyalty totals, rewards, or savings with the transaction total.
            - lineItems: extract each purchased product/service line that can be read
              confidently. Do not include subtotal, tax, total, payment tender, savings,
              rewards, or change due as line items.
            - lineItems.description: human-readable item/service description from the receipt.
            - lineItems.quantity: purchased quantity when clearly shown; otherwise null.
            - lineItems.unitPrice: per-unit price when clearly shown; otherwise null.
            - lineItems.lineTotal: extended amount for that purchased line when clearly shown.
            - Do not invent expanded product names from SKU/UPC codes when the printed
              description is unclear. Preserve useful printed wording instead.
            - rawText: useful readable text from the receipt, concise but sufficient
              for troubleshooting extraction.
            - Use null for any field that cannot be read confidently.
            - warnings should explain uncertainty, missing fields, conflicting totals,
              poor image quality, or anything the user should verify.
            - If the image is not a receipt or invoice, return null for the monetary
              fields and vendor/date unless clearly supported, and add a warning.
            """;

        List<ChatMessage> messages =
        [
            new SystemChatMessage(
                "You accurately extract structured purchase data from household receipts and invoices."),
            new UserChatMessage(
                ChatMessageContentPart.CreateTextPart(prompt),
                ChatMessageContentPart.CreateImagePart(new Uri(imageDataUri)))
        ];

        var options = new ChatCompletionOptions
        {
            ResponseFormat = ChatResponseFormat.CreateJsonSchemaFormat(
                jsonSchemaFormatName: "home_receipt",
                jsonSchema: BinaryData.FromBytes("""
                    {
                      "type": "object",
                      "properties": {
                        "vendor": {
                          "anyOf": [
                            { "type": "string" },
                            { "type": "null" }
                          ]
                        },
                        "purchaseDate": {
                          "anyOf": [
                            { "type": "string" },
                            { "type": "null" }
                          ]
                        },
                        "subtotal": {
                          "anyOf": [
                            { "type": "number" },
                            { "type": "null" }
                          ]
                        },
                        "tax": {
                          "anyOf": [
                            { "type": "number" },
                            { "type": "null" }
                          ]
                        },
                        "total": {
                          "anyOf": [
                            { "type": "number" },
                            { "type": "null" }
                          ]
                        },
                        "lineItems": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "description": {
                                "anyOf": [
                                  { "type": "string" },
                                  { "type": "null" }
                                ]
                              },
                              "quantity": {
                                "anyOf": [
                                  { "type": "number" },
                                  { "type": "null" }
                                ]
                              },
                              "unitPrice": {
                                "anyOf": [
                                  { "type": "number" },
                                  { "type": "null" }
                                ]
                              },
                              "lineTotal": {
                                "anyOf": [
                                  { "type": "number" },
                                  { "type": "null" }
                                ]
                              }
                            },
                            "required": ["description","quantity","unitPrice","lineTotal"],
                            "additionalProperties": false
                          }
                        },
                        "rawText": {
                          "anyOf": [
                            { "type": "string" },
                            { "type": "null" }
                          ]
                        },
                        "warnings": {
                          "type": "array",
                          "items": { "type": "string" }
                        }
                      },
                      "required": [
                        "vendor",
                        "purchaseDate",
                        "subtotal",
                        "tax",
                        "total",
                        "lineItems",
                        "rawText",
                        "warnings"
                      ],
                      "additionalProperties": false
                    }
                    """u8.ToArray()),
                jsonSchemaIsStrict: true)
        };

        ChatCompletion completion = await _chatClient.CompleteChatAsync(
            messages,
            options,
            cancellationToken);

        var json = completion.Content[0].Text;

        var payload = JsonSerializer.Deserialize<AiPayload>(
            json,
            new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

        if (payload is null)
            throw new InvalidOperationException("Azure OpenAI returned an empty Home receipt result.");

        DateOnly? purchaseDate = null;

        if (!string.IsNullOrWhiteSpace(payload.PurchaseDate) &&
            DateOnly.TryParseExact(
                payload.PurchaseDate,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var parsedDate))
        {
            purchaseDate = parsedDate;
        }

        return new HomeReceiptAnalysisResult
        {
            Vendor = Clean(payload.Vendor),
            PurchaseDate = purchaseDate,
            Subtotal = NormalizeMoney(payload.Subtotal),
            Tax = NormalizeMoney(payload.Tax),
            Total = NormalizeMoney(payload.Total),
            LineItems = (payload.LineItems ?? [])
                .Where(item =>
                    !string.IsNullOrWhiteSpace(item.Description) ||
                    item.LineTotal.HasValue)
                .Select(item => new HomeReceiptLineItem
                {
                    Description = Clean(item.Description),
                    Quantity = item.Quantity,
                    UnitPrice = NormalizeMoney(item.UnitPrice),
                    LineTotal = NormalizeMoney(item.LineTotal)
                })
                .ToList(),
            RawText = Clean(payload.RawText),
            Warnings = payload.Warnings ?? []
        };
    }

    private static decimal? NormalizeMoney(decimal? value) =>
        value.HasValue ? Math.Round(value.Value, 2) : null;

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed class AiPayload
    {
        public string? Vendor { get; set; }
        public string? PurchaseDate { get; set; }
        public decimal? Subtotal { get; set; }
        public decimal? Tax { get; set; }
        public decimal? Total { get; set; }
        public List<AiLineItem>? LineItems { get; set; }
        public string? RawText { get; set; }
        public List<string>? Warnings { get; set; }
    }

    private sealed class AiLineItem
    {
        public string? Description { get; set; }
        public decimal? Quantity { get; set; }
        public decimal? UnitPrice { get; set; }
        public decimal? LineTotal { get; set; }
    }
}
