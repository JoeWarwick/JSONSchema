using SchemaService.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddSingleton<XmlSchemaLocationService>();
builder.Services.AddSingleton<SchemaInferenceService>();
builder.Services.AddSingleton<DefaultInstanceService>();

var app = builder.Build();

app.UseHttpsRedirection();
app.MapControllers();
app.MapGet("/", () => Results.Ok(new { service = "SchemaService", status = "running" }));

app.Run();
