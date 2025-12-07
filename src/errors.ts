/**
 * Server Error Types - Rich error context with SDK vs Spec attribution
 *
 * Error attribution helps developers quickly identify whether an issue is:
 * - SDK Bug: The generated SDK is sending invalid requests
 * - Spec Issue: The OpenAPI specification has problems
 * - Server Error: Internal mock server issue
 */

import { ErrorContext, SteadyError } from "@steady/openapi";
import type { ValidationIssue } from "./types.ts";

/** Source of the error - helps with debugging */
export type ErrorSource = "sdk" | "spec" | "server" | "unknown";

/** Extended error context with attribution */
export interface AttributedErrorContext extends ErrorContext {
  source?: ErrorSource;
  validationErrors?: ValidationIssue[];
}

/**
 * Reference resolution error - usually a spec issue
 * Named RefResolutionError to avoid shadowing JavaScript's built-in ReferenceError
 */
export class RefResolutionError extends SteadyError {
  readonly source: ErrorSource = "spec";

  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "reference" });
    this.name = "RefResolutionError";
  }
}

/**
 * Response generation error - usually a spec issue (missing examples)
 */
export class GenerationError extends SteadyError {
  readonly source: ErrorSource = "spec";

  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "generate" });
    this.name = "GenerationError";
  }
}

/**
 * Route matching error - could be SDK or spec issue
 */
export class MatchError extends SteadyError {
  readonly source: ErrorSource;

  constructor(
    message: string,
    context: ErrorContext,
    source: ErrorSource = "unknown",
  ) {
    super(message, { ...context, errorType: "match" });
    this.name = "MatchError";
    this.source = source;
  }
}

/**
 * Request validation error - usually an SDK bug
 */
export class RequestValidationError extends SteadyError {
  readonly source: ErrorSource = "sdk";
  readonly validationErrors: ValidationIssue[];

  constructor(
    message: string,
    context: ErrorContext,
    validationErrors: ValidationIssue[],
  ) {
    super(message, { ...context, errorType: "validate" });
    this.name = "RequestValidationError";
    this.validationErrors = validationErrors;
  }

  override format(): string {
    const base = super.format();
    if (this.validationErrors.length === 0) return base;

    const errorDetails = this.validationErrors
      .map((e, i) => {
        const lines = [`  ${i + 1}. ${e.message}`];
        if (e.path) lines.push(`     Path: ${e.path}`);
        if (e.expected !== undefined) {
          lines.push(`     Expected: ${JSON.stringify(e.expected)}`);
        }
        if (e.actual !== undefined) {
          lines.push(`     Actual: ${JSON.stringify(e.actual)}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");

    return `${base}\n\nValidation errors:\n${errorDetails}`;
  }
}

/**
 * Schema validation error - spec issue
 */
export class SchemaError extends SteadyError {
  readonly source: ErrorSource = "spec";

  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "validate" });
    this.name = "SchemaError";
  }
}

/**
 * Create a circular reference error with helpful guidance
 */
export function circularReferenceError(
  _refPath: string,
  cycle: string[],
  specFile?: string,
): RefResolutionError {
  return new RefResolutionError("Circular reference detected", {
    specFile,
    errorType: "reference",
    reason: `Schema references itself, creating an infinite loop`,
    schemaPath: cycle,
    suggestion: "Break the circular reference by:\n" +
      "  - Using a different schema for one of the references\n" +
      "  - Making one of the properties optional\n" +
      "  - Using a maximum depth limit for recursive structures",
    examples: [
      "components:",
      "  schemas:",
      "    TreeNode:",
      "      type: object",
      "      properties:",
      "        value:",
      "          type: string",
      "        children:",
      "          type: array",
      "          maxItems: 10  # Limit depth",
      "          items:",
      "            $ref: '#/components/schemas/TreeNode'",
    ],
  });
}

/**
 * Create a missing example error with helpful guidance
 */
export function missingExampleError(
  path: string,
  method: string,
  statusCode: string,
  specFile?: string,
): GenerationError {
  return new GenerationError("Missing example for response", {
    specFile,
    httpPath: path,
    httpMethod: method.toUpperCase(),
    errorType: "generate",
    reason:
      `Your OpenAPI spec defines a ${statusCode} response but doesn't include an example or schema.`,
    suggestion: "Add an example or schema to your spec:",
    examples: [
      "responses:",
      `  ${statusCode}:`,
      "    content:",
      "      application/json:",
      "        example:",
      "          id: 123",
      '          name: "John Doe"',
      "        # Or use a schema reference:",
      "        # schema:",
      "        #   $ref: '#/components/schemas/User'",
    ],
  });
}

/**
 * Create a validation error with SDK attribution
 */
export function sdkValidationError(
  path: string,
  method: string,
  errors: ValidationIssue[],
  specFile?: string,
): RequestValidationError {
  const errorCount = errors.length;
  const firstError = errors[0];
  const summary = firstError
    ? `${firstError.message} at ${firstError.path}`
    : "Request validation failed";

  return new RequestValidationError(
    `SDK validation failed: ${summary}${
      errorCount > 1 ? ` (+${errorCount - 1} more)` : ""
    }`,
    {
      specFile,
      httpPath: path,
      httpMethod: method.toUpperCase(),
      errorType: "validate",
      reason:
        "The SDK sent a request that doesn't match the OpenAPI specification.",
      suggestion: "Check the SDK implementation:\n" +
        "  - Verify required fields are being sent\n" +
        "  - Check field types match the schema\n" +
        "  - Ensure enums use valid values\n" +
        "  - Validate string formats (email, date-time, etc.)",
    },
    errors,
  );
}

/**
 * Create a schema error for invalid OpenAPI schema
 */
export function invalidSchemaError(
  schemaPath: string,
  reason: string,
  specFile?: string,
): SchemaError {
  return new SchemaError(`Invalid schema at ${schemaPath}`, {
    specFile,
    schemaPath: [schemaPath],
    errorType: "validate",
    reason,
    suggestion: "Fix the schema in your OpenAPI specification:\n" +
      "  - Check for valid JSON Schema keywords\n" +
      "  - Ensure $ref targets exist\n" +
      "  - Verify type constraints are compatible",
  });
}

/**
 * Create a path not found error
 */
export function pathNotFoundError(
  path: string,
  method: string,
  availablePaths: string[],
  specFile?: string,
): MatchError {
  const source: ErrorSource = availablePaths.length === 0 ? "spec" : "sdk";
  const suggestion = availablePaths.length > 0
    ? `Available paths:\n${
      availablePaths.slice(0, 10).map((p) => `  - ${p}`).join("\n")
    }${
      availablePaths.length > 10
        ? `\n  ... and ${availablePaths.length - 10} more`
        : ""
    }`
    : "No paths are defined in the OpenAPI spec.";

  return new MatchError(
    `Path not found: ${method.toUpperCase()} ${path}`,
    {
      specFile,
      httpPath: path,
      httpMethod: method.toUpperCase(),
      errorType: "match",
      reason: source === "spec"
        ? "The OpenAPI specification has no paths defined."
        : "The SDK is requesting a path that doesn't exist in the specification.",
      suggestion,
    },
    source,
  );
}

/**
 * Create a method not allowed error
 */
export function methodNotAllowedError(
  path: string,
  method: string,
  availableMethods: string[],
  specFile?: string,
): MatchError {
  return new MatchError(
    `Method not allowed: ${method.toUpperCase()} ${path}`,
    {
      specFile,
      httpPath: path,
      httpMethod: method.toUpperCase(),
      errorType: "match",
      reason: `The path exists but doesn't support ${method.toUpperCase()}.`,
      suggestion: `Available methods for this path: ${
        availableMethods.map((m) => m.toUpperCase()).join(", ")
      }`,
    },
    "sdk",
  );
}

/**
 * Error thrown when request body exceeds size limit.
 * This is an internal error used by the validator - not exposed to users.
 */
export class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyTooLargeError";
  }
}
