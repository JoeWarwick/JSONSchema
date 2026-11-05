# SchemaService

A small ASP.NET Core service for XML schema inference and default-instance generation.

## Endpoints

- `POST /api/schema/from-xml`
  - Input: XML instance text
  - Behavior: uses `xsi:schemaLocation` if present, otherwise falls back to `XmlSchemaInference`
- `POST /api/schema/default-instance`
  - Input: XSD schema text
  - Behavior: emits a minimal XML instance from the schema
- `POST /api/transform/preview`
  - Input: `{ "input": "<xml/>", "stylesheet": "<xsl:stylesheet .../>" }`
  - Output: `{ "xml": "<result/>" }`
  - Runs XSLT 1.0 in a short-lived instance of the service executable, not in the
    API request process. The deployment must allow starting that executable.
  - Limits: five seconds per worker, two concurrent workers, one second waiting
    for capacity, and 1,000,000 characters each for input, stylesheet and output.
  - DTDs, external document access, external stylesheet resolution and scripts
    are disabled. Invalid transforms return 400 Problem Details; timeouts return
    408; unavailable capacity returns 503. See [Transform.http](Transform.http).

## Run

```bash
cd project/dotnet-schema-service
 dotnet run --project src/SchemaService/SchemaService.csproj
```

## Notes

- The service is intentionally separate from the web app so the workbench and HTMLCMS can share it later.
- Schema inference uses the built-in .NET XML APIs.

## Accounts and authentication

Accounts use ASP.NET Core Identity, EF Core SQLite, and HttpOnly session cookies.
No documents are stored. Existing schema/transform APIs remain anonymous.
The checked-in `InitialIdentity` EF migration is applied at every server startup
with `MigrateAsync` (not `EnsureCreated`), preserving existing accounts on restart.
This startup strategy is for one server process; coordinate migrations explicitly
before scaling to multiple instances. The Identity model has no SQLite-specific
entity configuration; switching to PostgreSQL requires adding its EF provider,
changing registration and generating provider-appropriate migrations.

Development defaults are `http://localhost:5173` for email/browser redirects,
`App_Data/auth.db` for the database, `App_Data/keys` for persistent Data Protection
keys, and `.eml` email pickup under `App_Data/mail`. Paths are relative to the
backend application's content root (`src\SchemaService`). Open `.eml` files in a
mail client or text editor; links target the frontend and require explicit submit.
Tokens are URL-safe encoded and expire after one hour. Password reset tokens
become invalid after successful use. Password changes/resets invalidate older
sessions. Protect database, keys, and email pickup files; never commit them.

### API contract

Use the same frontend origin (Vite `/api` proxy in development), cookie credentials,
and `X-CSRF-TOKEN` on **every POST**, including anonymous login/registration.
`GET /api/auth/session` issues the antiforgery cookie and returns
`{user:null|{email,emailConfirmed,hasPassword,hasGoogleLogin},googleEnabled,csrfToken}`.
Refresh this response before mutations and after authentication changes; do not
cache it. Errors are Problem Details (including validation errors). Success paths:

| Endpoint under `/api/auth` | POST body | Result |
| --- | --- | --- |
| `register` | `{email,password}` | 200 generic message; password policy failures 400 |
| `login` | `{email,password}` | 200 user fields above; failure 401 |
| `logout` | `{}` | 204 |
| `forgot-password` | `{email}` | 200 generic message |
| `reset-password` | `{email,token,password}` | 200 message / 400 |
| `confirm-email` | `{userId,token}` | 200 message / 400 |
| `resend-confirmation` | `{email}` | 200 generic message |
| `password` | `{currentPassword?,newPassword}` | Authenticated; 200 message / 400 |
| `google/start` | `{mode:"login" or "link",password?}` | 200 `{url}` / 400 / disabled 404 |
| `google/unlink` | `{password}` | Authenticated; 200 message / 400 |

Registration, resend, and forgotten-password responses do not disclose whether an
eligible account exists. Passwords require 12–128 characters, uppercase/lowercase,
a digit, and a non-alphanumeric character. Login requires email verification.
Five failed passwords lock an account for 15 minutes. Auth routes are limited to
30 requests per minute per remote IP (429); untrusted forwarded headers are not
used for rate-limit identities. Sessions last at most eight hours.

Email links are exactly `/?auth=confirm-email&userId=...&token=...` and
`/?auth=reset-password&email=...&token=...` on the configured frontend origin.
Never log email tokens, password bodies, OAuth state, or authentication cookies.

### Configuration and production deployment

Use environment variables (`__` means a configuration section separator), an
external configuration provider, or .NET user-secrets. Never put real credentials
in committed appsettings. Available settings:

| Setting | Development default / purpose |
| --- | --- |
| `Auth__FrontendOrigin` | `http://localhost:5173`; exact trusted origin, no path/query |
| `Auth__DatabasePath` | `App_Data/auth.db` |
| `Auth__DataProtectionKeysPath` | `App_Data/keys`; retain across deploys/restarts |
| `Auth__Email__Delivery` | `Pickup` or `Smtp` |
| `Auth__Email__PickupPath` | `App_Data/mail`; Development only |
| `Auth__Email__From` | `accounts@localhost`; real sender required in production |
| `Auth__Email__Host` | SMTP server |
| `Auth__Email__Port` | `587` |
| `Auth__Email__EnableSsl` | `true` |
| `Auth__Email__UserName`, `Auth__Email__Password` | Optional SMTP credentials; configure both together |
| `Auth__GoogleClientId`, `Auth__GoogleClientSecret` | Both absent disables Google; both required to enable |

Non-Development startup fails unless the frontend is a non-loopback HTTPS origin,
email uses SMTP with TLS and a real sender, and database/key paths are explicitly
absolute. Unknown mail delivery modes, invalid origins/SMTP settings, or a partial
Google credential pair fail immediately. Email delivery/database errors propagate;
there is no silent fallback to pickup or an in-memory database.

Deploy behind HTTPS and configure any reverse proxy to preserve the public HTTPS
scheme securely (trust only known proxies). Production cookies are Secure and
HttpOnly. Mount persistent, access-restricted storage for SQLite and keys, back
them up securely, and encrypt the volume/keys at rest. Filesystem-persisted keys are
not automatically encrypted at rest on all platforms. The backend does not add a
cross-origin credentialed CORS policy: production is same-origin/proxy-based.
Development OpenAPI is at `/openapi/v1.json`; it is not exposed in production.

### Optional Google federation

Register the provider redirect URI as
`https://YOUR_PUBLIC_ORIGIN/api/auth/google/provider-callback` (use the Vite origin
in development, and access all auth requests through that proxy). After a
CSRF-protected start POST, navigate to the **local** returned `/api/auth/google/challenge`
URL. Its protected state expires in five minutes and is bound to an HttpOnly
browser cookie; the server then issues the provider challenge. OAuth state and
correlation are validated by ASP.NET Core's Google middleware. The application
callback is `/api/auth/google/callback` and returns only to the configured origin:
`/?auth=google-success` or `/?auth=google-error&code=NON_SENSITIVE_CODE`.

Only normal identity/email/profile scopes are requested; no Drive scopes,
access tokens, or refresh tokens are stored. New Google accounts require Google's
explicit verified-email claim. Matching an existing account's email **never**
auto-links it: sign into that account first, then link using its current password.
Link and unlink require password reauthentication; external-only accounts cannot
unlink their only method. They may establish a password only within five minutes
of a successful Google sign-in on a verified account, then unlink with that
password. Sign out first to begin a different Google login.

### Development and tests

```powershell
Set-Location project\dotnet-schema-service
dotnet tool restore
dotnet build SchemaService.sln
dotnet test tests\SchemaService.Tests\SchemaService.Tests.csproj --filter FullyQualifiedName~AuthTests
dotnet tool run dotnet-ef migrations list --project src\SchemaService\SchemaService.csproj
```

See [Auth.http](Auth.http) for all account requests, including CSRF/error examples.
Integration tests use `WebApplicationFactory`, actual migrated isolated SQLite
databases, a captured email sender, cookie/CSRF handling, and synthetic external
tickets (no live Google). They exercise repeat startup, registration, verification,
login/logout/reset, lockout, session invalidation, Google collision/disabled paths,
method/settings guards, local challenge binding, pickup mail, and unsafe config.
