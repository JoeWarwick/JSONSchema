using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SchemaService.Auth;

namespace SchemaService.Controllers;

[ApiController]
[Route("api/auth")]
[EnableRateLimiting("auth")]
[ServiceFilter(typeof(AuthCsrfFilter))]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AuthController(IAccountService accounts, AuthOptions options, IAntiforgery antiforgery,
    IDataProtectionProvider protection) : ControllerBase
{
    private static MessageResponse GenericMessage => new("If the account is eligible, an email has been sent.");
    private IActionResult Result(IdentityResult result) => result.Succeeded
        ? Ok(new MessageResponse("Account updated."))
        : Problem(statusCode: 400, title: "Account action failed", detail: string.Join(" ", result.Errors.Select(error => error.Description)));

    [HttpGet("session")]
    public async Task<ActionResult<SessionResponse>> Session(CancellationToken ct)
    {
        var tokens = antiforgery.GetAndStoreTokens(HttpContext);
        return Ok(new SessionResponse(await accounts.GetUserAsync(User), options.GoogleEnabled, tokens.RequestToken!));
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register(CredentialsRequest request, CancellationToken ct)
    {
        var result = await accounts.RegisterAsync(request, ct);
        return result.Succeeded ? Ok(GenericMessage) : Result(result);
    }
    [HttpPost("login")]
    public async Task<IActionResult> Login(CredentialsRequest request, CancellationToken ct)
    {
        var user = await accounts.LoginAsync(request);
        return user is null ? Problem(statusCode: 401, title: "Sign-in failed",
            detail: "Invalid credentials, unverified email, or temporarily locked account.") : Ok(user);
    }
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        await accounts.LogoutAsync();
        return NoContent();
    }
    [HttpPost("forgot-password")]
    public async Task<IActionResult> Forgot(EmailRequest request, CancellationToken ct)
    {
        await accounts.SendResetAsync(request.Email, ct);
        return Ok(GenericMessage);
    }
    [HttpPost("resend-confirmation")]
    public async Task<IActionResult> Resend(EmailRequest request, CancellationToken ct)
    {
        await accounts.SendConfirmationAsync(request.Email, ct);
        return Ok(GenericMessage);
    }
    [HttpPost("confirm-email")]
    public async Task<IActionResult> Confirm(ConfirmEmailRequest request, CancellationToken ct) => Result(await accounts.ConfirmAsync(request));
    [HttpPost("reset-password")]
    public async Task<IActionResult> Reset(ResetPasswordRequest request, CancellationToken ct) => Result(await accounts.ResetAsync(request));
    [Authorize]
    [HttpPost("password")]
    public async Task<IActionResult> Password(PasswordRequest request, CancellationToken ct) => Result(await accounts.PasswordAsync(User, request));
    [HttpPost("google/start")]
    public async Task<IActionResult> GoogleStart(GoogleStartRequest request, CancellationToken ct)
    {
        if (!options.GoogleEnabled) return Problem(statusCode: 404, title: "Google sign-in is disabled.");
        var properties = await accounts.GooglePropertiesAsync(User, request);
        if (properties is null) return Problem(statusCode: 400, title: "Google sign-in unavailable",
            detail: "Linking requires a verified signed-in account and its current password. Sign out before starting a new sign-in.");
        properties.ExpiresUtc = DateTimeOffset.UtcNow.AddMinutes(5);
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        properties.Items["nonce"] = nonce;
        Response.Cookies.Append("SchemaService.GoogleStart", nonce, new CookieOptions
        {
            HttpOnly = true, SameSite = SameSiteMode.Lax, Secure = Request.IsHttps,
            Path = "/api/auth/google/challenge", MaxAge = TimeSpan.FromMinutes(5)
        });
        var state = new PropertiesDataFormat(protection.CreateProtector("GoogleStart")).Protect(properties);
        return Ok(new GoogleStartResponse("/api/auth/google/challenge?state=" + Uri.EscapeDataString(state)));
    }
    [HttpGet("google/challenge")]
    public IActionResult GoogleChallenge([FromQuery] string state, CancellationToken ct)
    {
        if (!options.GoogleEnabled) return Problem(statusCode: 404, title: "Google sign-in is disabled.");
        var properties = new PropertiesDataFormat(protection.CreateProtector("GoogleStart")).Unprotect(state);
        if (properties is null || properties.ExpiresUtc is null || properties.ExpiresUtc < DateTimeOffset.UtcNow ||
            !properties.Items.TryGetValue("nonce", out var nonce) || string.IsNullOrEmpty(nonce) ||
            Request.Cookies["SchemaService.GoogleStart"] != nonce)
            return Problem(statusCode: 400, title: "Invalid or expired Google sign-in request.");
        Response.Cookies.Delete("SchemaService.GoogleStart", new CookieOptions { Path = "/api/auth/google/challenge" });
        if (properties.Items.TryGetValue("link-user", out var expectedUser) && expectedUser is not null &&
            User.FindFirstValue(ClaimTypes.NameIdentifier) != expectedUser)
            return Problem(statusCode: 401, title: "Sign in again before linking Google.");
        properties.Items.Remove("nonce");
        return Challenge(properties, "Google");
    }
    [HttpGet("google/callback")]
    public async Task<IActionResult> GoogleCallback(CancellationToken ct)
    {
        if (!options.GoogleEnabled) return Problem(statusCode: 404, title: "Google sign-in is disabled.");
        var error = await accounts.GoogleCallbackAsync(User);
        await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);
        return Redirect(options.FrontendOrigin + (error is null ? "/?auth=google-success" :
            "/?auth=google-error&code=" + Uri.EscapeDataString(error)));
    }
    [Authorize]
    [HttpPost("google/unlink")]
    public async Task<IActionResult> GoogleUnlink(GoogleUnlinkRequest request, CancellationToken ct) =>
        Result(await accounts.UnlinkAsync(User, request.Password));
}
