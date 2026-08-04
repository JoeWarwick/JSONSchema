import { useState } from 'react';
import { toast } from 'sonner';
import { validateXsdSchema } from '~/utils/schema-validation';
import type { ValidateSchemaResponse } from '~/utils/schema-validation';

/**
 * Hook for validating XSD schemas with toast notifications
 */
export function useSchemaValidation() {
  const [isValidating, setIsValidating] = useState(false);
  const [lastValidationResult, setLastValidationResult] = useState<ValidateSchemaResponse | null>(null);

  const validate = async (schema: string, baseUri?: string): Promise<ValidateSchemaResponse | null> => {
    if (!schema.trim()) {
      toast.error('Schema is empty');
      return null;
    }

    setIsValidating(true);
    try {
      const result = await validateXsdSchema(schema, baseUri);
      setLastValidationResult(result);

      if (result.isValid) {
        toast.success(`✓ Schema is valid - ${result.summary}`);
      } else {
        // Show error summary
        const errorCount = result.errors.length;
        const warningCount = result.warnings.length;
        
        let message = `Schema has ${errorCount} error(s)`;
        if (warningCount > 0) {
          message += ` and ${warningCount} warning(s)`;
        }

        // Show first error with line info if available
        if (result.errors.length > 0) {
          const firstError = result.errors[0];
          const lineInfo = firstError.lineNumber > 0 
            ? ` (line ${firstError.lineNumber}, col ${firstError.linePosition})`
            : '';
          message += `\n\n${firstError.message}${lineInfo}`;
        }

        toast.error(message, { duration: 8000 });

        // If there are multiple errors, show a secondary notification
        if (result.errors.length > 1) {
          const remaining = result.errors.length - 1;
          setTimeout(() => {
            toast.info(`+${remaining} more error(s)`, { duration: 6000 });
          }, 500);
        }
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Validation failed: ${message}`, { duration: 8000 });
      return null;
    } finally {
      setIsValidating(false);
    }
  };

  return {
    validate,
    isValidating,
    lastValidationResult,
  };
}
