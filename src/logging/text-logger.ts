/**
 * TextLogger - Colored terminal output for requests and diagnostics.
 *
 * This logger is thin. It receives structured events and delegates
 * formatting to focused helpers (format-diagnostic.ts, colors.ts).
 * It does not contain diagnostic formatting logic itself.
 */

import { BaseLogger } from "./logger.ts";
import {
  attributionColor,
  attributionLabel,
  colorize,
  colors,
  formatStatus,
} from "./colors.ts";
import {
  formatDiagnostic,
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
} from "./types.ts";
import type { Diagnostic } from "../diagnostic.ts";

export class TextLogger extends BaseLogger {
  constructor(options: Partial<LoggerOptions> = {}) {
    super(options);
  }

  request(event: RequestEvent): void {
    if (this.level === "summary") {
      this.logSummary(event);
    } else {
      this.logDetailed(event);
    }
  }

  private logSummary(event: RequestEvent): void {
    const line = this.formatRequestLine(event);

    // Append first diagnostic inline if any
    const first = event.diagnostics[0];
    if (first) {
      const diag = this.formatDiagnosticOneLiner(first);
      const rest = event.diagnostics.length - 1;
      const more = rest > 0
        ? ` ${colorize(`(+${rest} more)`, colors.dim, this.useColor)}`
        : "";
      console.log(`${line}\n           ${diag}${more}`);
    } else {
      console.log(line);
    }

    if (this.shouldShowBodies()) {
      this.logRequestBodies(event);
    }
  }

  private logDetailed(event: RequestEvent): void {
    console.log(this.formatRequestLine(event));
    console.log();

    // Request details
    console.log("  Request:");
    this.logHeaders(event.request.headers, "    ");
    if (event.request.body !== undefined && this.shouldShowBodies()) {
      console.log(`    Body: ${this.formatBody(event.request.body)}`);
    }

    // Diagnostics - compiler-style
    if (event.diagnostics.length > 0) {
      console.log();
      for (const d of event.diagnostics) {
        // Use the shared compiler-style formatter
        console.log(this.indentBlock(formatDiagnostic(d, this.useColor), "  "));

        // In full mode, also show reasoning chain
        if (this.showFull() && d.attribution.reasoning.length > 0) {
          for (const reason of d.attribution.reasoning) {
            console.log(
              `    ${colorize("*", colors.dim, this.useColor)} ${reason}`,
            );
          }
        }
        console.log();
      }
    }

    // Response details
    if (this.showFull() || this.shouldShowBodies()) {
      console.log("  Response:");
      this.logHeaders(event.response.headers, "    ");
      if (event.response.body !== undefined) {
        console.log(`    Body: ${this.formatBody(event.response.body)}`);
      }
    }

    console.log();
  }

  /**
   * Format the one-line request summary:
   * [10:20:01] POST /users → 201 Created (5ms) [423 bytes]
   */
  private formatRequestLine(event: RequestEvent): string {
    const ts = colorize(
      `[${event.timestamp.toLocaleTimeString()}]`,
      colors.dim,
      this.useColor,
    );
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
    const bodySize = event.response.bodySize !== undefined
      ? ` ${
        colorize(
          `[${event.response.bodySize} bytes]`,
          colors.dim,
          this.useColor,
        )
      }`
      : "";
    const warning = event.response.responseWarning
      ? ` ${
        colorize(
          "!! " + event.response.responseWarning + " response",
          colors.yellow,
          this.useColor,
        )
      }`
      : "";

    return `${ts} ${method} ${path}${query} \u2192 ${status} ${timing}${bodySize}${warning}`;
  }

  /**
   * Format a diagnostic as a compact one-liner for summary mode:
   * x E3008 body.email: expected string, got integer [SDK Issue 90%]
   */
  private formatDiagnosticOneLiner(d: Diagnostic): string {
    const x = colorize("\u2717", colors.red, this.useColor);
    const code = colorize(d.code, colors.bold, this.useColor);
    const confidence = Math.round(d.attribution.confidence * 100);
    const attrColor = attributionColor(d.category);
    const label = attributionLabel(d.category);
    const attr = colorize(
      `[${label} ${confidence}%]`,
      attrColor,
      this.useColor,
    );

    return `${x} ${code} ${d.requestPath}: ${d.message} ${attr}`;
  }

  private logRequestBodies(event: RequestEvent): void {
    if (event.request.body !== undefined) {
      console.log(`  Request Body: ${this.formatBody(event.request.body)}`);
    }
    if (event.response.body !== undefined) {
      console.log(`  Response Body: ${this.formatBody(event.response.body)}`);
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

  /** Indent every line of a block by a prefix string. */
  private indentBlock(text: string, indent: string): string {
    return text.split("\n").map((line) => indent + line).join("\n");
  }

  startup(event: StartupEvent): void {
    const { spec, server, diagnostics } = event;

    console.log(
      colorize("Steady", colors.bold, this.useColor) +
        ` - ${spec.title} v${spec.version}`,
    );
    console.log();

    if (diagnostics.length > 0) {
      const nonErrors = diagnostics.filter((d) => d.severity !== "error");
      const collapsed = !this.showFull() && nonErrors.length > 5;
      if (this.showFull()) {
        console.log(formatDiagnostics(diagnostics, this.useColor));
        console.log(formatExplainHint(diagnostics, this.useColor));
      } else {
        console.log(
          formatStartupDiagnostics(diagnostics, event.specPath, this.useColor),
        );
        if (!collapsed) {
          console.log(formatExplainHint(diagnostics, this.useColor));
        }
      }
      console.log();
    }

    let loaded =
      `Loaded: ${spec.endpointCount}/${spec.endpointCount} endpoints`;
    if (diagnostics.length > 0) {
      loaded += ` (${formatDiagnosticSummary(diagnostics, this.useColor)})`;
    }
    console.log(loaded);

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

    const validPct = Math.round(session.validityRate * 100);
    console.log(
      `Session: ${session.requestCount} requests (${validPct}% structurally valid)`,
    );

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

      if (coverage.untestedEndpoints.length > 0) {
        const grouped = new Map<string, string[]>();
        for (const ep of coverage.untestedEndpoints) {
          const [method, path] = ep.split(" ", 2);
          const prefix = "/" + (path?.split("/")[1] ?? "");
          const existing = grouped.get(prefix);
          if (existing) {
            existing.push(`${method} ${path}`);
          } else {
            grouped.set(prefix, [`${method} ${path}`]);
          }
        }

        if (coverage.untestedEndpoints.length <= 30) {
          console.log("  Untested:");
          for (const [prefix, endpoints] of grouped) {
            console.log(
              `    ${prefix} - ${endpoints.join(", ")} (${endpoints.length})`,
            );
          }
        } else {
          console.log(
            `  Untested: ${coverage.untestedEndpoints.length} endpoints across ${grouped.size} path groups`,
          );
          const sorted = [...grouped.entries()].sort(
            (a, b) => b[1].length - a[1].length,
          );
          for (const [prefix, endpoints] of sorted.slice(0, 5)) {
            console.log(`    ${prefix} (${endpoints.length} endpoints)`);
          }
          if (sorted.length > 5) {
            console.log(`    ... and ${sorted.length - 5} more groups`);
          }
        }
      }
    }

    if (
      event.generationWarnings && event.generationWarnings.length > 0
    ) {
      const unique = [...new Set(event.generationWarnings)];
      console.log(
        `Response warnings: ${unique.length} endpoint${
          unique.length === 1 ? "" : "s"
        } returned minimal responses`,
      );
      for (const ep of unique.slice(0, 10)) {
        console.log(`  ${ep}`);
      }
      if (unique.length > 10) {
        console.log(`  ... and ${unique.length - 10} more`);
      }
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
