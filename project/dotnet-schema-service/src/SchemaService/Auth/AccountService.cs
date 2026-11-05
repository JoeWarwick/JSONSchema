using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;

namespace SchemaService.Auth;

public interface IAccountService
{
    Task<AuthUserResponse?> GetUserAsync(ClaimsPrincipal principal);
    Task<IdentityResult> RegisterAsync(CredentialsRequest request, CancellationToken ct);
    Task<AuthUserResponse?> LoginAsync(CredentialsRequest request);
    Task LogoutAsync();
    Task SendConfirmationAsync(string email, CancellationToken ct);
    Task SendResetAsync(string email, CancellationToken ct);
    Task<IdentityResult> ConfirmAsync(ConfirmEmailRequest request);
    Task<IdentityResult> ResetAsync(ResetPasswordRequest request);
    Task<IdentityResult> PasswordAsync(ClaimsPrincipal principal, PasswordRequest request);
    Task<AuthenticationProperties?> GooglePropertiesAsync(ClaimsPrincipal principal, GoogleStartRequest request);
    Task<string?> GoogleCallbackAsync(ClaimsPrincipal principal);
    Task<IdentityResult> UnlinkAsync(ClaimsPrincipal principal, string password);
}

public sealed class AccountService(UserManager<IdentityUser> users, SignInManager<IdentityUser> signIn,
    IAuthEmailSender emailSender, AuthOptions options, IHttpContextAccessor accessor) : IAccountService
{
    private static IdentityResult Failure(string message) =>
        IdentityResult.Failed(new IdentityError { Code = "AccountActionFailed", Description = message });
    private static string Encode(string token) => WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
    private static string? Decode(string token)
    {
        try { return Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token)); }
        catch (FormatException) { return null; }
    }
    private async Task<AuthUserResponse> MapAsync(IdentityUser user) => new(user.Email!, user.EmailConfirmed,
        await users.HasPasswordAsync(user), (await users.GetLoginsAsync(user)).Any(login => login.LoginProvider == "Google"));
    public async Task<AuthUserResponse?> GetUserAsync(ClaimsPrincipal principal)
    {
        var user = await users.GetUserAsync(principal);
        return user is null ? null : await MapAsync(user);
    }
    public async Task<IdentityResult> RegisterAsync(CredentialsRequest request, CancellationToken ct)
    {
        var user = new IdentityUser { UserName = request.Email, Email = request.Email };
        var passwordErrors = new List<IdentityError>();
        foreach (var validator in users.PasswordValidators)
        {
            var validation = await validator.ValidateAsync(users, user, request.Password);
            passwordErrors.AddRange(validation.Errors);
        }
        if (passwordErrors.Count != 0) return IdentityResult.Failed(passwordErrors.ToArray());
        if (await users.FindByEmailAsync(request.Email) is not null)
            return IdentityResult.Success;
        var result = await users.CreateAsync(user, request.Password);
        if (result.Succeeded) await SendConfirmationAsync(user.Email, ct);
        if (!result.Succeeded && result.Errors.All(error => error.Code is "DuplicateUserName" or "DuplicateEmail"))
            return IdentityResult.Success;
        return result;
    }
    public async Task<AuthUserResponse?> LoginAsync(CredentialsRequest request)
    {
        var user = await users.FindByEmailAsync(request.Email);
        if (user is null) return null;
        var result = await signIn.PasswordSignInAsync(user, request.Password, false, lockoutOnFailure: true);
        return result.Succeeded ? await MapAsync(user) : null;
    }
    public Task LogoutAsync() => signIn.SignOutAsync();
    public async Task SendConfirmationAsync(string email, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(email);
        if (user is null || user.EmailConfirmed) return;
        var token = Encode(await users.GenerateEmailConfirmationTokenAsync(user));
        var link = QueryHelpers.AddQueryString(options.FrontendOrigin + "/", new Dictionary<string, string?>
            { ["auth"] = "confirm-email", ["userId"] = user.Id, ["token"] = token });
        await emailSender.SendAsync(email, "Confirm your email", link, ct);
    }
    public async Task SendResetAsync(string email, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(email);
        if (user is null || !user.EmailConfirmed || !await users.HasPasswordAsync(user)) return;
        var token = Encode(await users.GeneratePasswordResetTokenAsync(user));
        var link = QueryHelpers.AddQueryString(options.FrontendOrigin + "/", new Dictionary<string, string?>
            { ["auth"] = "reset-password", ["email"] = email, ["token"] = token });
        await emailSender.SendAsync(email, "Reset your password", link, ct);
    }
    public async Task<IdentityResult> ConfirmAsync(ConfirmEmailRequest request)
    {
        var user = await users.FindByIdAsync(request.UserId);
        var token = Decode(request.Token);
        return user is null || token is null ? Failure("Invalid or expired confirmation link.") :
            await users.ConfirmEmailAsync(user, token);
    }
    public async Task<IdentityResult> ResetAsync(ResetPasswordRequest request)
    {
        var user = await users.FindByEmailAsync(request.Email);
        var token = Decode(request.Token);
        if (user is null || !user.EmailConfirmed || token is null || !await users.HasPasswordAsync(user))
            return Failure("Invalid or expired reset link.");
        var result = await users.ResetPasswordAsync(user, token, request.Password);
        if (result.Succeeded)
        {
            var cleared = await users.ResetAccessFailedCountAsync(user);
            if (!cleared.Succeeded) return cleared;
            return await users.SetLockoutEndDateAsync(user, null);
        }
        return result;
    }
    public async Task<IdentityResult> PasswordAsync(ClaimsPrincipal principal, PasswordRequest request)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null || !user.EmailConfirmed) return Failure("A verified account is required.");
        IdentityResult result;
        if (await users.HasPasswordAsync(user))
            result = await users.ChangePasswordAsync(user, request.CurrentPassword ?? "", request.NewPassword);
        else
        {
            var fresh = principal.FindFirstValue("google_authenticated_at");
            if (!long.TryParse(fresh, out var timestamp) ||
                DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp > 300 ||
                !(await users.GetLoginsAsync(user)).Any(login => login.LoginProvider == "Google"))
                return Failure("Sign in with Google again before setting a password.");
            result = await users.AddPasswordAsync(user, request.NewPassword);
        }
        if (result.Succeeded) await signIn.RefreshSignInAsync(user);
        return result;
    }
    public async Task<AuthenticationProperties?> GooglePropertiesAsync(ClaimsPrincipal principal, GoogleStartRequest request)
    {
        if (!options.GoogleEnabled) return null;
        IdentityUser? user = null;
        if (request.Mode == "link")
        {
            user = await users.GetUserAsync(principal);
            if (user is null || !user.EmailConfirmed || await users.IsLockedOutAsync(user) ||
                !await users.HasPasswordAsync(user) || string.IsNullOrEmpty(request.Password) ||
                !(await signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true)).Succeeded)
                return null;
        }
        else if (principal.Identity?.IsAuthenticated == true)
            return null;
        var properties = signIn.ConfigureExternalAuthenticationProperties("Google", "/api/auth/google/callback", user?.Id);
        properties.Items["mode"] = request.Mode;
        properties.Items["link-user"] = user?.Id;
        return properties;
    }
    public async Task<string?> GoogleCallbackAsync(ClaimsPrincipal principal)
    {
        var external = await accessor.HttpContext!.AuthenticateAsync(IdentityConstants.ExternalScheme);
        string? mode = null;
        external.Properties?.Items.TryGetValue("mode", out mode);
        if (mode is not ("login" or "link")) return "invalid-flow";
        var current = mode == "link" ? await users.GetUserAsync(principal) : null;
        if (mode == "link" && current is null) return "session-expired";
        var info = await signIn.GetExternalLoginInfoAsync(current?.Id);
        if (info is null || info.LoginProvider != "Google") return "invalid-flow";
        var owner = await users.FindByLoginAsync(info.LoginProvider, info.ProviderKey);
        if (mode == "link")
        {
            if (!await users.HasPasswordAsync(current!) || await users.IsLockedOutAsync(current!)) return "account-unavailable";
            if (owner is not null) return "already-linked";
            var linked = await users.AddLoginAsync(current!, info);
            if (!linked.Succeeded) return "link-failed";
            await signIn.RefreshSignInAsync(current!);
            return null;
        }
        if (principal.Identity?.IsAuthenticated == true) return "already-signed-in";
        if (owner is null)
        {
            var email = info.Principal.FindFirstValue(ClaimTypes.Email);
            if (string.IsNullOrEmpty(email) ||
                !string.Equals(info.Principal.FindFirstValue("google:email_verified"), "true", StringComparison.OrdinalIgnoreCase))
                return "verified-email-required";
            // An email match is never evidence of ownership of an existing local account.
            if (await users.FindByEmailAsync(email) is not null) return "use-existing-sign-in";
            owner = new IdentityUser { UserName = email, Email = email, EmailConfirmed = true };
            var created = await users.CreateAsync(owner);
            if (!created.Succeeded) return "account-creation-failed";
            var added = await users.AddLoginAsync(owner, info);
            if (!added.Succeeded)
            {
                var deleted = await users.DeleteAsync(owner);
                if (!deleted.Succeeded) throw new InvalidOperationException("Failed to roll back external account creation.");
                return "link-failed";
            }
        }
        var allowed = await signIn.ExternalLoginSignInAsync(info.LoginProvider, info.ProviderKey, false, bypassTwoFactor: false);
        if (!allowed.Succeeded) return "account-unavailable";
        await signIn.SignInWithClaimsAsync(owner, false,
            [new Claim("google_authenticated_at", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture))]);
        return null;
    }
    public async Task<IdentityResult> UnlinkAsync(ClaimsPrincipal principal, string password)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null || !await users.HasPasswordAsync(user) ||
            !(await signIn.CheckPasswordSignInAsync(user, password, lockoutOnFailure: true)).Succeeded)
            return Failure("A current password is required; the last sign-in method cannot be removed.");
        var login = (await users.GetLoginsAsync(user)).SingleOrDefault(login => login.LoginProvider == "Google");
        if (login is null) return Failure("Google is not linked.");
        var result = await users.RemoveLoginAsync(user, login.LoginProvider, login.ProviderKey);
        if (result.Succeeded) await signIn.RefreshSignInAsync(user);
        return result;
    }
}
