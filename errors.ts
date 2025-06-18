import { ErrorContext } from "./types.ts";

// ANSI color codes for terminal output
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GRAY = "\x1b[90m";
const GREEN = "\x1b[32m";

export class SteadyError extends Error {
  constructor(
    message: string,
    public context: ErrorContext,
  ) {
    super(message);
    this.name = "SteadyError";
  }

  format(): string {
    const lines: string[] = [];

    // Error type and message
    lines.push(`${RED}${BOLD}ERROR: ${this.message}${RESET}`);
    lines.push("");

    // Location information
    if (this.context.specFile && this.context.specLine) {
      lines.push(
        `  ${GRAY}In spec:${RESET} ${this.context.specFile}:${this.context.specLine}`,
      );
    }

    if (this.context.httpPath) {
      lines.push(
        `  ${GRAY}Path:${RESET} ${
          this.context.httpMethod || "?"
        } ${this.context.httpPath}`,
      );
    }

    if (this.context.schemaPath && this.context.schemaPath.length > 0) {
      lines.push(
        `  ${GRAY}Schema path:${RESET} ${this.context.schemaPath.join(" → ")}`,
      );
    }

    lines.push("");

    // Reason
    lines.push(`  ${this.context.reason}`);

    // Expected vs Actual
    if (
      this.context.expected !== undefined || this.context.actual !== undefined
    ) {
      lines.push("");
      if (this.context.expected !== undefined) {
        lines.push(
          `  ${GREEN}Expected:${RESET} ${
            JSON.stringify(this.context.expected, null, 2).split("\n").join(
              "\n  ",
            )
          }`,
        );
      }
      if (this.context.actual !== undefined) {
        lines.push(
          `  ${RED}Actual:${RESET} ${
            JSON.stringify(this.context.actual, null, 2).split("\n").join(
              "\n  ",
            )
          }`,
        );
      }
    }

    // Suggestion
    if (this.context.suggestion) {
      lines.push("");
      lines.push(`  ${YELLOW}${BOLD}How to fix:${RESET}`);
      lines.push(`  ${this.context.suggestion}`);
    }

    // Examples
    if (this.context.examples && this.context.examples.length > 0) {
      lines.push("");
      lines.push(`  ${BLUE}Example:${RESET}`);
      for (const example of this.context.examples) {
        lines.push(`    ${example}`);
      }
    }

    return lines.join("\n");
  }
}

export class ParseError extends SteadyError {
  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "parse" });
    this.name = "ParseError";
  }
}

export class ValidationError extends SteadyError {
  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "validate" });
    this.name = "ValidationError";
  }
}

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

// Utility function to format multiple errors
export function formatErrors(errors: SteadyError[]): string {
  if (errors.length === 0) return "";

  const lines: string[] = [];
  lines.push(
    `${RED}${BOLD}Found ${errors.length} error${
      errors.length > 1 ? "s" : ""
    }:${RESET}`,
  );
  lines.push("");

  for (let i = 0; i < errors.length; i++) {
    if (i > 0) lines.push("\n" + "─".repeat(60) + "\n");
    const error = errors[i];
    if (error) {
      lines.push(error.format());
    }
  }

  return lines.join("\n");
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
