using SchemaService.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddSingleton<XmlSchemaLocationService>();
builder.Services.AddSingleton<SchemaInferenceService>();
builder.Services.AddSingleton<DefaultInstanceService>();
builder.Services.AddSingleton<XmlSchemaResolverService>();
builder.Services.AddSingleton<SchemaValidationService>();
builder.Services.AddSingleton<JsonSchemaValidationService>();
builder.Services.AddSingleton<JsonSchemaInferenceService>();

// Add CORS to allow requests from the frontend
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(builder =>
    {
        builder.WithOrigins("http://localhost:5173", "http://localhost:5174", "https://localhost:5173", "https://localhost:5174")
               .AllowAnyHeader()
               .AllowAnyMethod();
    });
});

var app = builder.Build();

// Disable HTTPS redirection in development
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseCors();
app.MapControllers();
app.MapGet("/", () => Results.Ok(new { service = "SchemaService", status = "running" }));

app.Run();
