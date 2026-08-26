using System.Text.Json;
using System.Text.Json.Nodes;
using SchemaService.Models;

namespace SchemaService.Services;

/// <summary>
/// Service for inferring JSON Schemas from JSON data
/// </summary>
public sealed class JsonSchemaInferenceService
{
    /// <summary>
    /// Infers a JSON Schema from JSON data
    /// </summary>
    /// <param name="request">The inference request containing JSON data</param>
    /// <returns>Response with inferred schema and any warnings</returns>
    public InferJsonSchemaResponse InferSchema(InferJsonSchemaRequest request)
    {
        var warnings = new List<string>();

        if (string.IsNullOrWhiteSpace(request.JsonData))
        {
            warnings.Add("JSON data is empty");
            return new InferJsonSchemaResponse
            {
                InferredSchema = JsonSerializer.Serialize(new { type = "object" }),
                Warnings = [..warnings]
            };
        }

        try
        {
            // Parse the JSON data
            JsonNode? dataNode = null;
            try
            {
                dataNode = JsonNode.Parse(request.JsonData);
            }
            catch (JsonException jsonEx)
            {
                warnings.Add($"Invalid JSON data: {jsonEx.Message}");
                return new InferJsonSchemaResponse
                {
                    InferredSchema = JsonSerializer.Serialize(new { type = "object" }),
                    Warnings = [..warnings]
                };
            }

            if (dataNode == null)
            {
                warnings.Add("Failed to parse JSON data");
                return new InferJsonSchemaResponse
                {
                    InferredSchema = JsonSerializer.Serialize(new { type = "object" }),
                    Warnings = [..warnings]
                };
            }

            // Infer schema from the data
            var inferredSchema = InferSchemaFromNode(dataNode);

            // Serialize the inferred schema to JSON string
            var schemaJson = JsonSerializer.Serialize(
                inferredSchema,
                new JsonSerializerOptions { WriteIndented = true }
            );

            return new InferJsonSchemaResponse
            {
                InferredSchema = schemaJson,
                Warnings = [..warnings]
            };
        }
        catch (Exception ex)
        {
            warnings.Add($"Error during schema inference: {ex.Message}");
            return new InferJsonSchemaResponse
            {
                InferredSchema = JsonSerializer.Serialize(new { type = "object" }),
                Warnings = [..warnings]
            };
        }
    }

    /// <summary>
    /// Recursively infers a schema from a JSON node
    /// </summary>
    private static Dictionary<string, object?> InferSchemaFromNode(JsonNode? node)
    {
        if (node == null)
        {
            return new Dictionary<string, object?> { { "type", "null" } };
        }

        return node switch
        {
            JsonValue value => InferSchemaFromValue(value),
            JsonObject obj => InferSchemaFromObject(obj),
            JsonArray arr => InferSchemaFromArray(arr),
            _ => new Dictionary<string, object?> { { "type", "object" } }
        };
    }

    /// <summary>
    /// Infers a schema from a JSON value
    /// </summary>
    private static Dictionary<string, object?> InferSchemaFromValue(JsonValue value)
    {
        if (value.TryGetValue(out string? _))
        {
            return new Dictionary<string, object?> { { "type", "string" } };
        }

        if (value.TryGetValue(out int _) || value.TryGetValue(out long _) || value.TryGetValue(out double _))
        {
            return new Dictionary<string, object?> { { "type", "number" } };
        }

        if (value.TryGetValue(out bool _))
        {
            return new Dictionary<string, object?> { { "type", "boolean" } };
        }

        if (value.GetValueKind() == System.Text.Json.JsonValueKind.Null)
        {
            return new Dictionary<string, object?> { { "type", "null" } };
        }

        return new Dictionary<string, object?> { { "type", "string" } };
    }

    /// <summary>
    /// Infers a schema from a JSON object
    /// </summary>
    private static Dictionary<string, object?> InferSchemaFromObject(JsonObject obj)
    {
        var schema = new Dictionary<string, object?> { { "type", "object" } };
        var properties = new Dictionary<string, object?>();
        var required = new List<string>();

        foreach (var property in obj)
        {
            properties[property.Key] = InferSchemaFromNode(property.Value);
            required.Add(property.Key);
        }

        schema["properties"] = properties;
        if (required.Count > 0)
        {
            schema["required"] = required;
        }

        return schema;
    }

    /// <summary>
    /// Infers a schema from a JSON array
    /// </summary>
    private static Dictionary<string, object?> InferSchemaFromArray(JsonArray arr)
    {
        var schema = new Dictionary<string, object?> { { "type", "array" } };

        if (arr.Count > 0)
        {
            // Infer schema from the first item and merge with others for uniform schema
            var itemSchemas = arr.Select(item => InferSchemaFromNode(item)).ToList();

            // Use the first item's schema as the base
            // In a more sophisticated implementation, you could merge multiple schemas
            if (itemSchemas.Count > 0)
            {
                schema["items"] = itemSchemas[0];

                // Add minItems if array is non-empty
                schema["minItems"] = 0;
            }
        }
        else
        {
            // Empty array - infer schema as allowing any type
            schema["items"] = new Dictionary<string, object?> { { "type", "object" } };
        }

        return schema;
    }
}
