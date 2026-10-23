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
