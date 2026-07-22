using Microsoft.AspNetCore.Mvc;
using SchemaService.Models;
using SchemaService.Services;

namespace SchemaService.Controllers;

[ApiController]
[Route("api/schema")]
public sealed class SchemaController : ControllerBase
{
    private readonly SchemaInferenceService schemaInferenceService;
    private readonly DefaultInstanceService defaultInstanceService;

    public SchemaController(SchemaInferenceService schemaInferenceService, DefaultInstanceService defaultInstanceService)
    {
        this.schemaInferenceService = schemaInferenceService;
        this.defaultInstanceService = defaultInstanceService;
    }

    [HttpPost("from-xml")]
    public async Task<ActionResult<InferSchemaResponse>> InferFromXml([FromBody] InferSchemaRequest request, CancellationToken cancellationToken)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest("XML content is required.");
        }

        var response = await schemaInferenceService.InferFromXmlAsync(request, cancellationToken);
        return Ok(response);
    }

    [HttpPost("default-instance")]
    public ActionResult<DefaultInstanceResponse> CreateDefaultInstance([FromBody] DefaultInstanceRequest request)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Schema))
        {
            return BadRequest("Schema is required.");
        }

        var response = defaultInstanceService.Create(request);
        return Ok(response);
    }
}
