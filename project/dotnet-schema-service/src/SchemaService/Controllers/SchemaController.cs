using Microsoft.Data.Sqlite;
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
    private readonly JsonSchemaValidationService jsonSchemaValidationService;
    private readonly JsonSchemaInferenceService jsonSchemaInferenceService;
    private readonly ErdWorkbenchDatabaseService erdWorkbenchDatabaseService;

    public SchemaController(
        SchemaInferenceService schemaInferenceService,
        DefaultInstanceService defaultInstanceService,
        XmlSchemaResolverService schemaResolverService,
        SchemaValidationService schemaValidationService,
        JsonSchemaValidationService jsonSchemaValidationService,
        JsonSchemaInferenceService jsonSchemaInferenceService,
        ErdWorkbenchDatabaseService erdWorkbenchDatabaseService)
    {
        this.schemaInferenceService = schemaInferenceService;
        this.defaultInstanceService = defaultInstanceService;
        this.schemaResolverService = schemaResolverService;
        this.schemaValidationService = schemaValidationService;
        this.jsonSchemaValidationService = jsonSchemaValidationService;
        this.jsonSchemaInferenceService = jsonSchemaInferenceService;
        this.erdWorkbenchDatabaseService = erdWorkbenchDatabaseService;
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

        try
        {
            var response = defaultInstanceService.Create(request);
            return Ok(response);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
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

    [HttpPost("validate-json")]
    public ActionResult<ValidateJsonDataResponse> ValidateJsonData([FromBody] ValidateJsonDataRequest request)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Schema) || string.IsNullOrWhiteSpace(request.JsonData))
        {
            return BadRequest("Both schema and jsonData are required.");
        }

        var response = jsonSchemaValidationService.ValidateJsonData(request);
        return Ok(response);
    }

    [HttpPost("infer-json-schema")]
    public ActionResult<InferJsonSchemaResponse> InferJsonSchema([FromBody] InferJsonSchemaRequest request)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.JsonData))
        {
            return BadRequest("JSON data is required.");
        }

        var response = jsonSchemaInferenceService.InferSchema(request);
        return Ok(response);
    }

    [HttpPost("generate-sqlite")]
    public async Task<IActionResult> GenerateSqlite(
        [FromBody] GenerateSqliteSchemaRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            await erdWorkbenchDatabaseService.SyncAsync(request, cancellationToken);
            var database = await erdWorkbenchDatabaseService.ExportAsync(request.WorkbenchId, cancellationToken);
            return File(database, "application/vnd.sqlite3", "schema-sculptor.sqlite");
        }
        catch (SqliteSchemaCompatibilityException ex)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "SQLite schema update requires attention", detail: ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost("erd-database/sync")]
    public async Task<ActionResult<ErdWorkbenchSnapshot>> SyncErdDatabase(
        [FromBody] GenerateSqliteSchemaRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await erdWorkbenchDatabaseService.SyncAsync(request, cancellationToken));
        }
        catch (SqliteSchemaCompatibilityException ex)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "SQLite schema update requires attention", detail: ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpGet("erd-database/{workbenchId}")]
    public async Task<ActionResult<ErdWorkbenchSnapshot>> GetErdDatabase(
        string workbenchId,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await erdWorkbenchDatabaseService.GetSnapshotAsync(workbenchId, cancellationToken));
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    [HttpPost("erd-database/{workbenchId}/records")]
    public async Task<ActionResult<ErdWorkbenchRecord>> SaveErdRecord(
        string workbenchId,
        [FromBody] SaveErdWorkbenchRecordRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await erdWorkbenchDatabaseService.SaveRecordAsync(workbenchId, request, cancellationToken));
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return BadRequest($"The record violates a SQLite constraint: {ex.Message}");
        }
        catch (FormatException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
    }
}
