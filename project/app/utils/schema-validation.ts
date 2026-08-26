/**
 * API response types from the schema validation endpoint
 */
export interface ValidationError {
  message: string;
  lineNumber: number;
  linePosition: number;
  exception?: string;
}

export interface ValidateSchemaResponse {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  summary: string;
}

export interface ValidateWithImportsRequest {
  schema: string;
  xmlInstance: string;
  baseUri?: string;
}

export interface ValidateWithImportsResponse {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * API request/response types for JSON schema validation
 */
export interface ValidateJsonDataRequest {
  schema: string;
  jsonData: string;
}

export interface ValidateJsonDataResponse {
  isValid: boolean;
  errors: ValidationError[];
  summary: string;
  detectedDraft?: string;
}

/**
 * API request/response types for JSON schema inference
 */
export interface InferJsonSchemaRequest {
  jsonData: string;
}

export interface InferJsonSchemaResponse {
  inferredSchema: string;
  warnings: string[];
}


/**
 * Validates an XSD schema by posting it to the dotnet schema validation API
 * @param schema - The XSD schema content to validate
 * @param baseUri - Optional base URI for resolving imports
 * @returns Promise resolving to validation response with errors/warnings
 */
export async function validateXsdSchema(
  schema: string,
  baseUri?: string
): Promise<ValidateSchemaResponse> {
  try {
    const response = await fetch('/api/schema/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schema,
        baseUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Validation API error: ${response.status} - ${errorText}`);
    }

    const result: ValidateSchemaResponse = await response.json();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      isValid: false,
      errors: [
        {
          message: `Failed to validate schema: ${message}`,
          lineNumber: 0,
          linePosition: 0,
        },
      ],
      warnings: [],
      summary: `Validation service error: ${message}`,
    };
  }
}

/**
 * Validates an XML instance against an XSD schema with import resolution
 * @param schema - The XSD schema content
 * @param xmlInstance - The XML instance data to validate
 * @param baseUri - Optional base URI for resolving imports
 * @returns Promise resolving to validation response with errors/warnings
 */
export async function validateXmlInstanceWithImports(
  schema: string,
  xmlInstance: string,
  baseUri?: string
): Promise<ValidateWithImportsResponse> {
  try {
    // Call the backend server directly (it has CORS enabled)
    const response = await fetch('http://localhost:5080/api/schema/validate-with-imports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schema,
        xmlInstance,
        baseUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Validation API error: ${response.status} - ${errorText}`);
    }

    const result: ValidateWithImportsResponse = await response.json();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      isValid: false,
      errors: [
        {
          message: `Failed to validate instance: ${message}`,
          lineNumber: 0,
          linePosition: 0,
        },
      ],
      warnings: [],
    };
  }
}

/**
 * Validates JSON data against a JSON Schema by posting it to the backend
 * @param schema - The JSON Schema content to validate against
 * @param jsonData - The JSON data to validate
 * @returns Promise resolving to validation response with errors
 */
export async function validateJsonDataAgainstSchema(
  schema: string,
  jsonData: string
): Promise<ValidateJsonDataResponse> {
  try {
    const response = await fetch('http://localhost:5080/api/schema/validate-json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schema,
        jsonData,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Validation API error: ${response.status} - ${errorText}`);
    }

    const result: ValidateJsonDataResponse = await response.json();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      isValid: false,
      errors: [
        {
          message: `Failed to validate JSON data: ${message}`,
          lineNumber: 0,
          linePosition: 0,
        },
      ],
      summary: `Validation service error: ${message}`,
    };
  }
}

/**
 * Infers a JSON Schema from JSON data by posting to the backend
 * @param jsonData - The JSON data from which to infer a schema
 * @returns Promise resolving to inferred schema response
 */
export async function inferJsonSchema(
  jsonData: string
): Promise<InferJsonSchemaResponse> {
  try {
    const response = await fetch('http://localhost:5080/api/schema/infer-json-schema', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonData,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Schema inference API error: ${response.status} - ${errorText}`);
    }

    const result: InferJsonSchemaResponse = await response.json();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      inferredSchema: JSON.stringify({ type: 'object' }),
      warnings: [`Failed to infer schema: ${message}`],
    };
  }
}


