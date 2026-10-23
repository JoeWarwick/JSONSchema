using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Xsl;
using SchemaService.Models;

namespace SchemaService.Services;

public static class TransformWorker
{
    public const int MaxCharacters = 1_000_000;

    public static string Execute(TransformRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Input) || string.IsNullOrWhiteSpace(request.Stylesheet))
            throw new ArgumentException("XML input and an XSLT stylesheet are required.");
        if (request.Input.Length > MaxCharacters || request.Stylesheet.Length > MaxCharacters)
            throw new ArgumentException("Preview input exceeds the 1,000,000 character limit.");

        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaxCharacters
        };
        using var stylesheet = XmlReader.Create(new StringReader(request.Stylesheet), settings);
        var transform = new XslCompiledTransform();
        transform.Load(stylesheet, new XsltSettings(enableDocumentFunction: false, enableScript: false), stylesheetResolver: null);
        using var input = XmlReader.Create(new StringReader(request.Input), settings);
        using var output = new LimitedWriter();
        var outputSettings = transform.OutputSettings?.Clone() ?? new XmlWriterSettings();
        outputSettings.Encoding = Encoding.UTF8;
        using (var writer = XmlWriter.Create(output, outputSettings))
            transform.Transform(input, arguments: null, writer);
        return output.ToString();
    }

    public static async Task RunAsync()
    {
        TransformWorkerResponse response;
        try
        {
            var text = await Console.In.ReadToEndAsync();
            var request = JsonSerializer.Deserialize<TransformRequest>(text)
                ?? throw new ArgumentException("A transform request is required.");
            response = new TransformWorkerResponse(Execute(request), null);
        }
        catch (Exception error) when (error is XmlException or XsltException or ArgumentException or InvalidOperationException)
        {
            response = new TransformWorkerResponse(null, error.Message);
        }
        await Console.Out.WriteAsync(JsonSerializer.Serialize(response));
    }

    private sealed class LimitedWriter : StringWriter
    {
        public override Encoding Encoding => Encoding.UTF8;

        private void Check(int count)
        {
            if (GetStringBuilder().Length + count > MaxCharacters)
                throw new InvalidOperationException("Transform output exceeds the 1,000,000 character preview limit.");
        }

        public override void Write(char value) { Check(1); base.Write(value); }
        public override void Write(string? value) { Check(value?.Length ?? 0); base.Write(value); }
        public override void Write(char[] buffer, int index, int count) { Check(count); base.Write(buffer, index, count); }
        public override void Write(ReadOnlySpan<char> buffer) { Check(buffer.Length); base.Write(buffer); }
    }
}
