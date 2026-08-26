using System.Text.Json;
using Json.Schema;
using SchemaService.Models;

namespace SchemaService.Services;

/// <summary>
/// Service for validating JSON data against JSON Schemas
/// Supports multiple JSON Schema drafts: Draft 4, Draft 6, Draft 7, Draft 2019-09, Draft 2020-12
/// </summary>
public sealed class JsonSchemaValidationService
{
    /// <summary>
    /// Maps $schema URIs to their dialect names for proper validation
    /// </summary>
    private static readonly Dictionary<string, string> SchemaDialectMap = new(StringComparer.OrdinalIgnoreCase)
    {
        // Draft 7
        { "http://json-schema.org/draft-07/schema", "draft-07" },
        { "http://json-schema.org/draft-07/schema#", "draft-07" },
        { "https://json-schema.org/draft-07/schema", "draft-07" },
        { "https://json-schema.org/draft-07/schema#", "draft-07" },
        
        // Draft 2019-09
        { "https://json-schema.org/draft/2019-09/schema", "draft-2019-09" },
        { "https://json-schema.org/draft/2019-09/schema#", "draft-2019-09" },
        
        // Draft 2020-12
        { "https://json-schema.org/draft/2020-12/schema", "draft-2020-12" },
        { "https://json-schema.org/draft/2020-12/schema#", "draft-2020-12" },
        
        // Draft 6
        { "http://json-schema.org/draft-06/schema", "draft-06" },
        { "http://json-schema.org/draft-06/schema#", "draft-06" },
        { "https://json-schema.org/draft-06/schema", "draft-06" },
        { "https://json-schema.org/draft-06/schema#", "draft-06" },
        
        // Draft 4
        { "http://json-schema.org/draft-04/schema", "draft-04" },
        { "http://json-schema.org/draft-04/schema#", "draft-04" },
        { "https://json-schema.org/draft-04/schema", "draft-04" },
        { "https://json-schema.org/draft-04/schema#", "draft-04" }
    };

    /// <summary>
    /// Maps dialect codes to human-friendly labels for display in the UI
    /// </summary>
    private static readonly Dictionary<string, string> DraftLabelMap = new(StringComparer.OrdinalIgnoreCase)
    {
        { "draft-04", "Draft 4" },
        { "draft-06", "Draft 6" },
        { "draft-07", "Draft 7" },
        { "draft-2019-09", "Draft 2019-09" },
        { "draft-2020-12", "Draft 2020-12" }
    };

    /// <summary>
    /// Static constructor to configure the schema registry for multi-draft support
    /// </summary>
    static JsonSchemaValidationService()
    {
        // Dialects are automatically loaded by JsonSchema.Net when needed
        // No additional configuration required
    }
    /// <summary>
    /// Validates JSON data against a JSON Schema
    /// </summary>
    /// <param name="request">The validation request containing schema and data</param>
    /// <returns>Validation response with errors/warnings</returns>
    public ValidateJsonDataResponse ValidateJsonData(ValidateJsonDataRequest request)
    {
        var errors = new List<ValidationError>();
        string? detectedDraftLabel = null;

        if (string.IsNullOrWhiteSpace(request.Schema))
        {
            return new ValidateJsonDataResponse
            {
                IsValid = false,
                Errors = [new ValidationError { Message = "Schema is required." }],
                Summary = "Schema is empty",
                DetectedDraft = null
            };
        }

        if (string.IsNullOrWhiteSpace(request.JsonData))
        {
            return new ValidateJsonDataResponse
            {
                IsValid = false,
                Errors = [new ValidationError { Message = "JSON data is required." }],
                Summary = "JSON data is empty",
                DetectedDraft = null
            };
        }

        try
        {
            // Detect the schema draft early for inclusion in response
            string? detectedDialect = null;
            try
            {
                using var doc = JsonDocument.Parse(request.Schema);
                detectedDialect = DetectSchemaDraft(doc.RootElement);
                if (!string.IsNullOrEmpty(detectedDialect))
                {
                    detectedDraftLabel = ConvertDialectToLabel(detectedDialect);
                }
            }
            catch
            {
                // Draft detection failure is not fatal, continue with validation
            }

            // Parse the JSON schema with proper dialect detection
            JsonSchema? schema = null;
            try
            {
                schema = ParseSchemaWithDialectDetection(request.Schema);
            }
            catch (Exception schemaEx)
            {
                errors.Add(new ValidationError
                {
                    Message = $"Failed to parse schema: {schemaEx.Message}",
                    Exception = schemaEx.InnerException?.Message ?? schemaEx.StackTrace
                });
                return new ValidateJsonDataResponse
                {
                    IsValid = false,
                    Errors = [..errors],
                    Summary = "Schema parsing failed",
                    DetectedDraft = detectedDraftLabel
                };
            }

            if (schema == null)
            {
                errors.Add(new ValidationError
                {
                    Message = "Failed to create JSON Schema from provided content"
                });
                return new ValidateJsonDataResponse
                {
                    IsValid = false,
                    Errors = [..errors],
                    Summary = "Invalid schema",
                    DetectedDraft = detectedDraftLabel
                };
            }

            // Parse the JSON data
            JsonElement dataElement;
            try
            {
                using var doc = JsonDocument.Parse(request.JsonData);
                dataElement = doc.RootElement.Clone();
            }
            catch (JsonException jsonEx)
            {
                long bytePos = jsonEx.BytePositionInLine ?? 0;
                int linePos = (int)Math.Min(bytePos, (long)int.MaxValue);
                    
                errors.Add(new ValidationError
                {
                    Message = $"Invalid JSON data: {jsonEx.Message}",
                    LineNumber = (int)(jsonEx.LineNumber ?? 0),
                    LinePosition = linePos
                });
                return new ValidateJsonDataResponse
                {
                    IsValid = false,
                    Errors = [..errors],
                    Summary = "JSON data parsing failed",
                    DetectedDraft = detectedDraftLabel
                };
            }

            // Validate the data against the schema
            try
            {
                var options = new EvaluationOptions
                {
                    OutputFormat = OutputFormat.List
                };

                var results = schema.Evaluate(dataElement, options);

                if (!results.IsValid)
                {
                    if (results.Details != null && results.Details.Count > 0)
                    {
                        // Convert validation results to ValidationError objects
                        foreach (var detail in results.Details)
                        {
                            var message = detail.ToString();
                            if (string.IsNullOrEmpty(message))
                            {
                                message = "Validation failed";
                            }
                            
                            errors.Add(new ValidationError
                            {
                                Message = message
                            });
                        }
                    }
                    else
                    {
                        errors.Add(new ValidationError
                        {
                            Message = "JSON data does not match the provided schema"
                        });
                    }
                }
            }
            catch (Exception evaluateEx) when (evaluateEx.Message.Contains("Unknown keywords") || evaluateEx.Message.Contains("disallowed"))
            {
                // If evaluation fails due to unknown keywords, try re-parsing schema without metadata
                try
                {
                    using var doc = JsonDocument.Parse(request.Schema);
                    var schemaObj = doc.RootElement;
                    
                    if (schemaObj.ValueKind == JsonValueKind.Object)
                    {
                        // Build modified schema without $ properties
                        using var ms = new MemoryStream();
                        using var writer = new Utf8JsonWriter(ms, new JsonWriterOptions { Indented = false });
                        
                        writer.WriteStartObject();
                        foreach (var prop in schemaObj.EnumerateObject())
                        {
                            if (!prop.Name.StartsWith("$") && prop.Name != "__from" && prop.Name != "_from")
                            {
                                writer.WritePropertyName(prop.Name);
                                prop.Value.WriteTo(writer);
                            }
                        }
                        writer.WriteEndObject();
                        writer.Flush();
                        
                        var modifiedSchemaJson = System.Text.Encoding.UTF8.GetString(ms.ToArray());
                        var modifiedSchema = JsonSchema.FromText(modifiedSchemaJson);
                        
                        var options = new EvaluationOptions { OutputFormat = OutputFormat.List };
                        var results = modifiedSchema.Evaluate(dataElement, options);
                        
                        if (!results.IsValid && results.Details != null)
                        {
                            foreach (var detail in results.Details)
                            {
                                errors.Add(new ValidationError { Message = detail.ToString()! });
                            }
                        }
                    }
                    else
                    {
                        throw;
                    }
                }
                catch (Exception retryEx) when (retryEx == evaluateEx)
                {
                    // Retry failed, throw original
                    throw;
                }
                catch
                {
                    // Any other error during retry, throw original
                    throw evaluateEx;
                }
            }

            // Build summary
            string summary = errors.Count == 0
                ? "JSON data is valid"
                : $"JSON data has {errors.Count} validation error(s)";

            return new ValidateJsonDataResponse
            {
                IsValid = errors.Count == 0,
                Errors = [..errors],
                Summary = summary,
                DetectedDraft = detectedDraftLabel
            };
        }
        catch (Exception ex)
        {
            errors.Add(new ValidationError
            {
                Message = ex.Message,
                Exception = ex.InnerException?.Message ?? ex.StackTrace
            });

            return new ValidateJsonDataResponse
            {
                IsValid = false,
                Errors = [..errors],
                Summary = $"Validation failed: {ex.Message}",
                DetectedDraft = detectedDraftLabel
            };
        }
    }

    /// <summary>
    /// Parse a JSON schema with automatic dialect detection based on $schema property
    /// </summary>
    private static JsonSchema ParseSchemaWithDialectDetection(string schemaJson)
    {
        // First, parse the schema JSON to detect its dialect
        using var doc = JsonDocument.Parse(schemaJson);
        string? detectedDialect = DetectSchemaDraft(doc.RootElement);

        // Try to parse with the detected dialect first
        if (!string.IsNullOrEmpty(detectedDialect))
        {
            try
            {
                // Try parsing as-is with JsonSchema.FromText which respects the $schema directive
                return JsonSchema.FromText(schemaJson);
            }
            catch (Exception ex)
            {
                // If it fails, check if it's due to custom/unknown keywords (like schemastore's __from)
                string errorMsg = ex.Message ?? "";
                if (errorMsg.Contains("__from") || errorMsg.Contains("_from") || 
                    (errorMsg.Contains("Unknown keywords") && !IsStandardKeywordError(errorMsg, detectedDialect)))
                {
                    // Remove only truly custom keywords, preserve all standard draft keywords
                    try
                    {
                        var cleanedSchema = RemoveCustomKeywordsOnly(doc.RootElement, detectedDialect);
                        
                        using var ms = new MemoryStream();
                        using var writer = new Utf8JsonWriter(ms);
                        cleanedSchema.WriteTo(writer);
                        writer.Flush();
                        
                        var cleanedJson = System.Text.Encoding.UTF8.GetString(ms.ToArray());
                        return JsonSchema.FromText(cleanedJson);
                    }
                    catch
                    {
                        throw ex;
                    }
                }
                else
                {
                    throw;
                }
            }
        }
        else
        {
            // No $schema found, try default parsing
            try
            {
                return JsonSchema.FromText(schemaJson);
            }
            catch (Exception ex)
            {
                // If default parsing fails due to custom keywords, clean them
                string errorMsg = ex.Message ?? "";
                if (errorMsg.Contains("__from") || errorMsg.Contains("_from"))
                {
                    try
                    {
                        var cleanedSchema = RemoveCustomKeywordsOnly(doc.RootElement, null);
                        
                        using var ms = new MemoryStream();
                        using var writer = new Utf8JsonWriter(ms);
                        cleanedSchema.WriteTo(writer);
                        writer.Flush();
                        
                        var cleanedJson = System.Text.Encoding.UTF8.GetString(ms.ToArray());
                        return JsonSchema.FromText(cleanedJson);
                    }
                    catch
                    {
                        throw ex;
                    }
                }
                else
                {
                    throw;
                }
            }
        }
    }

    /// <summary>
    /// Detect the JSON Schema draft version from the $schema property
    /// </summary>
    private static string? DetectSchemaDraft(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return null;

        if (element.TryGetProperty("$schema", out var schemaProp) && schemaProp.ValueKind == JsonValueKind.String)
        {
            string schemaUri = schemaProp.GetString() ?? "";
            
            if (SchemaDialectMap.TryGetValue(schemaUri, out var dialect))
            {
                return dialect;
            }
            
            // Return the URI itself if not in our map (for debugging/extension)
            return schemaUri;
        }

        return null;
    }

    /// <summary>
    /// Convert dialect code to human-friendly label for UI display
    /// </summary>
    /// <param name="dialect">Dialect code (e.g., "draft-07", "draft-2020-12")</param>
    /// <returns>Human-friendly label (e.g., "Draft 7", "Draft 2020-12") or null if unknown</returns>
    private static string? ConvertDialectToLabel(string dialect)
    {
        if (string.IsNullOrEmpty(dialect))
            return null;

        // Try to look up in the map
        if (DraftLabelMap.TryGetValue(dialect, out var label))
        {
            return label;
        }

        // If not found and it looks like a URL, return null (it's likely unknown)
        if (dialect.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        // For unmapped dialect codes, return as-is for debugging
        return dialect;
    }

    /// <summary>
    /// Check if the error message contains only standard keywords for the detected dialect
    /// </summary>
    private static bool IsStandardKeywordError(string errorMsg, string? dialect)
    {
        // If we know the dialect, we could check for keywords known to be valid in that draft
        // For now, we consider non-custom keywords to be "standard" for the dialect
        
        // These are keywords from newer drafts that might not be in Draft 7
        string[] newerDraftKeywords = ["dependentSchemas", "dependentRequired", "prefixItems", "unevaluatedItems", "unevaluatedProperties"];
        
        foreach (var keyword in newerDraftKeywords)
        {
            if (errorMsg.Contains($"({keyword})"))
                return true;
        }
        
        return false;
    }

    /// <summary>
    /// Remove only custom/non-standard keywords from a schema, preserving all standard draft keywords
    /// This is conservative - only removes truly custom keywords like __from, not standard draft features
    /// </summary>
    private static JsonElement RemoveCustomKeywordsOnly(JsonElement element, string? dialect)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return element;

        using var ms = new MemoryStream();
        using var writer = new Utf8JsonWriter(ms);
        
        writer.WriteStartObject();
        
        foreach (var property in element.EnumerateObject())
        {
            // Only remove truly custom keywords from schemastore and other sources
            // Preserve all standard JSON Schema keywords, even if from Draft 7
            if (property.Name == "__from" || 
                property.Name == "_from" ||
                (property.Name.StartsWith("x-") && property.Name != "x-schema"))  // x- prefix but not x-schema
            {
                continue;
            }

            writer.WritePropertyName(property.Name);

            if (property.Value.ValueKind == JsonValueKind.Object)
            {
                RemoveCustomKeywordsOnly(property.Value, dialect).WriteTo(writer);
            }
            else if (property.Value.ValueKind == JsonValueKind.Array)
            {
                writer.WriteStartArray();
                foreach (var item in property.Value.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object)
                    {
                        RemoveCustomKeywordsOnly(item, dialect).WriteTo(writer);
                    }
                    else
                    {
                        item.WriteTo(writer);
                    }
                }
                writer.WriteEndArray();
            }
            else
            {
                property.Value.WriteTo(writer);
            }
        }
        
        writer.WriteEndObject();
        writer.Flush();

        using var doc = JsonDocument.Parse(ms.ToArray());
        return doc.RootElement.Clone();
    }
}




