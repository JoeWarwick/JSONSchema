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
