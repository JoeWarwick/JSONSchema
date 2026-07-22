namespace SchemaService.Models;

public sealed class DefaultInstanceRequest
{
    public string Schema { get; set; } = string.Empty;

    public string? RootElementName { get; set; }
}
