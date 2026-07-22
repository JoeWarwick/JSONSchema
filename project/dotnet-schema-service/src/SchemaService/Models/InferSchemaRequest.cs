namespace SchemaService.Models;

public sealed class InferSchemaRequest
{
    public string Content { get; set; } = string.Empty;

    public string? Language { get; set; }

    public string? ContentType { get; set; }

    public string? SourceUri { get; set; }

    public bool PreferSchemaLocation { get; set; } = true;
}
