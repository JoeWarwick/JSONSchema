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
    private readonly XmlSchemaResolverService schemaResolverService;
    private readonly SchemaValidationService schemaValidationService;

    public SchemaController(
        SchemaInferenceService schemaInferenceService,
        DefaultInstanceService defaultInstanceService,
        XmlSchemaResolverService schemaResolverService,
        SchemaValidationService schemaValidationService)
    {
        this.schemaInferenceService = schemaInferenceService;
        this.defaultInstanceService = defaultInstanceService;
        this.schemaResolverService = schemaResolverService;
        this.schemaValidationService = schemaValidationService;
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

    [HttpPost("validate-with-imports")]
    public async Task<ActionResult<ValidateWithImportsResponse>> ValidateWithImports(
        [FromBody] ValidateWithImportsRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Schema) || string.IsNullOrWhiteSpace(request.XmlInstance))
        {
            return BadRequest("Schema and XmlInstance are required.");
        }

        var response = await schemaResolverService.ValidateWithImportsAsync(request, cancellationToken);
        return Ok(response);
    }

    [HttpPost("validate")]
    public ActionResult<ValidateSchemaResponse> ValidateSchema([FromBody] ValidateSchemaRequest request)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Schema))
        {
            return BadRequest("Schema is required.");
        }

        var response = schemaValidationService.ValidateSchema(request);
        return Ok(response);
    }
}
