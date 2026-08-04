namespace SchemaService.Models;

public sealed class ValidateWithImportsRequest
{
    public string Schema { get; set; } = string.Empty;

    public string XmlInstance { get; set; } = string.Empty;

    public string? BaseUri { get; set; }
}
