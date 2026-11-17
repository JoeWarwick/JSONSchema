using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
using System.Text;
using SchemaService.Auth;
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
    [Authorize]
    [ServiceFilter(typeof(AuthCsrfFilter))]
    public async Task<IActionResult> GenerateSqlite(
        [FromBody] GenerateSqliteSchemaRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var ownerId = GetOwnerId();
            await erdWorkbenchDatabaseService.SyncAsync(request, cancellationToken, ownerId);
            var database = await erdWorkbenchDatabaseService.ExportAsync(request.WorkbenchId, cancellationToken, ownerId);
            return File(database, "application/vnd.sqlite3", "schema-sculptor.sqlite");
        }
        catch (UnauthorizedAccessException)
        {
            return NotFound("The ERD workbench does not exist or is not accessible.");
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
    [Authorize]
    [ServiceFilter(typeof(AuthCsrfFilter))]
    public async Task<ActionResult<ErdWorkbenchSnapshot>> SyncErdDatabase(
        [FromBody] GenerateSqliteSchemaRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await erdWorkbenchDatabaseService.SyncAsync(request, cancellationToken, GetOwnerId()));
        }
        catch (UnauthorizedAccessException)
        {
            return NotFound("The ERD workbench does not exist or is not accessible.");
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
    [Authorize]
    public async Task<ActionResult<ErdWorkbenchSnapshot>> GetErdDatabase(
        string workbenchId,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await erdWorkbenchDatabaseService.GetSnapshotAsync(workbenchId, cancellationToken, GetOwnerId()));
        }
        catch (UnauthorizedAccessException)
        {
            return NotFound("The ERD workbench does not exist or is not accessible.");
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    [HttpGet("erd-xml/{workbenchId}/{rootTableId}/{rowId:long}")]
    [Authorize]
    [ProducesResponseType(typeof(string), StatusCodes.Status200OK, "application/xml")]
    public async Task<IActionResult> GetErdXmlRecord(
        string workbenchId,
        string rootTableId,
        long rowId,
        CancellationToken cancellationToken)
    {
        try
        {
            var xml = await erdWorkbenchDatabaseService.ReadXmlRecordAsync(
                workbenchId,
                rootTableId,
                rowId,
                GetOwnerId(),
                cancellationToken);
            Response.Headers["X-ERD-Row-Id"] = rowId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Content(xml, "application/xml", Encoding.UTF8);
        }
        catch (UnauthorizedAccessException)
        {
            return NotFound("The ERD workbench does not exist or is not accessible.");
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(ex.Message);
        }
    }

    [HttpPost("erd-xml/{workbenchId}/{rootTableId}")]
    [Authorize]
    [ServiceFilter(typeof(AuthCsrfFilter))]
    [Consumes("application/xml", "text/xml")]
    [ProducesResponseType(typeof(string), StatusCodes.Status200OK, "application/xml")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> CreateErdXmlRecord(
        string workbenchId,
        string rootTableId,
        [FromBody] string xml,
        CancellationToken cancellationToken)
    {
        try
        {
            var saved = await erdWorkbenchDatabaseService.SaveXmlRecordAsync(
                workbenchId,
                rootTableId,
                null,
                xml,
                GetOwnerId(),
                cancellationToken);
            Response.Headers["X-ERD-Row-Id"] = saved.RowId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Content(saved.Xml, "application/xml", Encoding.UTF8);
        }
        catch (UnauthorizedAccessException)
        {
            return NotFound("The ERD workbench does not exist or is not accessible.");
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return BadRequest($"The XML graph violates a SQLite constraint: {ex.Message}");
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPut("erd-xml/{workbenchId}/{rootTableId}/{rowId:long}")]
    [Authorize]
    [ServiceFilter(typeof(AuthCsrfFilter))]
    [Consumes("application/xml", "text/xml")]
    [ProducesResponseType(typeof(string), StatusCodes.Status200OK, "application/xml")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> UpdateErdXmlRecord(
        string workbenchId,
        string rootTableId,
        long rowId,
        [FromBody] string xml,
        CancellationToken cancellationToken)
    {
        try
        {
            var saved = await erdWorkbenchDatabaseService.SaveXmlRecordAsync(
                workbenchId,
                rootTableId,
                rowId,
                xml,
                GetOwnerId(),
                cancellationToken);
            Response.Headers["X-ERD-Row-Id"] = saved.RowId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Content(saved.Xml, "application/xml", Encoding.UTF8);
        }
        catch (UnauthorizedAccessException)
        {
            return NotFound("The ERD workbench does not exist or is not accessible.");
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return BadRequest($"The XML graph violates a SQLite constraint: {ex.Message}");
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost("erd-database/{workbenchId}/records")]
    [Authorize]
    [ServiceFilter(typeof(AuthCsrfFilter))]
    public async Task<ActionResult<ErdWorkbenchRecord>> SaveErdRecord(
        string workbenchId,
        [FromBody] SaveErdWorkbenchRecordRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await erdWorkbenchDatabaseService.SaveRecordAsync(workbenchId, request, cancellationToken, GetOwnerId()));
        }
        catch (UnauthorizedAccessException)
        {
            return NotFound("The ERD workbench does not exist or is not accessible.");
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

    [HttpPost("erd-database/{workbenchId}/relationships/unlink")]
    [Authorize]
    [ServiceFilter(typeof(AuthCsrfFilter))]
    public async Task<IActionResult> UnlinkErdRelationship(
        string workbenchId,
        [FromBody] DeleteErdWorkbenchJunctionRecordRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            await erdWorkbenchDatabaseService.DeleteJunctionRecordAsync(workbenchId, request, cancellationToken, GetOwnerId());
            return NoContent();
        }
        catch (UnauthorizedAccessException)
        {
            return NotFound("The ERD workbench does not exist or is not accessible.");
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return BadRequest($"The junction record cannot be unlinked because it is still referenced: {ex.Message}");
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    private string GetOwnerId() =>
        User.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new UnauthorizedAccessException("An authenticated account is required.");

}
