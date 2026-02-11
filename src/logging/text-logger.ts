/**
 * TextLogger - Colored terminal output for requests and diagnostics
 */

import { BaseLogger } from "./logger.ts";
import {
  attributionColor,
  attributionLabel,
  colorize,
  colors,
  formatStatus,
} from "./colors.ts";
import { formatActual } from "./format-expected.ts";
import {
  formatDiagnostics,
  formatDiagnosticSummary,
  formatExplainHint,
  formatStartupDiagnostics,
} from "./format-diagnostic.ts";
import type {
  LoggerOptions,
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
  ValidationError,
} from "./types.ts";

export class TextLogger extends BaseLogger {
  constructor(options: Partial<LoggerOptions> = {}) {
    super(options);
  }

  request(event: RequestEvent): void {
    const timestamp = event.timestamp.toLocaleTimeString();
    const method = event.request.method.toUpperCase();
    const path = event.request.path;
    const query = event.request.query
      ? colorize(event.request.query, colors.dim, this.useColor)
      : "";
    const status = formatStatus(event.response.status, this.useColor);
    const timing = colorize(
      `(${event.response.timing}ms)`,
      colors.dim,
      this.useColor,
    );

    if (this.level === "summary") {
      this.logSummary(timestamp, method, path, query, status, timing, event);
    } else {
      this.logDetailed(timestamp, method, path, query, status, timing, event);
    }
  }

  private logSummary(
    timestamp: string,
    method: string,
    path: string,
    query: string,
    status: string,
    timing: string,
    event: RequestEvent,
  ): void {
    const ts = colorize(`[${timestamp}]`, colors.dim, this.useColor);
    let line = `${ts} ${method} ${path}${query} → ${status} ${timing}`;

    // Add first validation error if any
    if (!event.validation.valid && event.validation.errors.length > 0) {
      const firstError = event.validation.errors[0];
      if (firstError) {
        const errorLine = this.formatErrorSummary(firstError);
        line += `\n           ${errorLine}`;
        if (event.validation.errors.length > 1) {
          const more = colorize(
            `(+${event.validation.errors.length - 1} more)`,
            colors.dim,
            this.useColor,
          );
          line += ` ${more}`;
        }
      }
    }

    console.log(line);

    // Show bodies in summary mode if logBodies is enabled
    if (this.shouldShowBodies()) {
      if (event.request.body !== undefined) {
        console.log(`  Request Body: ${this.formatBody(event.request.body)}`);
      }
      if (event.response.body !== undefined) {
        console.log(`  Response Body: ${this.formatBody(event.response.body)}`);
      }
    }
  }

  private logDetailed(
    timestamp: string,
    method: string,
    path: string,
    query: string,
    status: string,
    timing: string,
    event: RequestEvent,
  ): void {
    const ts = colorize(`[${timestamp}]`, colors.dim, this.useColor);
    console.log(`${ts} ${method} ${path}${query} → ${status} ${timing}`);
    console.log();

    // Request details
    console.log("  Request:");
    this.logHeaders(event.request.headers, "    ");
    if (event.request.body !== undefined && this.shouldShowBodies()) {
      console.log(`    Body: ${this.formatBody(event.request.body)}`);
    }

    // Validation errors
    if (!event.validation.valid && event.validation.errors.length > 0) {
      console.log();
      for (const error of event.validation.errors) {
        this.logValidationError(error);
      }
    }

    // Response details
    if (this.showFull() || this.shouldShowBodies()) {
      console.log();
      console.log("  Response:");
      this.logHeaders(event.response.headers, "    ");
      if (event.response.body !== undefined) {
        console.log(`    Body: ${this.formatBody(event.response.body)}`);
      }
    }

    console.log();
  }

  private formatErrorSummary(error: ValidationError): string {
    const x = colorize("\u2717", colors.red, this.useColor); // ✗
    const path = error.path;
    const expected = error.expected;
    const actual = formatActual(error.actual, 30);
    const attr = this.formatAttribution(error);

    return `${x} ${path}: expected ${expected}, got ${actual} ${attr}`;
  }

  private formatAttribution(error: ValidationError): string {
    const color = attributionColor(error.category);
    const label = attributionLabel(error.category);
    const confidence = Math.round(error.attribution.confidence * 100);
    return colorize(`[${label} ${confidence}%]`, color, this.useColor);
  }

  private logValidationError(error: ValidationError): void {
    console.log("  Validation Error:");
    console.log(`    Path: ${error.path}`);
    console.log(`    Expected: ${error.expected}`);
    console.log(`    Received: ${formatActual(error.actual)}`);
    console.log(`    Spec: ${error.specPointer}`);
    console.log();

    const attrColor = attributionColor(error.category);
    const attrLabel = attributionLabel(error.category);
    const confidence = Math.round(error.attribution.confidence * 100);
    console.log(
      colorize(
        `  ${attrLabel} (${confidence}% confidence)`,
        attrColor,
        this.useColor,
      ),
    );

    if (error.suggestion) {
      console.log(
        `  ${
          colorize("\u2192", colors.cyan, this.useColor)
        } ${error.suggestion}`,
      );
    }
  }

  private logHeaders(headers: Headers, indent: string): void {
    const sensitive = ["authorization", "cookie", "x-api-key"];
    let count = 0;
    const maxHeaders = this.showFull() ? Infinity : 3;

    headers.forEach((value, key) => {
      if (count >= maxHeaders) return;
      count++;

      if (sensitive.includes(key.toLowerCase())) {
        const hidden = colorize("(hidden)", colors.dim, this.useColor);
        console.log(`${indent}${key}: ${hidden}`);
      } else {
        console.log(`${indent}${key}: ${value}`);
      }
    });

    if (!this.showFull()) {
      let totalHeaders = 0;
      headers.forEach(() => totalHeaders++);
      if (totalHeaders > maxHeaders) {
        const more = colorize(
          `...and ${totalHeaders - maxHeaders} more`,
          colors.dim,
          this.useColor,
        );
        console.log(`${indent}${more}`);
      }
    }
  }

  private formatBody(body: unknown): string {
    if (body === undefined) {
      return colorize("(empty)", colors.dim, this.useColor);
    }

    try {
      const json = JSON.stringify(body, null, 2);
      const lines = json.split("\n");

      if (!this.showFull() && lines.length > 10) {
        const preview = lines.slice(0, 10).join("\n");
        const more = colorize(
          `... ${lines.length - 10} more lines`,
          colors.dim,
          this.useColor,
        );
        return `\n${preview}\n${more}`;
      }

      return `\n${json}`;
    } catch {
      return String(body);
    }
  }

  startup(event: StartupEvent): void {
    const { spec, server, diagnostics } = event;

    // Title line
    console.log(
      colorize("Steady", colors.bold, this.useColor) +
        ` - ${spec.title} v${spec.version}`,
    );
    console.log();

    // Diagnostics (if any)
    if (diagnostics.length > 0) {
      const nonErrors = diagnostics.filter((d) => d.severity !== "error");
      const collapsed = !this.showFull() && nonErrors.length > 5;
      if (this.showFull()) {
        // --level full: show all diagnostics in detail
        console.log(formatDiagnostics(diagnostics, this.useColor));
        console.log(formatExplainHint(diagnostics, this.useColor));
      } else {
        console.log(
          formatStartupDiagnostics(diagnostics, event.specPath, this.useColor),
        );
        // Only show explain hint when diagnostics are shown in full
        if (!collapsed) {
          console.log(formatExplainHint(diagnostics, this.useColor));
        }
      }
      console.log();
    }

    // Loaded summary with inline diagnostic count
    let loaded =
      `Loaded: ${spec.endpointCount}/${spec.endpointCount} endpoints`;
    if (diagnostics.length > 0) {
      loaded += ` (${formatDiagnosticSummary(diagnostics, this.useColor)})`;
    }
    console.log(loaded);

    // Listening line
    console.log(
      `Ready to accept requests on ${server.url}${
        server.rejectOnSdkError ? " (reject-on-sdk-error)" : ""
      }`,
    );
    console.log();
  }

  shutdown(event: ShutdownEvent): void {
    const { session, topIssues, coverage } = event;

    console.log();

    // Session line with validity rate
    const validPct = Math.round(session.validityRate * 100);
    console.log(
      `Session: ${session.requestCount} requests (${validPct}% structurally valid)`,
    );

    // Issues line — only if there are issues, only non-zero categories
    const categoryEntries = Object.entries(session.categoryBreakdown)
      .filter(([_, count]) => count > 0);
    if (categoryEntries.length > 0) {
      const parts = categoryEntries.map(([cat, count]) => `${count} ${cat}`);
      console.log(`Issues: ${parts.join(", ")}`);
    }

    if (coverage && coverage.total > 0) {
      const pct = Math.round((coverage.tested / coverage.total) * 100);
      console.log(
        `Coverage: ${coverage.tested}/${coverage.total} endpoints (${pct}%)`,
      );
    }

    if (topIssues.length > 0) {
      console.log();
      console.log("Top issues:");
      for (const issue of topIssues) {
        const attr = colorize(
          `[${attributionLabel(issue.category).split(" ")[0]}]`,
          attributionColor(issue.category),
          this.useColor,
        );
        console.log(
          `  ${issue.method} ${issue.path} - ${issue.message} (${issue.count}\u00D7) ${attr}`,
        );
      }
    }
  }

  warning(message: string, context?: Record<string, unknown>): void {
    const prefix = colorize("[Steady] Warning:", colors.yellow, this.useColor);
    console.warn(`${prefix} ${message}`);
    if (context && this.showFull()) {
      console.warn(`  Context: ${JSON.stringify(context)}`);
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    const prefix = colorize("[Steady] Error:", colors.red, this.useColor);
    console.error(`${prefix} ${message}`);
    if (context && this.showFull()) {
      console.error(`  Context: ${JSON.stringify(context)}`);
    }
  }
}
