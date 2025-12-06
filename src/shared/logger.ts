import type { LogLevel, LogValidationResult } from "./types.ts";

// Re-export for backwards compatibility
export type { LogValidationResult as ValidationResult } from "./types.ts";

// ANSI color codes
const RESET = "\x1b[0m";
// const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";

interface RequestLoggerWithPending extends RequestLogger {
  _pendingLogLine?: string;
}

export class RequestLogger {
  constructor(
    private logLevel: LogLevel,
    private logBodies: boolean = false,
  ) {}

  logRequest(
    req: Request,
    path: string,
    method: string,
    validation?: LogValidationResult,
  ): void {
    const url = new URL(req.url);
    const timestamp = new Date().toLocaleTimeString();

    // Build the main log line
    const queryString = url.search ? `${DIM}${url.search}${RESET}` : "";
    const fullPath = `${path}${queryString}`;

    // Log based on level
    if (this.logLevel === "summary") {
      // Don't log yet in summary mode - we'll do it all at once in logResponse
      // Store the log line for later
      (this as RequestLoggerWithPending)._pendingLogLine =
        `${GRAY}[${timestamp}]${RESET} ${method.toUpperCase()} ${fullPath}`;
    } else {
      // Details or full mode
      console.log(
        `${GRAY}[${timestamp}]${RESET} ${method.toUpperCase()} ${fullPath}`,
      );

      if (this.logLevel === "details" || this.logLevel === "full") {
        // Log headers (filtering sensitive ones)
        const headers = this.formatHeaders(req.headers);
        if (headers.length > 0) {
          console.log(`├─ Headers: ${headers}`);
        }

        // Log body if present and enabled
        if (
          (this.logBodies || this.logLevel === "full") && req.method !== "GET"
        ) {
          const bodyPreview = this.formatBody(req);
          console.log(`└─ Body: ${bodyPreview}`);
        } else if (req.method !== "GET") {
          console.log(`└─ Body: (not shown, use --log-bodies)`);
        }

        // Log validation errors if any
        if (validation && !validation.valid) {
          console.log(`└─ ${RED}❌ Validation failed:${RESET}`);
          validation.errors.forEach((error, i) => {
            const isLast = i === validation.errors.length - 1;
            const prefix = isLast ? "   └─" : "   ├─";
            console.log(`${prefix} ${error.path}: ${error.message}`);
          });
        }
      }
    }
  }

  logResponse(
    statusCode: number,
    timing: number,
    validation?: LogValidationResult,
  ): void {
    const status = this.formatStatus(statusCode);
    const timingStr = `${GRAY}(${timing}ms)${RESET}`;

    if (this.logLevel === "summary") {
      // Get the pending log line from logRequest
      const pendingLine = (this as RequestLoggerWithPending)._pendingLogLine ||
        "";
      let line = `${pendingLine} → ${status} ${timingStr}`;

      // Add validation indicator
      if (validation) {
        if (!validation.valid && validation.errors.length > 0) {
          const firstError = validation.errors[0];
          if (firstError) {
            line +=
              `\n           ${YELLOW}⚠️  ${firstError.path}: ${firstError.message}${RESET}`;
            // Show count if there are more errors
            if (validation.errors.length > 1) {
              line += ` ${DIM}(+${validation.errors.length - 1} more)${RESET}`;
            }
          }
        } else if (validation.warnings.length > 0) {
          const firstWarning = validation.warnings[0];
          if (firstWarning) {
            line += `\n           ${DIM}⚠️  ${firstWarning.message}${RESET}`;
            if (validation.warnings.length > 1) {
              line += ` ${DIM}(+${
                validation.warnings.length - 1
              } more)${RESET}`;
            }
          }
        }
      }

      console.log(line);
      // Clear the pending line
      delete (this as RequestLoggerWithPending)._pendingLogLine;
    } else {
      // In details mode, response is on its own line
      console.log(`→ ${status} ${timingStr}`);
    }
  }

  logResponseDetails(res: Response, body?: unknown): void {
    if (this.logLevel === "details" || this.logLevel === "full") {
      // Log response headers
      const headers = this.formatHeaders(res.headers);
      if (headers.length > 0) {
        console.log(`├─ Headers: ${headers}`);
      }

      // Log response body
      if (body && (this.logBodies || this.logLevel === "full")) {
        const bodyStr = this.formatResponseBody(body);
        console.log(`└─ Body: ${bodyStr}`);
      }

      console.log(""); // Empty line for readability
    }
  }

  protected formatStatus(code: number): string {
    if (code >= 200 && code < 300) {
      return `${GREEN}${code} ${this.getStatusText(code)}${RESET}`;
    } else if (code >= 400 && code < 500) {
      return `${YELLOW}${code} ${this.getStatusText(code)}${RESET}`;
    } else if (code >= 500) {
      return `${RED}${code} ${this.getStatusText(code)}${RESET}`;
    }
    return `${code} ${this.getStatusText(code)}`;
  }

  protected getStatusText(code: number): string {
    const statuses: Record<number, string> = {
      200: "OK",
      201: "Created",
      204: "No Content",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      500: "Internal Server Error",
    };
    return statuses[code] || "";
  }

  protected formatHeaders(headers: Headers): string {
    const filtered: string[] = [];
    const sensitive = ["authorization", "cookie", "x-api-key"];

    // Count total headers first (Headers doesn't have a size property)
    let totalHeaderCount = 0;
    headers.forEach(() => {
      totalHeaderCount++;
    });

    headers.forEach((value, key) => {
      if (sensitive.includes(key.toLowerCase())) {
        filtered.push(`${key}: ${DIM}(hidden)${RESET}`);
      } else if (this.logLevel === "full") {
        filtered.push(`${key}: ${value}`);
      } else if (filtered.length < 3) {
        // In details mode, only show first 3 headers
        filtered.push(`${key}: ${value}`);
      }
    });

    // BUG FIX: headers.forEach.length was returning 1 (function arity),
    // not the actual header count. Now using totalHeaderCount.
    if (totalHeaderCount > filtered.length && this.logLevel !== "full") {
      filtered.push(
        `${DIM}...and ${totalHeaderCount - filtered.length} more${RESET}`,
      );
    }

    return filtered.join(", ");
  }

  private formatBody(_req: Request): string {
    // This is a simplified version - in reality we'd need to handle
    // different content types, streaming, etc.
    return "(request body formatting not yet implemented)";
  }

  private formatResponseBody(body: unknown): string {
    if (typeof body === "object" && body !== null) {
      const json = JSON.stringify(body, null, 2);
      const lines = json.split("\n");

      if (this.logLevel === "details" && lines.length > 10) {
        // Truncate large bodies in details mode
        const preview = lines.slice(0, 10).join("\n");
        return `\n${preview}\n${DIM}... ${
          lines.length - 10
        } more lines${RESET}`;
      }

      return "\n" + json;
    }

    return String(body);
  }
}
