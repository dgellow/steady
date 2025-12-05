/**
 * Schema Validator - Public API for validating data against processed schemas
 *
 * Wraps the runtime validator and adds error attribution analysis.
 */

import type {
  ErrorAttribution,
  ProcessedSchema,
  SchemaValidationError,
  ValidationResult,
} from "./types.ts";
import {
  RuntimeValidator,
  RuntimeValidatorOptions,
} from "./runtime-validator.ts";
import { AttributionAnalyzer } from "./attribution-analyzer.ts";

/** Options for SchemaValidator */
export interface SchemaValidatorOptions extends RuntimeValidatorOptions {}

export class SchemaValidator {
  private runtimeValidator: RuntimeValidator;
  private attributionAnalyzer: AttributionAnalyzer;

  constructor(
    private processedSchema: ProcessedSchema,
    options?: SchemaValidatorOptions,
  ) {
    this.runtimeValidator = new RuntimeValidator(processedSchema, options);
    this.attributionAnalyzer = new AttributionAnalyzer(processedSchema);
  }

  /**
   * Validate data against the processed schema
   */
  validate(data: unknown): ValidationResult {
    // Run validation
    const errors = this.runtimeValidator.validate(data);

    // Analyze errors for attribution if any exist
    let attribution: ErrorAttribution | undefined;
    if (errors.length > 0) {
      attribution = this.attributionAnalyzer.analyze(errors, data);

      // Enhance errors with attribution info
      errors.forEach((error) => {
        error.attribution = {
          type: attribution!.type,
          confidence: attribution!.confidence,
          reasoning: attribution!.reasoning,
        };
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      attribution,
    };
  }

  /**
   * Get the processed schema (for inspection/debugging)
   */
  getProcessedSchema(): ProcessedSchema {
    return this.processedSchema;
  }

  /**
   * Validate and return only the first error (useful for fail-fast scenarios)
   */
  validateFirst(data: unknown): SchemaValidationError | null {
    const result = this.validate(data);
    return result.errors.length > 0 ? result.errors[0]! : null;
  }

  /**
   * Validate and throw if invalid (useful for assertions)
   */
  validateOrThrow(data: unknown): void {
    const result = this.validate(data);
    if (!result.valid) {
      const error = new Error(
        `Validation failed: ${result.errors[0]!.message} at ${
          result.errors[0]!.instancePath || "root"
        }`,
      ) as Error & { validationResult: ValidationResult };
      error.validationResult = result;
      throw error;
    }
  }
}
