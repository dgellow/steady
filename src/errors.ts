/**
 * Server Error Types - Rich error context with SDK vs Spec attribution
 *
 * Error attribution helps developers quickly identify whether an issue is:
 * - SDK Bug: The generated SDK is sending invalid requests
 * - Spec Issue: The OpenAPI specification has problems
 * - Server Error: Internal mock server issue
 */

import { ErrorContext, SteadyError } from "@steady/openapi";

/** Source of the error - helps with debugging */
export type ErrorSource = "sdk" | "spec" | "server" | "unknown";

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
