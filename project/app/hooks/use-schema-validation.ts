import { useState } from 'react';
import { toast } from 'sonner';
import { validateXsdSchema, validateXmlInstanceWithImports } from '~/utils/schema-validation';
import type { ValidateSchemaResponse, ValidateWithImportsResponse } from '~/utils/schema-validation';

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
        toast.success('✅ Schema is valid', { duration: 5000 });
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

/**
 * Hook for validating XML instances against XSD schemas with import resolution
 */
export function useInstanceValidationWithImports() {
  const [isValidating, setIsValidating] = useState(false);
  const [lastValidationResult, setLastValidationResult] = useState<ValidateWithImportsResponse | null>(null);

  const validate = async (
    schema: string,
    xmlInstance: string,
    baseUri?: string
  ): Promise<ValidateWithImportsResponse | null> => {
    if (!schema.trim()) {
      toast.error('Schema is empty');
      return null;
    }

    if (!xmlInstance.trim()) {
      toast.error('No XML instance to validate');
      return null;
    }

    setIsValidating(true);
    try {
      const result = await validateXmlInstanceWithImports(schema, xmlInstance, baseUri);
      setLastValidationResult(result);

      if (result.isValid) {
        toast.success('✅ Valid — Instance matches schema', { duration: 5000 });
      } else {
        // Show error summary
        const errorCount = result.errors.length;
        const warningCount = result.warnings.length;

        let message = `Invalid — ${errorCount} error(s)`;
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
