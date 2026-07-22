namespace SchemaService.Models;

public sealed class DefaultInstanceResponse
{
    public string Xml { get; set; } = string.Empty;

    public string[] Warnings { get; set; } = [];
}
