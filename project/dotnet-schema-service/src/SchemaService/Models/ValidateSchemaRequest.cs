namespace SchemaService.Models;

public sealed class ValidateSchemaRequest
{
    /// <summary>
    /// The XSD schema content to validate
    /// </summary>
    public string Schema { get; set; } = string.Empty;

    /// <summary>
    /// Optional base URI for resolving relative imports
    /// </summary>
    public string? BaseUri { get; set; }
}
