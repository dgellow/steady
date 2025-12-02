/**
 * Attribution Analyzer - Determines whether errors are SDK or spec issues
 *
 * This is the key innovation that makes Steady valuable for SDK validation.
 * Analyzes error patterns to provide clear attribution and actionable fixes.
 */

import type {
  ErrorAttribution,
  ProcessedSchema,
  ValidationError,
} from "./types.ts";

interface ErrorPattern {
  keywords: Set<string>;
  paths: Set<string>;
  types: Map<string, number>;
  consistency: number;
}

export class AttributionAnalyzer {
  // Schema stored for potential future use in enhanced attribution
  constructor(_schema: ProcessedSchema) {
    // Currently unused, but will be needed for schema-aware attribution
    void _schema;
  }

  /**
   * Analyze validation errors to determine SDK vs spec issues
   */
  analyze(errors: ValidationError[], data: unknown): ErrorAttribution {
    if (errors.length === 0) {
      // Return a default attribution when there are no errors
      return {
        type: "ambiguous",
        confidence: 0,
        reasoning: "No errors to analyze",
        primaryError: {
          keyword: "unknown",
          instancePath: "",
          schemaPath: "",
          message: "No validation errors",
          params: {},
        },
        suggestion: "No validation errors found",
        relatedIssues: [],
      };
    }

    // Collect error patterns
    const patterns = this.detectPatterns(errors);

    // Check for common SDK error patterns
    const sdkAttribution = this.checkSdkPatterns(patterns, errors, data);
    if (sdkAttribution) return sdkAttribution;

    // Check for common spec error patterns
    const specAttribution = this.checkSpecPatterns(patterns, errors, data);
    if (specAttribution) return specAttribution;

    // Analyze specific error types
    const typeAttribution = this.analyzeByErrorType(errors, data);
    if (typeAttribution) return typeAttribution;

    // Default: ambiguous
    return this.createAttribution(
      "ambiguous",
      0.5,
      "Could not determine clear attribution - check both SDK and spec",
      errors[0]!,
      "Review the validation errors and verify both your SDK implementation and OpenAPI specification",
    );
  }

  /**
   * Detect patterns in errors
   */
  private detectPatterns(errors: ValidationError[]): ErrorPattern {
    const pattern: ErrorPattern = {
      keywords: new Set(),
      paths: new Set(),
      types: new Map(),
      consistency: 0,
    };

    // Collect keywords and paths
    for (const error of errors) {
      pattern.keywords.add(error.keyword);
      pattern.paths.add(error.instancePath);

      // Track type errors
      if (error.keyword === "type") {
        const expectedType = Array.isArray(error.params?.type)
          ? error.params.type.join(",")
          : error.params?.type as string;
        pattern.types.set(
          expectedType,
          (pattern.types.get(expectedType) || 0) + 1,
        );
      }
    }

    // Calculate consistency (how similar the errors are)
    if (errors.length > 1) {
      const uniqueKeywords = pattern.keywords.size;
      pattern.consistency = 1 - (uniqueKeywords - 1) / errors.length;
    } else {
      pattern.consistency = 1;
    }

    return pattern;
  }

  /**
   * Check for SDK error patterns
   */
  private checkSdkPatterns(
    patterns: ErrorPattern,
    errors: ValidationError[],
    data: unknown,
  ): ErrorAttribution | null {
    // Pattern 1: Consistent type mismatches suggest serialization issues
    if (this.isConsistentTypeError(patterns, errors)) {
      return this.createAttribution(
        "sdk-error",
        0.9,
        "Consistent type mismatches indicate SDK serialization/deserialization issues",
        errors[0]!,
        "Check your SDK's type conversions and serialization logic. The SDK is sending incorrect data types.",
      );
    }

    // Pattern 2: Missing all required fields suggests SDK not sending data
    if (this.isMissingAllRequiredFields(patterns, errors)) {
      return this.createAttribution(
        "sdk-error",
        0.85,
        "Missing multiple required fields suggests SDK is not properly constructing the request",
        errors[0]!,
        "Verify the SDK is setting all required fields before sending the request.",
      );
    }

    // Pattern 3: Systematic null values where not allowed
    if (this.hasSystematicNulls(errors, data)) {
      return this.createAttribution(
        "sdk-error",
        0.8,
        "Systematic null values suggest SDK is not handling optional fields correctly",
        errors.find((e) => e.keyword === "type" && e.data === null) ||
          errors[0]!,
        "Check how your SDK handles optional vs required fields. Null may be sent for undefined values.",
      );
    }

    // Pattern 4: Format errors on multiple fields of same type
    if (this.hasConsistentFormatErrors(patterns, errors)) {
      return this.createAttribution(
        "sdk-error",
        0.85,
        "Multiple format errors of the same type indicate SDK formatting issues",
        errors.find((e) => e.keyword === "format") || errors[0]!,
        "Review how your SDK formats data, especially dates, times, and other formatted strings.",
      );
    }

    return null;
  }

  /**
   * Check for spec error patterns
   */
  private checkSpecPatterns(
    patterns: ErrorPattern,
    errors: ValidationError[],
    data: unknown,
  ): ErrorAttribution | null {
    // Pattern 1: Overly restrictive constraints
    if (this.hasOverlyRestrictiveConstraints(errors)) {
      return this.createAttribution(
        "spec-error",
        0.8,
        "Schema constraints may be too restrictive for valid data",
        errors[0]!,
        "Review the schema constraints - they may be more restrictive than intended.",
      );
    }

    // Pattern 2: Conflicting schema requirements
    if (this.hasConflictingRequirements(errors)) {
      return this.createAttribution(
        "spec-error",
        0.85,
        "Schema has conflicting or impossible requirements",
        errors[0]!,
        "Check for conflicting constraints in your schema (e.g., minLength > maxLength).",
      );
    }

    // Pattern 3: Using wrong JSON Schema keywords
    if (this.hasInvalidSchemaKeywords(errors)) {
      return this.createAttribution(
        "spec-error",
        0.9,
        "Schema uses invalid or incorrectly formatted keywords",
        errors[0]!,
        "Verify your schema uses valid JSON Schema keywords and syntax.",
      );
    }

    // Pattern 4: Additional properties rejected when data seems valid
    if (this.isRejectingValidAdditionalProperties(patterns, errors, data)) {
      return this.createAttribution(
        "spec-error",
        0.75,
        "Schema may be too strict about additional properties",
        errors.find((e) => e.keyword === "additionalProperties") || errors[0]!,
        "Consider if additionalProperties: false is too restrictive for your use case.",
      );
    }

    return null;
  }

  /**
   * Analyze by specific error types
   */
  private analyzeByErrorType(
    errors: ValidationError[],
    _data: unknown,
  ): ErrorAttribution | null {
    // Group errors by keyword
    const errorsByKeyword = new Map<string, ValidationError[]>();
    for (const error of errors) {
      if (!errorsByKeyword.has(error.keyword)) {
        errorsByKeyword.set(error.keyword, []);
      }
      errorsByKeyword.get(error.keyword)!.push(error);
    }

    // Type errors
    if (errorsByKeyword.has("type")) {
      const typeErrors = errorsByKeyword.get("type")!;
      if (typeErrors.length > errors.length * 0.5 && typeErrors[0]) {
        // More than half are type errors
        return this.createAttribution(
          "sdk-error",
          0.7,
          "Majority of errors are type mismatches",
          typeErrors[0],
          "SDK is sending data with incorrect types. Check serialization logic.",
        );
      }
    }

    // Required field errors
    if (errorsByKeyword.has("required")) {
      const requiredErrors = errorsByKeyword.get("required")!;
      if (requiredErrors.length > 3 && requiredErrors[0]) {
        return this.createAttribution(
          "sdk-error",
          0.75,
          "Many required fields are missing",
          requiredErrors[0],
          "SDK is not sending all required fields. Check request construction.",
        );
      }
    }

    // Enum errors might indicate spec issues
    if (errorsByKeyword.has("enum")) {
      const enumErrors = errorsByKeyword.get("enum")!;
      if (enumErrors[0]) {
        return this.createAttribution(
          "ambiguous",
          0.6,
          "Enum validation failures could be SDK or spec issue",
          enumErrors[0],
          "Verify both that the SDK sends correct values and that the enum in the spec is complete.",
        );
      }
    }

    return null;
  }

  /**
   * Helper: Check if errors show consistent type mismatches
   */
  private isConsistentTypeError(
    patterns: ErrorPattern,
    errors: ValidationError[],
  ): boolean {
    if (!patterns.keywords.has("type")) return false;

    const typeErrors = errors.filter((e) => e.keyword === "type");
    if (typeErrors.length < 2) return false;

    // Check if the same wrong type appears multiple times
    for (const [_, count] of patterns.types) {
      if (count >= 2) return true;
    }

    // Check if all type errors are similar (e.g., all expecting string but getting number)
    const actualTypes = new Set<string>();
    for (const error of typeErrors) {
      if (error.data !== null && error.data !== undefined) {
        actualTypes.add(typeof error.data);
      }
    }

    return actualTypes.size === 1 && typeErrors.length > 2;
  }

  /**
   * Helper: Check if missing all required fields
   */
  private isMissingAllRequiredFields(
    patterns: ErrorPattern,
    errors: ValidationError[],
  ): boolean {
    const requiredErrors = errors.filter((e) => e.keyword === "required");
    return requiredErrors.length > 3 && patterns.consistency > 0.7;
  }

  /**
   * Helper: Check for systematic null values
   */
  private hasSystematicNulls(
    errors: ValidationError[],
    _data: unknown,
  ): boolean {
    const nullErrors = errors.filter((e) => e.data === null);
    return nullErrors.length > 2;
  }

  /**
   * Helper: Check for consistent format errors
   */
  private hasConsistentFormatErrors(
    _patterns: ErrorPattern,
    errors: ValidationError[],
  ): boolean {
    const formatErrors = errors.filter((e) =>
      e.keyword === "format" || e.keyword === "pattern"
    );
    if (formatErrors.length < 2) return false;

    // Group by format type
    const formatTypes = new Map<string, number>();
    for (const error of formatErrors) {
      const format = error.params?.format || error.params?.pattern || "unknown";
      formatTypes.set(
        format as string,
        (formatTypes.get(format as string) || 0) + 1,
      );
    }

    // If same format fails multiple times, likely SDK issue
    for (const [_, count] of formatTypes) {
      if (count >= 2) return true;
    }

    return false;
  }

  /**
   * Helper: Check for overly restrictive constraints
   */
  private hasOverlyRestrictiveConstraints(errors: ValidationError[]): boolean {
    // Look for very specific constraints that might be too restrictive
    for (const error of errors) {
      if (error.keyword === "pattern" && error.params?.pattern) {
        const pattern = error.params.pattern as string;
        // Very complex patterns might be too restrictive
        if (
          pattern.length > 50 || pattern.includes("(?=") ||
          pattern.includes("(?!")
        ) {
          return true;
        }
      }

      if (error.keyword === "maxLength" && error.params?.limit) {
        // Very small maxLength might be too restrictive
        if ((error.params.limit as number) < 3) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Helper: Check for conflicting requirements
   */
  private hasConflictingRequirements(errors: ValidationError[]): boolean {
    // Look for errors that suggest impossible requirements
    const errorPairs = new Map<string, ValidationError[]>();

    for (const error of errors) {
      const key = error.instancePath;
      if (!errorPairs.has(key)) {
        errorPairs.set(key, []);
      }
      errorPairs.get(key)!.push(error);
    }

    // Check for conflicts at same path
    for (const [_, pathErrors] of errorPairs) {
      if (pathErrors.length > 1) {
        const keywords = pathErrors.map((e) => e.keyword);
        // Conflicting keywords at same path
        if (keywords.includes("minimum") && keywords.includes("maximum")) {
          return true;
        }
        if (keywords.includes("minLength") && keywords.includes("maxLength")) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Helper: Check for invalid schema keywords
   */
  private hasInvalidSchemaKeywords(errors: ValidationError[]): boolean {
    // If we get here with metaschema violations, it's a spec error
    return errors.some((e) =>
      e.message.includes("invalid") &&
      e.message.includes("schema")
    );
  }

  /**
   * Helper: Check if rejecting valid additional properties
   */
  private isRejectingValidAdditionalProperties(
    _patterns: ErrorPattern,
    errors: ValidationError[],
    _data: unknown,
  ): boolean {
    const additionalPropErrors = errors.filter((e) =>
      e.keyword === "additionalProperties"
    );
    if (additionalPropErrors.length === 0) return false;

    // If more than 2 additional property errors, schema might be too strict
    return additionalPropErrors.length > 2;
  }

  /**
   * Create an attribution result
   */
  private createAttribution(
    type: "sdk-error" | "spec-error" | "ambiguous",
    confidence: number,
    reasoning: string,
    primaryError: ValidationError,
    suggestion?: string,
  ): ErrorAttribution {
    return {
      type,
      confidence,
      reasoning,
      primaryError,
      suggestion: suggestion || this.getDefaultSuggestion(type),
      relatedIssues: this.findRelatedIssues(type),
    };
  }

  /**
   * Get default suggestion based on attribution type
   */
  private getDefaultSuggestion(
    type: "sdk-error" | "spec-error" | "ambiguous",
  ): string {
    switch (type) {
      case "sdk-error":
        return "Review your SDK implementation, especially data serialization and request construction.";
      case "spec-error":
        return "Review your OpenAPI specification for overly restrictive or incorrect constraints.";
      case "ambiguous":
        return "Check both your SDK implementation and OpenAPI specification for issues.";
    }
  }

  /**
   * Find related issues based on attribution
   */
  private findRelatedIssues(
    type: "sdk-error" | "spec-error" | "ambiguous",
  ): string[] {
    switch (type) {
      case "sdk-error":
        return [
          "Check SDK serialization settings",
          "Verify SDK model definitions match the API",
          "Test with a known-good request to isolate the issue",
        ];
      case "spec-error":
        return [
          "Validate your OpenAPI spec with a linter",
          "Compare with working API responses",
          "Check if constraints match your actual data",
        ];
      case "ambiguous":
        return [
          "Try the request with a different client (e.g., curl)",
          "Validate a known-good response against the schema",
          "Check SDK and spec versions for compatibility",
        ];
    }
  }
}
