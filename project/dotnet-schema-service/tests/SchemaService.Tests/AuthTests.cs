using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using SchemaService.Auth;
using Xunit;

namespace SchemaService.Tests;

public sealed class AuthTests
{
    private const string Password = "Correct-Horse-42!";

    [Fact]
    public async Task RegistrationConfirmationLoginLogoutAndResetWork()
    {
        using var factory = new AuthFactory();
        using var client = factory.CreateClient();
        var anonymous = await client.GetFromJsonAsync<SessionResponse>("/api/auth/session");
        Assert.Null(anonymous!.User);
        Assert.False(anonymous.GoogleEnabled);
        var register = await Post(client, "register", new { email = "alice@example.com", password = Password });
        Assert.Equal(HttpStatusCode.OK, register.StatusCode);
        var duplicate = await Post(client, "register", new { email = "alice@example.com", password = Password });
        Assert.Equal(await register.Content.ReadAsStringAsync(), await duplicate.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "login", new { email = "alice@example.com", password = Password })).StatusCode);
        Assert.Single(factory.Mail.Links);
        var confirmation = QueryHelpers.ParseQuery(new Uri(factory.Mail.Links.Single()).Query);
        Assert.Equal("confirm-email", confirmation["auth"].ToString());
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "confirm-email", new { userId = confirmation["userId"].ToString(), token = confirmation["token"].ToString() })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "login", new { email = "alice@example.com", password = "wrong" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "login", new { email = "alice@example.com", password = Password })).StatusCode);
        var session = await client.GetFromJsonAsync<SessionResponse>("/api/auth/session");
        Assert.True(session!.User!.EmailConfirmed);
        Assert.True(session.User.HasPassword);
        Assert.False(session.User.HasGoogleLogin);
        Assert.Equal(HttpStatusCode.NoContent, (await Post(client, "logout", new { })).StatusCode);
        Assert.Null((await client.GetFromJsonAsync<SessionResponse>("/api/auth/session"))!.User);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "forgot-password", new { email = "alice@example.com" })).StatusCode);
        var reset = QueryHelpers.ParseQuery(new Uri(factory.Mail.Links.Last()).Query);
        Assert.Equal("reset-password", reset["auth"].ToString());
        const string replacement = "New-Password-42!";
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "reset-password", new { email = "alice@example.com", token = reset["token"].ToString(), password = replacement })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "reset-password", new { email = "alice@example.com", token = reset["token"].ToString(), password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "login", new { email = "alice@example.com", password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "login", new { email = "alice@example.com", password = replacement })).StatusCode);
    }

    [Theory]
    [InlineData("register")]
    [InlineData("login")]
    [InlineData("logout")]
    [InlineData("forgot-password")]
    [InlineData("reset-password")]
    [InlineData("confirm-email")]
    [InlineData("resend-confirmation")]
    [InlineData("google/start")]
    public async Task AnonymousMutationsRequireCsrf(string action)
    {
        using var factory = new AuthFactory();
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/" + action, new { email = "alice@example.com", password = Password });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task SettingsAndDisabledGoogleAreGuarded()
    {
        using var factory = new AuthFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "password", new { newPassword = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "google/unlink", new { password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(client, "google/start", new { mode = "login" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/auth/google/callback")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "forgot-password", new { email = "absent@example.com" })).StatusCode);
        Assert.Empty(factory.Mail.Links);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "confirm-email", new { userId = "missing", token = "invalid" })).StatusCode);
    }

    [Fact]
    public async Task PasswordChangesAndUnlinkRequireCurrentPassword()
    {
        using var factory = new AuthFactory();
        var user = await factory.SeedUser("alice@example.com", true);
        using var client = factory.CreateClient();
        await Post(client, "login", new { email = user.Email, password = Password });
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "password", new { newPassword = "Replacement-42!" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "google/unlink", new { password = "incorrect" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "google/unlink", new { password = Password })).StatusCode);
        Assert.False((await client.GetFromJsonAsync<SessionResponse>("/api/auth/session"))!.User!.HasGoogleLogin);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "google/unlink", new { password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "password", new { currentPassword = Password, newPassword = "Replacement-42!" })).StatusCode);
    }

    [Fact]
    public async Task ExternalOnlyAccountCannotRemoveLastMethodOrSetPasswordWithoutFreshGoogleSignIn()
    {
        using var factory = new AuthFactory();
        var user = await factory.SeedUser("external@example.com", true, hasPassword: false);
        using var client = factory.SignedInClient(user);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "google/unlink", new { password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "password", new { newPassword = Password })).StatusCode);
        var session = await client.GetFromJsonAsync<SessionResponse>("/api/auth/session");
        Assert.False(session!.User!.HasPassword);
        Assert.True(session.User.HasGoogleLogin);
    }

    [Fact]
    public async Task FreshVerifiedGoogleSessionCanEstablishPasswordThenUnlink()
    {
        using var factory = new AuthFactory();
        var user = await factory.SeedUser("fresh@example.com", true, hasPassword: false);
        using var client = factory.SignedInClient(user, freshGoogle: true);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "password", new { newPassword = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "google/unlink", new { password = Password })).StatusCode);
        var session = await client.GetFromJsonAsync<SessionResponse>("/api/auth/session");
        Assert.True(session!.User!.HasPassword);
        Assert.False(session.User.HasGoogleLogin);
    }

    [Fact]
    public async Task SignedInSettingsAlsoRequireCsrf()
    {
        using var factory = new AuthFactory();
        var user = await factory.SeedUser("csrf@example.com", true);
        using var client = factory.SignedInClient(user);
        foreach (var action in new[] { "password", "google/unlink", "google/start", "logout" })
            Assert.Equal(HttpStatusCode.BadRequest,
                (await client.PostAsJsonAsync("/api/auth/" + action, new { password = Password, newPassword = Password, mode = "link" })).StatusCode);
    }

    [Fact]
    public async Task ResetRevokesExistingSessionAndResendIsGeneric()
    {
        using var factory = new AuthFactory();
        var user = await factory.SeedUser("revoke@example.com");
        using var existing = factory.CreateClient();
        await Post(existing, "login", new { email = user.Email, password = Password });
        using var anonymous = factory.CreateClient();
        var absent = await Post(anonymous, "resend-confirmation", new { email = "absent@example.com" });
        var confirmed = await Post(anonymous, "resend-confirmation", new { email = user.Email });
        Assert.Equal(await absent.Content.ReadAsStringAsync(), await confirmed.Content.ReadAsStringAsync());
        Assert.Empty(factory.Mail.Links);
        await Post(anonymous, "forgot-password", new { email = user.Email });
        var reset = QueryHelpers.ParseQuery(new Uri(factory.Mail.Links.Single()).Query);
        Assert.Equal(HttpStatusCode.OK, (await Post(anonymous, "reset-password",
            new { email = user.Email, token = reset["token"].ToString(), password = "Changed-Password-42!" })).StatusCode);
        Assert.Null((await existing.GetFromJsonAsync<SessionResponse>("/api/auth/session"))!.User);
    }

    [Fact]
    public async Task WeakPasswordValidationDoesNotRevealExistingAccount()
    {
        using var factory = new AuthFactory();
        await factory.SeedUser("present@example.com");
        using var client = factory.CreateClient();
        var existing = await Post(client, "register", new { email = "present@example.com", password = "weak" });
        var absent = await Post(client, "register", new { email = "absent@example.com", password = "weak" });
        Assert.Equal(HttpStatusCode.BadRequest, existing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, absent.StatusCode);
    }

    [Theory]
    [InlineData("Production", null, null)]
    [InlineData("Development", "Auth:GoogleClientId", "incomplete")]
    [InlineData("Development", "Auth:FrontendOrigin", "https://example.com/untrusted-path")]
    [InlineData("Development", "Auth:Email:Delivery", "unknown")]
    public void UnsafeConfigurationFailsAtStartup(string environment, string? key, string? value)
    {
        using var factory = new AuthFactory(environment: environment, setting: key, value: value);
        Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
    }

    [Fact]
    public async Task DevelopmentPickupWritesAnEmail()
    {
        using var factory = new AuthFactory();
        using var scope = factory.Services.CreateScope();
        var path = Path.Combine(Path.GetDirectoryName(factory.Database)!, "mail");
        var sender = new AuthEmailSender(new AuthOptions { Email = new EmailOptions { PickupPath = path } },
            scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>());
        await sender.SendAsync("recipient@example.com", "Confirm", "http://localhost:5173/?auth=confirm-email", CancellationToken.None);
        var file = Assert.Single(Directory.GetFiles(path, "*.eml"));
        Assert.Contains("confirm-email", await File.ReadAllTextAsync(file));
    }

    [Fact]
    public async Task FiveWrongPasswordsLockAccount()
    {
        using var factory = new AuthFactory();
        var user = await factory.SeedUser("locked@example.com");
        using var client = factory.CreateClient();
        for (var index = 0; index < 5; index++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "login", new { email = user.Email, password = "wrong" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "login", new { email = user.Email, password = Password })).StatusCode);
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        Assert.True(await users.IsLockedOutAsync((await users.FindByIdAsync(user.Id))!));
    }

    [Fact]
    public async Task GoogleLinkNeedsPasswordAndChallengeIsLocalAndCookieBound()
    {
        using var factory = new AuthFactory(google: true);
        var user = await factory.SeedUser("link@example.com");
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        await Post(client, "login", new { email = user.Email, password = Password });
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "google/start", new { mode = "link" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "google/start", new { mode = "link", password = "wrong" })).StatusCode);
        var response = await Post(client, "google/start", new { mode = "link", password = Password });
        response.EnsureSuccessStatusCode();
        var url = (await response.Content.ReadFromJsonAsync<GoogleStartResponse>())!.Url;
        Assert.StartsWith("/api/auth/google/challenge?", url);
        using var outsider = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        Assert.Equal(HttpStatusCode.BadRequest, (await outsider.GetAsync(url)).StatusCode);
        var challenge = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
        Assert.Equal("accounts.google.com", challenge.Headers.Location!.Host);
        var query = QueryHelpers.ParseQuery(challenge.Headers.Location.Query);
        Assert.DoesNotContain("drive", query["scope"].ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(url)).StatusCode);
    }

    [Theory]
    [InlineData("true", "use-existing-sign-in")]
    [InlineData("false", "verified-email-required")]
    public async Task GoogleNeverAutomaticallyLinksByEmail(string verified, string expected)
    {
        using var factory = new AuthFactory(google: true);
        await factory.SeedUser("collision@example.com");
        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;
        var properties = new AuthenticationProperties();
        properties.Items["mode"] = "login";
        properties.Items["LoginProvider"] = "Google";
        var external = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, "new-google-subject"),
            new Claim(ClaimTypes.Email, "collision@example.com"),
            new Claim("google:email_verified", verified)
        ], "Google"));
        var context = new DefaultHttpContext
        {
            RequestServices = new ExternalAuthenticationProvider(provider,
                AuthenticateResult.Success(new AuthenticationTicket(external, properties, IdentityConstants.ExternalScheme)))
        };
        provider.GetRequiredService<IHttpContextAccessor>().HttpContext = context;
        Assert.Equal(expected, await provider.GetRequiredService<IAccountService>().GoogleCallbackAsync(new ClaimsPrincipal(new ClaimsIdentity())));
        Assert.Null(await provider.GetRequiredService<UserManager<IdentityUser>>().FindByLoginAsync("Google", "new-google-subject"));
    }

    [Fact]
    public async Task MigrationsApplyAndSecondStartupPreservesAccount()
    {
        using var first = new AuthFactory();
        var user = await first.SeedUser("persistent@example.com");
        using (var scope = first.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            Assert.Single(await db.Database.GetAppliedMigrationsAsync());
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        }
        using var second = new AuthFactory(database: first.Database);
        using var secondScope = second.Services.CreateScope();
        Assert.NotNull(await secondScope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>().FindByIdAsync(user.Id));
    }

    [Fact]
    public async Task SessionCookieIsHttpOnlyAndRateLimitApplies()
    {
        using var factory = new AuthFactory();
        var user = await factory.SeedUser("cookie@example.com");
        using var client = factory.CreateClient();
        var response = await Post(client, "login", new { email = user.Email, password = Password });
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), value => value.Contains("SchemaService.Session=") && value.Contains("httponly", StringComparison.OrdinalIgnoreCase));
        HttpResponseMessage? last = null;
        for (var index = 0; index < 31; index++) last = await client.GetAsync("/api/auth/session");
        Assert.Equal(HttpStatusCode.TooManyRequests, last!.StatusCode);
    }

    private static async Task<HttpResponseMessage> Post(HttpClient client, string action, object value)
    {
        var session = await client.GetFromJsonAsync<SessionResponse>("/api/auth/session");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/" + action) { Content = JsonContent.Create(value) };
        request.Headers.Add("X-CSRF-TOKEN", session!.CsrfToken);
        return await client.SendAsync(request);
    }

    private sealed class TestMail : IAuthEmailSender
    {
        public ConcurrentQueue<string> Links { get; } = new();
        public Task SendAsync(string email, string subject, string link, CancellationToken cancellationToken)
        {
            Links.Enqueue(link);
            return Task.CompletedTask;
        }
    }

    private sealed class AuthFactory(bool google = false, string? database = null,
        string environment = "Development", string? setting = null, string? value = null) : WebApplicationFactory<Program>
    {
        private readonly string directory = Path.Combine(AppContext.BaseDirectory, "TestResults", Guid.NewGuid().ToString("N"));
        public string Database => database ?? Path.Combine(directory, "auth.db");
        public TestMail Mail { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("Auth:DatabasePath", Database);
            builder.UseSetting("Auth:DataProtectionKeysPath", Path.Combine(directory, "keys"));
            builder.UseSetting("Auth:GoogleClientId", google ? "test-google-client" : "");
            builder.UseSetting("Auth:GoogleClientSecret", google ? "test-google-secret" : "");
            if (setting is not null) builder.UseSetting(setting, value);
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IAuthEmailSender>();
                services.AddSingleton<IAuthEmailSender>(Mail);
            });
        }
        public async Task<IdentityUser> SeedUser(string email, bool googleLogin = false, bool hasPassword = true)
        {
            using var scope = Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
            var user = new IdentityUser { UserName = email, Email = email, EmailConfirmed = true };
            Assert.True((hasPassword ? await users.CreateAsync(user, Password) : await users.CreateAsync(user)).Succeeded);
            if (googleLogin) Assert.True((await users.AddLoginAsync(user, new UserLoginInfo("Google", "subject-" + email, "Google"))).Succeeded);
            return user;
        }
        public HttpClient SignedInClient(IdentityUser user, bool freshGoogle = false)
        {
            using var scope = Services.CreateScope();
            var principal = scope.ServiceProvider.GetRequiredService<IUserClaimsPrincipalFactory<IdentityUser>>().CreateAsync(user).GetAwaiter().GetResult();
            if (freshGoogle) ((ClaimsIdentity)principal.Identity!).AddClaim(new Claim("google_authenticated_at",
                DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture)));
            var cookie = scope.ServiceProvider.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(IdentityConstants.ApplicationScheme);
            var ticket = new AuthenticationTicket(principal, new AuthenticationProperties { ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) }, IdentityConstants.ApplicationScheme);
            var client = CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", cookie.Cookie.Name + "=" + cookie.TicketDataFormat.Protect(ticket));
            return client;
        }
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing)
            {
                Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
                if (Directory.Exists(directory)) Directory.Delete(directory, true);
            }
        }
    }

    private sealed class ExternalAuthenticationProvider(IServiceProvider inner, AuthenticateResult result) : IServiceProvider
    {
        public object? GetService(Type type) => type == typeof(IAuthenticationService) ? new ExternalAuthentication(result) : inner.GetService(type);
    }
    private sealed class ExternalAuthentication(AuthenticateResult result) : IAuthenticationService
    {
        public Task<AuthenticateResult> AuthenticateAsync(HttpContext context, string? scheme) => Task.FromResult(result);
        public Task ChallengeAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => throw new NotSupportedException();
        public Task ForbidAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => throw new NotSupportedException();
        public Task SignInAsync(HttpContext context, string? scheme, ClaimsPrincipal principal, AuthenticationProperties? properties) => throw new NotSupportedException();
        public Task SignOutAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) => throw new NotSupportedException();
    }
}
