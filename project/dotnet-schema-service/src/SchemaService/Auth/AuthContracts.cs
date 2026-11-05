using System.ComponentModel.DataAnnotations;

namespace SchemaService.Auth;

/// <summary>The signed-in account's available authentication methods.</summary>
public sealed record AuthUserResponse(string Email, bool EmailConfirmed, bool HasPassword, bool HasGoogleLogin);
/// <summary>Current session and a fresh antiforgery request token.</summary>
public sealed record SessionResponse(AuthUserResponse? User, bool GoogleEnabled, string CsrfToken);
/// <summary>A non-enumerating account action response.</summary>
public sealed record MessageResponse(string Message);
/// <summary>Email address for an account action.</summary>
public sealed record EmailRequest
{
    [Required, EmailAddress, MaxLength(254)]
    public required string Email { get; init; }
}
/// <summary>Credentials used to register or sign in.</summary>
public sealed record CredentialsRequest
{
    [Required, EmailAddress, MaxLength(254)]
    public required string Email { get; init; }
    [Required, MaxLength(128)]
    public required string Password { get; init; }
}
/// <summary>Verification information from an email link.</summary>
public sealed record ConfirmEmailRequest
{
    [Required, MaxLength(128)] public required string UserId { get; init; }
    [Required, MaxLength(4096)] public required string Token { get; init; }
}
/// <summary>New password and password-reset email token.</summary>
public sealed record ResetPasswordRequest
{
    [Required, EmailAddress, MaxLength(254)] public required string Email { get; init; }
    [Required, MaxLength(4096)] public required string Token { get; init; }
    [Required, MaxLength(128)] public required string Password { get; init; }
}
/// <summary>Change a password, or establish one after fresh Google authentication.</summary>
public sealed record PasswordRequest
{
    [MaxLength(128)] public string? CurrentPassword { get; init; }
    [Required, MaxLength(128)] public required string NewPassword { get; init; }
}
/// <summary>Start Google sign-in or link Google after verifying the current password.</summary>
public sealed record GoogleStartRequest
{
    [Required, RegularExpression("^(login|link)$")] public required string Mode { get; init; }
    [MaxLength(128)] public string? Password { get; init; }
}
/// <summary>The browser must navigate to this Google authorization URL.</summary>
public sealed record GoogleStartResponse(string Url);
/// <summary>Verify the current password before unlinking Google.</summary>
public sealed record GoogleUnlinkRequest
{
    [Required, MaxLength(128)] public required string Password { get; init; }
}
