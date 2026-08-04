using System.Xml;
using System.Xml.Schema;
using SchemaService.Models;

namespace SchemaService.Services;

public sealed class SchemaValidationService
{
    /// <summary>
    /// Validates an XSD schema for structural and compilation issues,
    /// including duplicate attributes, invalid restrictions, etc.
    /// </summary>
    public ValidateSchemaResponse ValidateSchema(ValidateSchemaRequest request)
    {
        var errors = new List<ValidationError>();
        var warnings = new List<ValidationError>();

        if (string.IsNullOrWhiteSpace(request.Schema))
        {
            return new ValidateSchemaResponse
            {
                IsValid = false,
                Errors = [new ValidationError { Message = "Schema content is required." }],
                Summary = "Schema is empty"
            };
        }

        try
        {
            var schemaSet = new XmlSchemaSet
            {
                XmlResolver = null  // Disable external entity resolution for security
            };

            // Capture validation events (errors and warnings during schema compilation)
            schemaSet.ValidationEventHandler += (sender, args) =>
            {
                var error = new ValidationError
                {
                    Message = args.Message,
                    LineNumber = args.Exception?.LineNumber ?? 0,
                    LinePosition = args.Exception?.LinePosition ?? 0,
                    Exception = args.Exception?.InnerException?.Message ?? args.Exception?.Message
                };

                if (args.Severity == XmlSeverityType.Error)
                {
                    errors.Add(error);
                }
                else
                {
                    warnings.Add(error);
                }
            };

            // Parse and compile the schema
            using (var reader = XmlReader.Create(new StringReader(request.Schema), new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                ConformanceLevel = ConformanceLevel.Document
            }))
            {
                var schema = XmlSchema.Read(reader, null);
                if (schema == null)
                {
                    errors.Add(new ValidationError
                    {
                        Message = "Failed to parse schema: XmlSchema.Read returned null"
                    });
                }
                else
                {
                    schemaSet.Add(schema);
                }
            }

            // Compile to trigger all validation
            schemaSet.Compile();

            // Build summary
            string summary = errors.Count == 0
                ? "Schema is valid"
                : $"Schema has {errors.Count} error(s){(warnings.Count > 0 ? $" and {warnings.Count} warning(s)" : "")}";

            return new ValidateSchemaResponse
            {
                IsValid = errors.Count == 0,
                Errors = [..errors],
                Warnings = [..warnings],
                Summary = summary
            };
        }
        catch (Exception ex)
        {
            errors.Add(new ValidationError
            {
                Message = ex.Message,
                Exception = ex.InnerException?.Message ?? ex.StackTrace
            });

            return new ValidateSchemaResponse
            {
                IsValid = false,
                Errors = [..errors],
                Warnings = [..warnings],
                Summary = $"Schema validation failed: {ex.Message}"
            };
        }
    }
}
