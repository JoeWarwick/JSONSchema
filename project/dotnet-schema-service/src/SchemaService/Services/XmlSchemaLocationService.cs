using System.Xml;

namespace SchemaService.Services;

public sealed record SchemaLocationResult(string[] Locations, string[] ResolvedUrls)
{
    public static SchemaLocationResult Empty { get; } = new(Array.Empty<string>(), Array.Empty<string>());

    public bool HasAnyLocations => Locations.Length > 0;
}

public sealed class XmlSchemaLocationService
{
    public SchemaLocationResult TryExtractSchemaLocations(string xml, Uri? baseUri = null)
    {
        if (string.IsNullOrWhiteSpace(xml))
        {
            return SchemaLocationResult.Empty;
        }

        try
        {
            var document = new XmlDocument
            {
                XmlResolver = null
            };

            document.LoadXml(xml);

            var root = document.DocumentElement;
            if (root is null)
            {
                return SchemaLocationResult.Empty;
            }

            var xsiNamespace = "http://www.w3.org/2001/XMLSchema-instance";
            var locations = new List<string>();

            var noNamespace = root.GetAttribute("noNamespaceSchemaLocation", xsiNamespace);
            if (!string.IsNullOrWhiteSpace(noNamespace))
            {
                locations.Add(noNamespace.Trim());
            }

            var schemaLocation = root.GetAttribute("schemaLocation", xsiNamespace);
            if (!string.IsNullOrWhiteSpace(schemaLocation))
            {
                var tokens = schemaLocation
                    .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

                for (var index = 1; index < tokens.Length; index += 2)
                {
                    locations.Add(tokens[index]);
                }
            }

            var distinctLocations = locations
                .Where(location => !string.IsNullOrWhiteSpace(location))
                .Select(location => location.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            var resolvedUrls = distinctLocations
                .Select(location => ResolveLocation(location, baseUri))
                .Where(location => !string.IsNullOrWhiteSpace(location))
                .Select(location => location!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            return new SchemaLocationResult(distinctLocations, resolvedUrls);
        }
        catch
        {
            return SchemaLocationResult.Empty;
        }
    }

    private static string? ResolveLocation(string location, Uri? baseUri)
    {
        if (Uri.TryCreate(location, UriKind.Absolute, out var absoluteUri))
        {
            return absoluteUri.ToString();
        }

        if (baseUri is not null && baseUri.IsAbsoluteUri)
        {
            return new Uri(baseUri, location).ToString();
        }

        return location;
    }
}
