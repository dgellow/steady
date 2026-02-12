/**
 * Format Diagnostics. Compiler-style output (Rust/Elm inspired)
 *
 * Renders Diagnostic objects as structured terminal output:
 *
 *   error[E1004]: Unresolved reference
 *    --> #/paths/~1users/get/responses/200/content/application~1json/schema
 *     |
 *     |  $ref: '#/components/schemas/UserResponse'
 *     |         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *     |         Target does not exist
 *     |
 *     = Check that the referenced path exists in the spec
 */

import { relative } from "@std/path";
import { colorize, colors } from "./colors.ts";
import type { Diagnostic } from "../diagnostic.ts";
import { getCode, hasCode } from "../codes/registry.ts";

/**
 * Get color code for severity level.
 */
function severityColor(severity: Diagnostic["severity"]): string {
  switch (severity) {
    case "error":
      return colors.red;
    case "warning":
      return colors.yellow;
    case "info":
      return colors.gray;
  }
}

/**
 * Format a single diagnostic for terminal output.
 */
export function formatDiagnostic(
  d: Diagnostic,
  useColor = true,
): string {
  const lines: string[] = [];
  const color = severityColor(d.severity);

  // Header: severity[code]: message
  const label = colorize(
    `${d.severity}[${d.code}]`,
    color + colors.bold,
    useColor,
  );
  lines.push(`${label}: ${d.message}`);

  // Pointer line
  if (d.specPointer) {
    lines.push(
      ` ${colorize("-->", colors.dim, useColor)} ${d.specPointer}`,
    );
  }

  // Context lines (pipe section)
  const ctx = d.display?.context;
  if (ctx && ctx.length > 0) {
    const pipe = colorize("  |", colors.dim, useColor);
    lines.push(pipe);

    for (const line of ctx) {
      lines.push(`${pipe}  ${line.text}`);

      if (line.highlight) {
        const { start, end, label: hlLabel } = line.highlight;
        const carets = "^".repeat(Math.max(1, end - start));
        const padding = " ".repeat(start);
        lines.push(
          `${pipe}  ${padding}${
            colorize(carets, color + colors.bold, useColor)
          }`,
        );
        if (hlLabel) {
          lines.push(
            `${pipe}  ${padding}${
              colorize(hlLabel, color + colors.bold, useColor)
            }`,
          );
        }
      }
    }

    lines.push(pipe);
  }

  // Notes (= prefix)
  const notes = d.display?.notes;
  if (notes) {
    for (const note of notes) {
      lines.push(
        `  ${colorize("=", colors.dim, useColor)} ${note}`,
      );
    }
  }

  // Expected/actual (= prefix)
  if (d.expected !== undefined || d.actual !== undefined) {
    if (d.expected !== undefined) {
      lines.push(
        `  ${colorize("=", colors.dim, useColor)} expected: ${
          formatValue(d.expected)
        }`,
      );
    }
    if (d.actual !== undefined) {
      lines.push(
        `  ${colorize("=", colors.dim, useColor)}   actual: ${
          formatValue(d.actual)
        }`,
      );
    }
  }

  // Suggestion (= prefix)
  if (d.suggestion) {
    lines.push(
      `  ${colorize("=", colors.dim, useColor)} ${d.suggestion}`,
    );
  }

  const result = lines.join("\n");

  // Grey out entire info diagnostic. Re-apply gray after every internal
  // color reset so the grey carries through nested colorize() calls.
  // Also strip dim codes. Dim on top of gray is too dark.
  if (d.severity === "info" && useColor) {
    return colors.gray +
      result
        .replaceAll(colors.dim, colors.gray)
        .replaceAll(colors.reset, colors.reset + colors.gray) +
      colors.reset;
  }

  return result;
}

/**
 * Format multiple diagnostics grouped by severity.
 */
export function formatDiagnostics(
  diagnostics: Diagnostic[],
  useColor = true,
): string {
  if (diagnostics.length === 0) {
    return "";
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const info = diagnostics.filter((d) => d.severity === "info");

  const lines: string[] = [];

  for (const group of [errors, warnings, info]) {
    for (const diagnostic of group) {
      lines.push(formatDiagnostic(diagnostic, useColor));
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

/**
 * Format a summary of diagnostics (counts by severity).
 */
export function formatDiagnosticSummary(
  diagnostics: Diagnostic[],
  useColor = true,
): string {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const infoCount = diagnostics.filter((d) => d.severity === "info").length;

  const parts: string[] = [];

  if (errors > 0) {
    const text = `${errors} error${errors > 1 ? "s" : ""}`;
    parts.push(colorize(text, severityColor("error"), useColor));
  }
  if (warnings > 0) {
    const text = `${warnings} warning${warnings > 1 ? "s" : ""}`;
    parts.push(colorize(text, severityColor("warning"), useColor));
  }
  if (infoCount > 0) {
    const text = `${infoCount} info`;
    parts.push(colorize(text, severityColor("info"), useColor));
  }

  if (parts.length === 0) {
    return colorize("No issues", colors.green, useColor);
  }

  return parts.join(", ");
}

/**
 * Format a "For details, try: steady explain ..." hint line.
 * Returns empty string if no diagnostics.
 */
export function formatExplainHint(
  diagnostics: Diagnostic[],
  useColor = true,
): string {
  const uniqueCodes = [...new Set(diagnostics.map((d) => d.code))];
  if (uniqueCodes.length === 0) return "";

  const maxCodes = 3;
  const shown = uniqueCodes.slice(0, maxCodes).join(" ");
  const suffix = uniqueCodes.length > maxCodes ? " ..." : "";
  return colorize(
    `For details, try: steady explain ${shown}${suffix}`,
    colors.dim,
    useColor,
  );
}

/**
 * Format diagnostics for startup output with threshold-based collapse.
 *
 * - Errors: always shown in full
 * - Non-errors (warnings/info): shown in full if ≤ 5, otherwise collapsed
 *   into a grouped summary with a pointer to `steady validate`
 */
export function formatStartupDiagnostics(
  diagnostics: Diagnostic[],
  specPath: string | undefined,
  useColor = true,
): string {
  if (diagnostics.length === 0) return "";

  const errors = diagnostics.filter((d) => d.severity === "error");
  const nonErrors = diagnostics.filter((d) => d.severity !== "error");

  const lines: string[] = [];

  // Errors always shown in full
  if (errors.length > 0) {
    lines.push(formatDiagnostics(errors, useColor));
  }

  // Non-errors: show in full if ≤ 5, otherwise collapse
  if (nonErrors.length <= 5) {
    if (nonErrors.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(formatDiagnostics(nonErrors, useColor));
    }
  } else {
    if (lines.length > 0) lines.push("");

    // Group by severity, then by code within each severity
    const bySeverity = new Map<string, Diagnostic[]>();
    for (const d of nonErrors) {
      const existing = bySeverity.get(d.severity);
      if (existing) {
        existing.push(d);
      } else {
        bySeverity.set(d.severity, [d]);
      }
    }

    // Output one line per severity (warnings before info)
    const severityOrder = ["warning", "info"];
    for (const sev of severityOrder) {
      const group = bySeverity.get(sev);
      if (!group || group.length === 0) continue;

      const counts = new Map<string, number>();
      for (const d of group) {
        counts.set(d.code, (counts.get(d.code) ?? 0) + 1);
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const total = group.length;
      const label = sev === "warning"
        ? (total === 1 ? "warning" : "warnings")
        : "info";

      let summaryLine: string;
      if (sorted.length === 1) {
        const [code] = sorted[0] ?? [""];
        const title = hasCode(code) ? ` ${getCode(code).title}` : "";
        summaryLine = `  ${total} ${label}: ${code}${title}`;
      } else {
        const parts = sorted.map(([code, count]) => {
          const title = hasCode(code) ? ` ${getCode(code).title}` : "";
          return `${count}\u00D7 ${code}${title}`;
        });
        summaryLine = `  ${total} ${label}: ${parts.join(", ")}`;
      }

      lines.push(colorize(summaryLine, colors.dim, useColor));
    }

    const displayPath = specPath && specPath.startsWith("/")
      ? relative(Deno.cwd(), specPath)
      : specPath;
    const validateCmd = displayPath
      ? `steady validate ${displayPath}`
      : "steady validate <spec>";
    lines.push(
      colorize(`  Run \`${validateCmd}\` for details`, colors.dim, useColor),
    );
    lines.push(
      colorize(
        "  Or use --log-level full to show all diagnostics at startup",
        colors.dim,
        useColor,
      ),
    );
  }

  return lines.join("\n");
}

/**
 * Format a value for expected/actual display.
 * Strings pass through as-is, everything else gets JSON.stringify.
 */
function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
