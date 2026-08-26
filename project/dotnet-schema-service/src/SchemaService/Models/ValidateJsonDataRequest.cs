namespace SchemaService.Models;

/// <summary>
/// Request to validate JSON data against a JSON Schema
/// </summary>
public sealed class ValidateJsonDataRequest
{
    /// <summary>
    /// The JSON Schema to validate against
    /// </summary>
    public string Schema { get; set; } = string.Empty;

    /// <summary>
    /// The JSON data to validate
    /// </summary>
    public string JsonData { get; set; } = string.Empty;
}
