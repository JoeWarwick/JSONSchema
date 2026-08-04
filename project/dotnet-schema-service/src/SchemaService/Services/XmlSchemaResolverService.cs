using System.Xml;
using System.Xml.Schema;
using SchemaService.Models;

namespace SchemaService.Services;

public sealed class XmlSchemaResolverService
{
    private static readonly HttpClient HttpClient = new();

    public async Task<ValidateWithImportsResponse> ValidateWithImportsAsync(
        ValidateWithImportsRequest request,
        CancellationToken cancellationToken = default)
    {
        var errors = new List<ValidationError>();
        var warnings = new List<ValidationError>();

        try
        {
            var schemaSet = new XmlSchemaSet
            {
                XmlResolver = null
            };

            schemaSet.ValidationEventHandler += (sender, args) =>
            {
                var error = new ValidationError
                {
                    Message = args.Message,
                    Exception = args.Exception?.Message
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

            // Load main schema
            var readerSettings = new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null
            };

            readerSettings.ValidationEventHandler += (sender, args) =>
            {
                if (args.Severity == XmlSeverityType.Error)
                {
                    errors.Add(new ValidationError { Message = args.Message, Exception = args.Exception?.Message });
                }
                else
                {
                    warnings.Add(new ValidationError { Message = args.Message, Exception = args.Exception?.Message });
                }
            };

            using (var stringReader = new StringReader(request.Schema))
            using (var xmlReader = XmlReader.Create(stringReader, readerSettings))
            {
                schemaSet.Add(null, xmlReader);
            }

            // Resolve imports
            var baseUri = string.IsNullOrWhiteSpace(request.BaseUri) ? null : new Uri(request.BaseUri);
            await ResolveImportsAsync(request.Schema, schemaSet, baseUri, cancellationToken);

            // Compile schema
            schemaSet.Compile();

            // Validate XML instance
            var validationSettings = new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                Schemas = schemaSet,
                ValidationType = ValidationType.Schema
            };

            validationSettings.ValidationEventHandler += (sender, args) =>
            {
                var error = new ValidationError
                {
                    Message = args.Message,
                    LineNumber = args.Exception?.LineNumber ?? 0,
                    LinePosition = args.Exception?.LinePosition ?? 0,
                    Exception = args.Exception?.Message
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

            using (var stringReader = new StringReader(request.XmlInstance))
            using (var xmlReader = XmlReader.Create(stringReader, validationSettings))
            {
                while (xmlReader.Read()) { }
            }

            return new ValidateWithImportsResponse
            {
                IsValid = errors.Count == 0,
                Errors = errors.ToArray(),
                Warnings = warnings.ToArray()
            };
        }
        catch (Exception ex)
        {
            return new ValidateWithImportsResponse
            {
                IsValid = false,
                Errors = new[]
                {
                    new ValidationError
                    {
                        Message = $"Schema validation failed: {ex.Message}",
                        Exception = ex.ToString()
                    }
                },
                Warnings = warnings.ToArray()
            };
        }
    }

    private async Task ResolveImportsAsync(
        string schemaContent,
        XmlSchemaSet schemaSet,
        Uri? baseUri,
        CancellationToken cancellationToken)
    {
        var doc = new XmlDocument { XmlResolver = null };
        doc.LoadXml(schemaContent);

        var imports = doc.GetElementsByTagName("import", "http://www.w3.org/2001/XMLSchema");
        foreach (XmlElement importElem in imports)
        {
            var schemaLocation = importElem.GetAttribute("schemaLocation");
            var namespaceUri = importElem.GetAttribute("namespace");

            if (string.IsNullOrWhiteSpace(schemaLocation))
            {
                continue;
            }

            try
            {
                var resolvedUri = ResolveUri(schemaLocation, baseUri);
                var importedSchema = await FetchSchemaAsync(resolvedUri, cancellationToken);

                if (!string.IsNullOrWhiteSpace(importedSchema))
                {
                    var readerSettings = new XmlReaderSettings
                    {
                        DtdProcessing = DtdProcessing.Prohibit,
                        XmlResolver = null
                    };

                    using (var stringReader = new StringReader(importedSchema))
                    using (var xmlReader = XmlReader.Create(stringReader, readerSettings))
                    {
                        schemaSet.Add(namespaceUri, xmlReader);
                    }

                    // Recursively resolve imports in fetched schema
                    await ResolveImportsAsync(importedSchema, schemaSet, new Uri(resolvedUri), cancellationToken);
                }
            }
            catch (Exception ex)
            {
                // Log import resolution failure but don't fail validation
                System.Diagnostics.Debug.WriteLine($"Failed to resolve import: {schemaLocation} - {ex.Message}");
            }
        }
    }

    private static string ResolveUri(string schemaLocation, Uri? baseUri)
    {
        if (Uri.TryCreate(new Uri("http://example.com"), schemaLocation, out var result))
        {
            return result.ToString();
        }

        if (baseUri != null && Uri.TryCreate(baseUri, schemaLocation, out var resolvedUri))
        {
            return resolvedUri.ToString();
        }

        return schemaLocation;
    }

    private static async Task<string> FetchSchemaAsync(string uri, CancellationToken cancellationToken)
    {
        try
        {
            if (uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return await HttpClient.GetStringAsync(uri, cancellationToken);
            }
            else if (uri.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
            {
                var path = new Uri(uri).LocalPath;
                return await File.ReadAllTextAsync(path, cancellationToken);
            }
            else if (File.Exists(uri))
            {
                return await File.ReadAllTextAsync(uri, cancellationToken);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to fetch schema from {uri}: {ex.Message}");
        }

        return string.Empty;
    }
}
