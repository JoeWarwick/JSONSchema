using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace SchemaService.Auth;

public static class AuthRegistration
{
    public static IServiceCollection AddAccountAuthentication(this IServiceCollection services,
        IConfiguration configuration, IWebHostEnvironment environment)
    {
        var options = configuration.GetSection("Auth").Get<AuthOptions>() ?? new();
        Validate(options, environment);
        services.AddSingleton(options);
        var database = Path.GetFullPath(options.DatabasePath, environment.ContentRootPath);
        Directory.CreateDirectory(Path.GetDirectoryName(database)!);
        var connection = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder { DataSource = database }.ToString();
        services.AddDbContext<AuthDbContext>(db => db.UseSqlite(connection));
        var keys = new DirectoryInfo(Path.GetFullPath(options.DataProtectionKeysPath, environment.ContentRootPath));
        keys.Create();
        services.AddDataProtection().SetApplicationName("SchemaService").PersistKeysToFileSystem(keys);
        services.AddIdentity<IdentityUser, IdentityRole>(identity =>
        {
            identity.User.RequireUniqueEmail = true;
            identity.SignIn.RequireConfirmedEmail = true;
            identity.Password.RequiredLength = 12;
            identity.Lockout.MaxFailedAccessAttempts = 5;
            identity.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        }).AddEntityFrameworkStores<AuthDbContext>().AddDefaultTokenProviders();
        services.Configure<DataProtectionTokenProviderOptions>(tokens => tokens.TokenLifespan = TimeSpan.FromHours(1));
        services.ConfigureApplicationCookie(cookie =>
        {
            cookie.Cookie.Name = "SchemaService.Session";
            cookie.Cookie.HttpOnly = true;
            cookie.Cookie.SameSite = SameSiteMode.Lax;
            cookie.Cookie.SecurePolicy = environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            cookie.ExpireTimeSpan = TimeSpan.FromHours(8);
            cookie.SlidingExpiration = false;
            cookie.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
            cookie.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
        });
        services.Configure<SecurityStampValidatorOptions>(stamp =>
        {
            stamp.ValidationInterval = TimeSpan.Zero;
            stamp.OnRefreshingPrincipal = context =>
            {
                var freshGoogle = context.CurrentPrincipal?.FindFirst("google_authenticated_at");
                if (freshGoogle is not null && context.NewPrincipal?.Identity is ClaimsIdentity identity)
                    identity.AddClaim(freshGoogle);
                return Task.CompletedTask;
            };
        });
        services.AddAntiforgery(antiforgery =>
        {
            antiforgery.HeaderName = "X-CSRF-TOKEN";
            antiforgery.Cookie.Name = "SchemaService.Csrf";
            antiforgery.Cookie.HttpOnly = true;
            antiforgery.Cookie.SameSite = SameSiteMode.Strict;
            antiforgery.Cookie.SecurePolicy = environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        });
        if (options.GoogleEnabled)
        {
            services.AddAuthentication().AddGoogle(google =>
            {
                google.ClientId = options.GoogleClientId!;
                google.ClientSecret = options.GoogleClientSecret!;
                google.SignInScheme = IdentityConstants.ExternalScheme;
                google.CallbackPath = "/api/auth/google/provider-callback";
                google.SaveTokens = false;
                google.ClaimActions.MapJsonKey("google:email_verified", "verified_email", ClaimValueTypes.Boolean);
                google.Events.OnRemoteFailure = async context =>
                {
                    context.HandleResponse();
                    await context.HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);
                    context.Response.Redirect(options.FrontendOrigin + "/?auth=google-error&code=provider-error");
                };
            });
        }
        services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = 429;
            limiter.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
        services.AddScoped<IAuthEmailSender, AuthEmailSender>();
        services.AddScoped<IAccountService, AccountService>();
        services.AddScoped<AuthCsrfFilter>();
        return services;
    }

    private static void Validate(AuthOptions options, IWebHostEnvironment environment)
    {
        if (!Uri.TryCreate(options.FrontendOrigin, UriKind.Absolute, out var origin) ||
            origin.AbsolutePath != "/" || !string.IsNullOrEmpty(origin.Query) || !string.IsNullOrEmpty(origin.Fragment) ||
            !string.IsNullOrEmpty(origin.UserInfo) || (origin.Scheme != "http" && origin.Scheme != "https"))
            throw new InvalidOperationException("Auth:FrontendOrigin must be an absolute HTTP(S) origin.");
        options.FrontendOrigin = options.FrontendOrigin.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(options.DatabasePath) || string.IsNullOrWhiteSpace(options.DataProtectionKeysPath))
            throw new InvalidOperationException("Authentication database and persistent key paths are required.");
        if (string.IsNullOrWhiteSpace(options.GoogleClientId) != string.IsNullOrWhiteSpace(options.GoogleClientSecret))
            throw new InvalidOperationException("Both Google client ID and secret must be configured.");
        var email = options.Email;
        if (email.Delivery != "Pickup" && email.Delivery != "Smtp")
            throw new InvalidOperationException("Auth:Email:Delivery must be Pickup or Smtp.");
        if (email.Delivery == "Smtp" && (string.IsNullOrWhiteSpace(email.Host) || email.Port < 1 || email.Port > 65535))
            throw new InvalidOperationException("A valid SMTP host and port are required.");
        if (email.Delivery == "Pickup" && string.IsNullOrWhiteSpace(email.PickupPath))
            throw new InvalidOperationException("A development email pickup path is required.");
        if (string.IsNullOrWhiteSpace(email.UserName) != string.IsNullOrWhiteSpace(email.Password))
            throw new InvalidOperationException("Both SMTP username and password must be configured together.");
        if (!MailAddressIsValid(email.From))
            throw new InvalidOperationException("Auth:Email:From must be a valid email address.");
        if (!environment.IsDevelopment() &&
            (origin.Scheme != "https" || origin.IsLoopback || email.Delivery != "Smtp" || !email.EnableSsl ||
             !Path.IsPathFullyQualified(options.DatabasePath) || !Path.IsPathFullyQualified(options.DataProtectionKeysPath) ||
             email.From.EndsWith("@localhost", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Production requires a public HTTPS frontend, TLS SMTP, a real sender, and absolute persistent database/key paths.");
    }

    private static bool MailAddressIsValid(string value) => System.Net.Mail.MailAddress.TryCreate(value, out _);
}
