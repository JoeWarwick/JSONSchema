using Microsoft.AspNetCore.Mvc;
using SchemaService.Models;
using SchemaService.Services;

namespace SchemaService.Controllers;

[ApiController]
[Route("api/transform")]
public sealed class TransformController(ITransformService service, ILogger<TransformController> logger) : ControllerBase
{
    /// <summary>Runs an XSLT 1.0 preview in an isolated process with a five-second limit.</summary>
    [HttpPost("preview")]
    [RequestSizeLimit(12_100_000)]
    [ProducesResponseType<TransformResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status408RequestTimeout)]
    public async Task<ActionResult<TransformResponse>> Preview(TransformRequest request, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(new TransformResponse(await service.ExecuteAsync(request, cancellationToken)));
        }
        catch (ArgumentException error)
        {
            logger.LogWarning(error, "Invalid transform preview");
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid transform", detail: error.Message);
        }
        catch (TimeoutException error)
        {
            logger.LogWarning(error, "Transform preview timed out");
            return Problem(statusCode: StatusCodes.Status408RequestTimeout, title: "Transform timed out", detail: error.Message);
        }
        catch (InvalidOperationException error)
        {
            logger.LogError(error, "Transform preview unavailable");
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Transform preview unavailable",
                detail: "The preview worker is busy or unavailable. Try again shortly.");
        }
    }
}
