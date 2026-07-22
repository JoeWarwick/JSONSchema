using System.Xml;
using System.Xml.Schema;
using SchemaService.Models;
namespace SchemaService.Services;

public sealed class SchemaInferenceService
{
    private readonly XmlSchemaLocationService xmlSchemaLocationService;

    public SchemaInferenceService(XmlSchemaLocationService xmlSchemaLocationService)
    {
        this.xmlSchemaLocationService = xmlSchemaLocationService;
    }

    public async Task<InferSchemaResponse> InferFromXmlAsync(InferSchemaRequest request, CancellationToken cancellationToken = default)
    {
        var warnings = new List<string>();
        Uri? baseUri = null;

        if (!string.IsNullOrWhiteSpace(request.SourceUri) && Uri.TryCreate(request.SourceUri, UriKind.Absolute, out var parsedBaseUri))
        {
            baseUri = parsedBaseUri;
        }

        var schemaLocationResult = xmlSchemaLocationService.TryExtractSchemaLocations(request.Content, baseUri);
        if (request.PreferSchemaLocation && schemaLocationResult.HasAnyLocations)
        {
            return new InferSchemaResponse
            {
                Mode = "schemaLocation",
                RawXml = request.Content,
                SchemaUrls = schemaLocationResult.ResolvedUrls,
                Warnings = warnings.ToArray()
            };
        }

        try
        {
            var inference = new XmlSchemaInference();
            var readerSettings = new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null
            };

            using var stringReader = new StringReader(request.Content);
            using var xmlReader = XmlReader.Create(stringReader, readerSettings);

            var schemaSet = inference.InferSchema(xmlReader);
            var builder = new StringWriter();
            foreach (XmlSchema schema in schemaSet.Schemas())
            {
                schema.Write(builder);
            }

            await Task.CompletedTask;
            return new InferSchemaResponse
            {
                Mode = "inferred",
                InferredSchema = builder.ToString(),
                RawXml = request.Content,
                Warnings = warnings.ToArray()
            };
        }
        catch (Exception ex)
        {
            warnings.Add(ex.Message);
            return new InferSchemaResponse
            {
                Mode = "error",
                RawXml = request.Content,
                Warnings = warnings.ToArray()
            };
        }
    }
}
