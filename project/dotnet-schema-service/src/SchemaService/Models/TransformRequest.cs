using System.ComponentModel.DataAnnotations;

namespace SchemaService.Models;

/// <summary>XML input and an XSLT 1.0 stylesheet for a bounded transformation preview.</summary>
public sealed record TransformRequest
{
    [Required, MaxLength(1_000_000)]
    public required string Input { get; init; }

    [Required, MaxLength(1_000_000)]
    public required string Stylesheet { get; init; }
}

/// <summary>The XML output produced by a transformation preview.</summary>
public sealed record TransformResponse(string Xml);

/// <summary>Internal response from the isolated preview process.</summary>
public sealed record TransformWorkerResponse(string? Xml, string? Error);
