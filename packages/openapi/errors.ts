/**
 * Safely stringify a value, handling circular references and non-serializable values
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    // Handle circular references or non-serializable values
    if (typeof value === "object" && value !== null) {
      return "[Complex Object]";
    }
    return String(value);
  }
}

export interface ErrorContext {
  // Where
  specFile?: string;
  specLine?: number;
  httpPath?: string;
  httpMethod?: string;
  schemaPath?: string[]; // JSON path like ['components', 'schemas', 'User']

  // What
  errorType: "parse" | "validate" | "match" | "generate" | "reference";
  expected?: unknown;
  actual?: unknown;

  // Why
  reason: string;

  // How to fix
  suggestion?: string;
  examples?: string[];

  // Multiple errors (for comprehensive validation)
  allErrors?: SpecValidationError[];
}

export class SteadyError extends Error {
  constructor(
    message: string,
    public context: ErrorContext,
    public suggestion?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  format(): string {
    const RED = "\x1b[31m";
    const YELLOW = "\x1b[33m";
    const GREEN = "\x1b[32m";
    const BOLD = "\x1b[1m";
    const RESET = "\x1b[0m";
    const DIM = "\x1b[90m";

    let output = `${RED}${BOLD}ERROR: ${this.message}${RESET}\n`;

    if (this.context.specFile) {
      output += `\n  ${DIM}In spec:${RESET} ${this.context.specFile}`;
      if (this.context.specLine) {
        output += `:${this.context.specLine}`;
      }
    }

    if (this.context.httpPath) {
      output += `\n  ${DIM}Path:${RESET} ${
        this.context.httpMethod || "?"
      } ${this.context.httpPath}`;
    }

    if (this.context.schemaPath && this.context.schemaPath.length > 0) {
      output += `\n  ${DIM}Schema path:${RESET} ${
        this.context.schemaPath.join(".")
      }`;
    }

    output += `\n\n  ${this.context.reason}`;

    if (this.context.expected !== undefined) {
      output += `\n\n  ${GREEN}Expected:${RESET} ${
        safeStringify(this.context.expected)
      }`;
      output += `\n  ${RED}Actual:${RESET} ${
        safeStringify(this.context.actual)
      }`;
    }

    const suggestion = this.suggestion || this.context.suggestion;
    if (suggestion) {
      output += `\n\n  ${YELLOW}${BOLD}How to fix:${RESET}\n  ${suggestion}`;
    }

    if (this.context.examples && this.context.examples.length > 0) {
      output += `\n\n  ${DIM}Example:${RESET}\n`;
      this.context.examples.forEach((example) => {
        output += `    ${example}\n`;
      });
    }

    return output;
  }
}

export class ParseError extends SteadyError {
  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "parse" });
  }
}

/**
 * Error thrown when OpenAPI spec validation fails.
 * Distinct from SchemaValidationError (JSON Schema) and ValidationIssue (request validation).
 */
export class SpecValidationError extends SteadyError {
  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "validate" });
  }
}
