/**
 * Format Diagnostics — Compiler-style output (Rust/Elm inspired)
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

import { colorize, colors } from "./colors.ts";
import type { Diagnostic } from "../diagnostic.ts";

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

  // Grey out entire info diagnostic — re-apply gray after every internal
  // color reset so the grey carries through nested colorize() calls.
  // Also strip dim codes — dim on top of gray is too dark.
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
 * Format a value for expected/actual display.
 * Strings pass through as-is, everything else gets JSON.stringify.
 */
function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
