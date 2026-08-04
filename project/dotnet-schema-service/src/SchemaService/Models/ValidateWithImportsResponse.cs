namespace SchemaService.Models;

public sealed class ValidateWithImportsResponse
{
    public bool IsValid { get; set; }

    public ValidationError[] Errors { get; set; } = [];

    public ValidationError[] Warnings { get; set; } = [];
}

public sealed class ValidationError
{
    public string Message { get; set; } = string.Empty;

    public int LineNumber { get; set; }

    public int LinePosition { get; set; }

    public string? Exception { get; set; }
}
