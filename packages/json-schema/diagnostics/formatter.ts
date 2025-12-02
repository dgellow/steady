/**
 * Diagnostic Formatter - Format diagnostics for display
 *
 * Provides formatters for console output, JSON responses,
 * and aggregated summaries.
 */

import type {
  Diagnostic,
  DiagnosticSeverity,
} from "./types.ts";
import { groupByCode, summarizeDiagnostics } from "./types.ts";
import { getAttributionLabel } from "./attribution.ts";

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/**
 * Get color for severity level
 */
function getSeverityColor(severity: DiagnosticSeverity): string {
  switch (severity) {
    case "error":
      return colors.red;
    case "warning":
      return colors.yellow;
    case "info":
      return colors.blue;
    case "hint":
      return colors.gray;
  }
}

/**
 * Get icon for severity level
 */
function getSeverityIcon(severity: DiagnosticSeverity): string {
  switch (severity) {
    case "error":
      return "✖";
    case "warning":
      return "⚠";
    case "info":
      return "ℹ";
    case "hint":
      return "💡";
  }
}

/**
 * Format a single diagnostic for console output
 */
export function formatDiagnostic(diagnostic: Diagnostic, useColor = true): string {
  const c = useColor ? colors : { reset: "", bold: "", dim: "", red: "", yellow: "", blue: "", cyan: "", gray: "" };
  const icon = getSeverityIcon(diagnostic.severity);
  const severityColor = useColor ? getSeverityColor(diagnostic.severity) : "";

  const lines: string[] = [];

  // Header: severity icon + code
  lines.push(
    `${severityColor}${icon}${c.reset} ${c.bold}${diagnostic.code}${c.reset}`,
  );

  // Location
  lines.push(`  ${c.dim}at${c.reset} ${diagnostic.pointer}`);

  // Message
  lines.push(`  ${diagnostic.message}`);

  // Attribution
  const attrLabel = getAttributionLabel(diagnostic.attribution.type);
  const confidencePercent = Math.round(diagnostic.attribution.confidence * 100);
  lines.push(
    `  ${c.dim}Attribution:${c.reset} ${attrLabel} (${confidencePercent}% confidence)`,
  );

  // Suggestion
  if (diagnostic.suggestion) {
    lines.push(`  ${c.cyan}→${c.reset} ${diagnostic.suggestion}`);
  }

  return lines.join("\n");
}

/**
 * Format diagnostics grouped by code for console output
 */
export function formatDiagnosticsGrouped(
  diagnostics: Diagnostic[],
  useColor = true,
): string {
  if (diagnostics.length === 0) {
    return "";
  }

  const c = useColor ? colors : { reset: "", bold: "", dim: "", red: "", yellow: "", blue: "", cyan: "", gray: "" };
  const groups = groupByCode(diagnostics);
  const lines: string[] = [];

  // Sort groups by severity (errors first, then warnings, etc.)
  const severityOrder: DiagnosticSeverity[] = ["error", "warning", "info", "hint"];
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const aSeverity = a[1][0]?.severity ?? "hint";
    const bSeverity = b[1][0]?.severity ?? "hint";
    return severityOrder.indexOf(aSeverity) - severityOrder.indexOf(bSeverity);
  });

  for (const [code, group] of sortedGroups) {
    const first = group[0]!;
    const icon = getSeverityIcon(first.severity);
    const severityColor = useColor ? getSeverityColor(first.severity) : "";
    const count = group.length;

    // Header with count if multiple
    const countStr = count > 1 ? ` (${count} occurrences)` : "";
    lines.push(
      `  ${severityColor}${icon}${c.reset} ${c.bold}${code}${c.reset}${countStr}`,
    );

    // Message (from first occurrence)
    lines.push(`    ${first.message}`);

    // Show first few locations if multiple
    if (count > 1) {
      const showCount = Math.min(3, count);
      for (let i = 0; i < showCount; i++) {
        lines.push(`    ${c.dim}•${c.reset} ${group[i]!.pointer}`);
      }
      if (count > showCount) {
        lines.push(`    ${c.dim}  ... and ${count - showCount} more${c.reset}`);
      }
    } else {
      lines.push(`    ${c.dim}at${c.reset} ${first.pointer}`);
    }

    // Suggestion
    if (first.suggestion) {
      lines.push(`    ${c.cyan}→${c.reset} ${first.suggestion}`);
    }

    lines.push(""); // Blank line between groups
  }

  return lines.join("\n");
}

/**
 * Format diagnostic summary for console output
 */
export function formatSummary(
  diagnostics: Diagnostic[],
  useColor = true,
): string {
  const c = useColor ? colors : { reset: "", bold: "", dim: "", red: "", yellow: "", blue: "", cyan: "", gray: "" };
  const summary = summarizeDiagnostics(diagnostics);

  if (summary.total === 0) {
    return `${c.dim}No diagnostics${c.reset}`;
  }

  const parts: string[] = [];

  if (summary.bySeverity.error > 0) {
    parts.push(`${c.red}${summary.bySeverity.error} error${summary.bySeverity.error > 1 ? "s" : ""}${c.reset}`);
  }
  if (summary.bySeverity.warning > 0) {
    parts.push(`${c.yellow}${summary.bySeverity.warning} warning${summary.bySeverity.warning > 1 ? "s" : ""}${c.reset}`);
  }
  if (summary.bySeverity.info > 0) {
    parts.push(`${c.blue}${summary.bySeverity.info} info${c.reset}`);
  }
  if (summary.bySeverity.hint > 0) {
    parts.push(`${c.gray}${summary.bySeverity.hint} hint${summary.bySeverity.hint > 1 ? "s" : ""}${c.reset}`);
  }

  return parts.join(", ");
}

/**
 * Format diagnostics for JSON error response
 */
export function formatForResponse(diagnostics: Diagnostic[]): object {
  if (diagnostics.length === 0) {
    return { errors: [] };
  }

  return {
    errors: diagnostics.map((d) => ({
      code: d.code,
      message: d.message,
      pointer: d.pointer,
      attribution: {
        type: d.attribution.type,
        confidence: d.attribution.confidence,
        reasoning: d.attribution.reasoning,
      },
      suggestion: d.suggestion,
    })),
  };
}

/**
 * Format a startup diagnostics section
 */
export function formatStartupDiagnostics(
  diagnostics: Diagnostic[],
  useColor = true,
): string {
  const c = useColor ? colors : { reset: "", bold: "", dim: "", red: "", yellow: "", blue: "", cyan: "", gray: "" };

  if (diagnostics.length === 0) {
    return `${c.dim}✓ No issues found${c.reset}`;
  }

  const summary = formatSummary(diagnostics, useColor);
  const grouped = formatDiagnosticsGrouped(diagnostics, useColor);

  return `${c.yellow}⚠${c.reset}  Diagnostics: ${summary}\n\n${grouped}`;
}

/**
 * Format session summary for shutdown
 */
export function formatSessionSummary(
  _staticDiagnostics: Diagnostic[],
  runtimeDiagnostics: Diagnostic[],
  requestCount: number,
  useColor = true,
): string {
  const c = useColor ? colors : { reset: "", bold: "", dim: "", red: "", yellow: "", blue: "", cyan: "", gray: "" };
  const lines: string[] = [];

  lines.push(`${c.bold}Session Summary${c.reset}`);
  lines.push(`  Requests handled: ${requestCount}`);
  lines.push("");

  // Runtime issues by attribution
  const runtimeSummary = summarizeDiagnostics(runtimeDiagnostics);
  if (runtimeDiagnostics.length > 0) {
    lines.push("  Runtime Issues:");
    if (runtimeSummary.byAttribution["sdk-issue"] > 0) {
      lines.push(`    ${c.red}SDK issues:${c.reset}  ${runtimeSummary.byAttribution["sdk-issue"]}`);
    }
    if (runtimeSummary.byAttribution["spec-issue"] > 0) {
      lines.push(`    ${c.yellow}Spec issues:${c.reset} ${runtimeSummary.byAttribution["spec-issue"]}`);
    }
    if (runtimeSummary.byAttribution["ambiguous"] > 0) {
      lines.push(`    ${c.gray}Ambiguous:${c.reset}   ${runtimeSummary.byAttribution["ambiguous"]}`);
    }
    lines.push("");

    // Top issues
    const groups = groupByCode(runtimeDiagnostics);
    const sorted = Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    if (sorted.length > 0) {
      lines.push("  Top Issues:");
      for (let i = 0; i < sorted.length; i++) {
        const [code, group] = sorted[i]!;
        const first = group[0]!;
        const location = first.context?.request
          ? `${first.context.request.method} ${first.context.request.path}`
          : first.pointer;
        lines.push(`    ${i + 1}. ${code} at ${location} (${group.length} times)`);
      }
    }
  } else {
    lines.push(`  ${c.dim}No runtime issues${c.reset}`);
  }

  return lines.join("\n");
}
