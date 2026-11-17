using System.Text;
using Microsoft.AspNetCore.Mvc.Formatters;
using Microsoft.Net.Http.Headers;

namespace SchemaService.Services;

public sealed class RawXmlInputFormatter : TextInputFormatter
{
    public RawXmlInputFormatter()
    {
        SupportedEncodings.Add(Encoding.UTF8);
        SupportedEncodings.Add(Encoding.Unicode);
        SupportedMediaTypes.Add(MediaTypeHeaderValue.Parse("application/xml"));
        SupportedMediaTypes.Add(MediaTypeHeaderValue.Parse("text/xml"));
    }

    protected override bool CanReadType(Type type) => type == typeof(string);

    public override async Task<InputFormatterResult> ReadRequestBodyAsync(
        InputFormatterContext context,
        Encoding encoding)
    {
        using var reader = new StreamReader(
            context.HttpContext.Request.Body,
            encoding,
            detectEncodingFromByteOrderMarks: true,
            leaveOpen: true);
        var value = await reader.ReadToEndAsync(context.HttpContext.RequestAborted);
        return await InputFormatterResult.SuccessAsync(value);
    }
}
