namespace SchemaService.Models;

public sealed class ValidateSchemaResponse
{
    /// <summary>
    /// Whether the schema is valid according to XSD rules
    /// </summary>
    public bool IsValid { get; set; }

    /// <summary>
    /// Validation errors (schema compilation failures, duplicate attributes, etc.)
    /// </summary>
    public ValidationError[] Errors { get; set; } = [];

    /// <summary>
    /// Validation warnings
    /// </summary>
    public ValidationError[] Warnings { get; set; } = [];

    /// <summary>
    /// Optional summary message describing the validation result
    /// </summary>
    public string Summary { get; set; } = string.Empty;
}
