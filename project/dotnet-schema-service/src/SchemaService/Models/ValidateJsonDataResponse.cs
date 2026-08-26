namespace SchemaService.Models;

/// <summary>
/// Response from validating JSON data against a JSON Schema
/// </summary>
public sealed class ValidateJsonDataResponse
{
    /// <summary>
    /// Whether the JSON data is valid according to the schema
    /// </summary>
    public bool IsValid { get; set; }

    /// <summary>
    /// Validation errors (schema violations, type mismatches, etc.)
    /// </summary>
    public ValidationError[] Errors { get; set; } = [];

    /// <summary>
    /// Optional summary message describing the validation result
    /// </summary>
    public string Summary { get; set; } = string.Empty;

    /// <summary>
    /// Detected JSON Schema draft version (e.g., "Draft 7", "Draft 2020-12")
    /// Null if draft could not be detected
    /// </summary>
    public string? DetectedDraft { get; set; }
}
