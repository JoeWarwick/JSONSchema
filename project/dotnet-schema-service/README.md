# SchemaService

A small ASP.NET Core service for XML schema inference and default-instance generation.

## Endpoints

- `POST /api/schema/from-xml`
  - Input: XML instance text
  - Behavior: uses `xsi:schemaLocation` if present, otherwise falls back to `XmlSchemaInference`
- `POST /api/schema/default-instance`
  - Input: XSD schema text
  - Behavior: emits a minimal XML instance from the schema

## Run

```bash
cd project/dotnet-schema-service
 dotnet run --project src/SchemaService/SchemaService.csproj
```

## Notes

- The service is intentionally separate from the web app so the workbench and HTMLCMS can share it later.
- Schema inference uses the built-in .NET XML APIs.
