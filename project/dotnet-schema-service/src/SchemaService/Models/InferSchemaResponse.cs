namespace SchemaService.Models;

public sealed class InferSchemaResponse
{
    public string Mode { get; set; } = string.Empty;

    public string? InferredSchema { get; set; }

    public string? RawXml { get; set; }

    public string[] SchemaUrls { get; set; } = [];

    public string[] Warnings { get; set; } = [];
}
