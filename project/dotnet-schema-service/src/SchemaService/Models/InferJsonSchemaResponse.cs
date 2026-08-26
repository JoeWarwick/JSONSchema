namespace SchemaService.Models;

/// <summary>
/// Response from inferring a JSON Schema from JSON data
/// </summary>
public sealed class InferJsonSchemaResponse
{
    /// <summary>
    /// The inferred JSON Schema as a JSON string
    /// </summary>
    public string InferredSchema { get; set; } = string.Empty;

    /// <summary>
    /// Any warnings or notes from the inference process
    /// </summary>
    public string[] Warnings { get; set; } = [];
}
