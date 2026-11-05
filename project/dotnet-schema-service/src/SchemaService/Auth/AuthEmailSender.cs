using System.Net;
using System.Net.Mail;

namespace SchemaService.Auth;

public interface IAuthEmailSender
{
    Task SendAsync(string email, string subject, string link, CancellationToken cancellationToken);
}

public sealed class AuthEmailSender(AuthOptions options, IWebHostEnvironment environment) : IAuthEmailSender
{
    public async Task SendAsync(string email, string subject, string link, CancellationToken cancellationToken)
    {
        var settings = options.Email;
        using var message = new MailMessage(settings.From, email, subject, $"{subject}\r\n\r\n{link}");
        using var client = new SmtpClient();
        if (settings.Delivery == "Pickup")
        {
            if (!environment.IsDevelopment())
                throw new InvalidOperationException("Email pickup is only permitted in Development.");
            var path = Path.GetFullPath(settings.PickupPath, environment.ContentRootPath);
            Directory.CreateDirectory(path);
            client.DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory;
            client.PickupDirectoryLocation = path;
        }
        else
        {
            client.Host = settings.Host!;
            client.Port = settings.Port;
            client.EnableSsl = settings.EnableSsl;
            if (!string.IsNullOrEmpty(settings.UserName))
                client.Credentials = new NetworkCredential(settings.UserName, settings.Password);
        }
        await client.SendMailAsync(message, cancellationToken);
    }
}
