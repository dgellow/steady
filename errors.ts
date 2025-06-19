import { ErrorContext, SteadyError } from "@steady/parser";

export class ReferenceError extends SteadyError {
  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "reference" });
    this.name = "ReferenceError";
  }
}

export class GenerationError extends SteadyError {
  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "generate" });
    this.name = "GenerationError";
  }
}

export class MatchError extends SteadyError {
  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "match" });
    this.name = "MatchError";
  }
}

// Helper to create circular reference error
export function circularReferenceError(
  _refPath: string,
  cycle: string[],
  specFile?: string,
): ReferenceError {
  return new ReferenceError("Circular reference detected", {
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

// Helper to create missing example error
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
      `Your OpenAPI spec defines a ${statusCode} response but doesn't include an example.`,
    suggestion: "Add an example to your spec:",
    examples: [
      "responses:",
      `  ${statusCode}:`,
      "    content:",
      "      application/json:",
      "        example:",
      "          id: 123",
      '          name: "John Doe"',
    ],
  });
}
