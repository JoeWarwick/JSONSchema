namespace SchemaService.Auth;

public sealed class AuthOptions
{
    public string FrontendOrigin { get; set; } = "http://localhost:5173";
    public string DatabasePath { get; set; } = "App_Data/auth.db";
    public string DataProtectionKeysPath { get; set; } = "App_Data/keys";
    public string? GoogleClientId { get; set; }
    public string? GoogleClientSecret { get; set; }
    public EmailOptions Email { get; set; } = new();
    public bool GoogleEnabled => !string.IsNullOrWhiteSpace(GoogleClientId) && !string.IsNullOrWhiteSpace(GoogleClientSecret);
}

public sealed class EmailOptions
{
    public string Delivery { get; set; } = "Pickup";
    public string PickupPath { get; set; } = "App_Data/mail";
    public string From { get; set; } = "accounts@localhost";
    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public string? UserName { get; set; }
    public string? Password { get; set; }
    public bool EnableSsl { get; set; } = true;
}
