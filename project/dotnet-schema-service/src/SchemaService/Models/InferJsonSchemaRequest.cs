namespace SchemaService.Models;

/// <summary>
/// Request to infer a JSON Schema from JSON data
/// </summary>
public sealed class InferJsonSchemaRequest
{
    /// <summary>
    /// The JSON data from which to infer a schema
    /// </summary>
    public string JsonData { get; set; } = string.Empty;
}
