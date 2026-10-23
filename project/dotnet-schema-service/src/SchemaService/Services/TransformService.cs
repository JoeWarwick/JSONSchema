using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using SchemaService.Models;

namespace SchemaService.Services;

public interface ITransformService
{
    Task<string> ExecuteAsync(TransformRequest request, CancellationToken cancellationToken);
}

public sealed class TransformService : ITransformService, IDisposable
{
    private readonly SemaphoreSlim slots = new(2);

    public async Task<string> ExecuteAsync(TransformRequest request, CancellationToken cancellationToken)
    {
        if (!await slots.WaitAsync(TimeSpan.FromSeconds(1), cancellationToken))
            throw new InvalidOperationException("Transform preview is busy. Try again shortly.");
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            using var process = new Process { StartInfo = CreateStartInfo() };
            process.Start();
            var output = process.StandardOutput.ReadToEndAsync();
            // Drain stderr without retaining unbounded runtime diagnostics (e.g. stack overflow).
            var errors = DrainAsync(process.StandardError);
            try
            {
                await process.StandardInput.WriteAsync(JsonSerializer.Serialize(request).AsMemory(), timeout.Token);
                process.StandardInput.Close();
                await process.WaitForExitAsync(timeout.Token);
                await errors;
                if (process.ExitCode != 0)
                    throw new ArgumentException("Transform execution failed. Check the stylesheet for recursion or excessive resource use.");
                var response = JsonSerializer.Deserialize<TransformWorkerResponse>(await output)
                    ?? throw new InvalidOperationException("Transform worker returned no response.");
                if (response.Error is not null) throw new ArgumentException(response.Error);
                return response.Xml ?? throw new InvalidOperationException("Transform worker returned no output.");
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new TimeoutException("Transform preview exceeded its five-second execution limit.");
            }
            finally
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None);
                await Task.WhenAll(output, errors);
            }
        }
        finally
        {
            slots.Release();
        }
    }

    private static ProcessStartInfo CreateStartInfo()
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Cannot locate the transform host.");
        var info = new ProcessStartInfo
        {
            FileName = executable, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        if (string.Equals(Path.GetFileNameWithoutExtension(executable), "dotnet", StringComparison.OrdinalIgnoreCase))
            info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        info.ArgumentList.Add("--transform-worker");
        return info;
    }

    private static async Task DrainAsync(StreamReader reader)
    {
        var buffer = new char[4096];
        while (await reader.ReadAsync(buffer.AsMemory()) > 0) { }
    }

    public void Dispose() => slots.Dispose();
}
