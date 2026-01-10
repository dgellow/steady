/**
 * Format Diagnostics - Format spec diagnostics with full context
 *
 * Shows actual structure for cycles, chains, and ignored keywords.
 * No vague descriptions - show exactly what's happening.
 */

import { colorize, colors } from "./colors.ts";
import type { SpecDiagnostic } from "./types.ts";

/**
 * Get icon for severity level
 */
function getSeverityIcon(severity: SpecDiagnostic["severity"]): string {
  switch (severity) {
    case "error":
      return "\u2717"; // ✗
    case "warning":
      return "\u26A0"; // ⚠
    case "info":
      return "\u2139"; // ℹ
    case "hint":
      return "\u2192"; // →
  }
}

/**
 * Get color for severity level
 */
function getSeverityColor(severity: SpecDiagnostic["severity"]): string {
  switch (severity) {
    case "error":
      return colors.red;
    case "warning":
      return colors.yellow;
    case "info":
      return colors.blue;
    case "hint":
      return colors.dim;
  }
}

/**
 * Format a single diagnostic for terminal output
 */
export function formatDiagnostic(
  diagnostic: SpecDiagnostic,
  useColor = true,
): string {
  const lines: string[] = [];
  const icon = getSeverityIcon(diagnostic.severity);
  const iconColor = getSeverityColor(diagnostic.severity);

  // Header: icon + message
  const header = `${colorize(icon, iconColor, useColor)} ${diagnostic.message}`;
  lines.push(header);

  // Pointer - skip if it's root (#) with no additional context to show
  const hasChain = diagnostic.chain && diagnostic.chain.length > 0;
  const hasIgnoredKeywords = diagnostic.ignoredKeywords &&
    diagnostic.ignoredKeywords.length > 0;
  const isRoot = diagnostic.pointer === "#";

  if (!isRoot || hasChain || hasIgnoredKeywords) {
    lines.push(`  ${diagnostic.pointer}`);
  }

  // Chain (for circular refs, deep refs, etc.)
  if (hasChain) {
    for (const step of diagnostic.chain!) {
      lines.push(`    \u2192 ${step}`); // →
    }
  }

  // Ignored keywords (for $ref siblings)
  if (hasIgnoredKeywords) {
    for (const keyword of diagnostic.ignoredKeywords!) {
      const dimArrow = colorize("\u2190 ignored", colors.dim, useColor);
      lines.push(`    ${keyword}  ${dimArrow}`);
    }
  }

  // Suggestion (actionable advice)
  if (diagnostic.suggestion) {
    const dimSuggestion = colorize(
      `\u2192 ${diagnostic.suggestion}`,
      colors.dim,
      useColor,
    );
    lines.push(`  ${dimSuggestion}`);
  }

  return lines.join("\n");
}

/**
 * Format multiple diagnostics grouped by severity
 */
export function formatDiagnostics(
  diagnostics: SpecDiagnostic[],
  useColor = true,
): string {
  if (diagnostics.length === 0) {
    return "";
  }

  // Group by severity
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const info = diagnostics.filter((d) => d.severity === "info");

  const lines: string[] = [];

  // Format each group
  for (const group of [errors, warnings, info]) {
    for (const diagnostic of group) {
      lines.push(formatDiagnostic(diagnostic, useColor));
      lines.push(""); // Blank line between diagnostics
    }
  }

  return lines.join("\n").trimEnd();
}

/**
 * Format a summary of diagnostics (counts by severity)
 */
export function formatDiagnosticSummary(
  diagnostics: SpecDiagnostic[],
  useColor = true,
): string {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const info = diagnostics.filter((d) => d.severity === "info").length;

  const parts: string[] = [];

  if (errors > 0) {
    const text = `${errors} error${errors > 1 ? "s" : ""}`;
    parts.push(colorize(text, colors.red, useColor));
  }
  if (warnings > 0) {
    const text = `${warnings} warning${warnings > 1 ? "s" : ""}`;
    parts.push(colorize(text, colors.yellow, useColor));
  }
  if (info > 0) {
    const text = `${info} info`;
    parts.push(colorize(text, colors.blue, useColor));
  }

  if (parts.length === 0) {
    return colorize("No issues", colors.green, useColor);
  }

  return parts.join(", ");
}

/**
 * Create a circular reference diagnostic with the reference chain
 */
export function createCircularRefDiagnostic(
  pointer: string,
  chain: string[],
): SpecDiagnostic {
  return {
    severity: "warning",
    code: "ref-cycle",
    pointer,
    message: "Circular reference",
    chain,
  };
}

/**
 * Create an unresolved reference diagnostic
 */
export function createUnresolvedRefDiagnostic(
  pointer: string,
  refTarget: string,
): SpecDiagnostic {
  return {
    severity: "error",
    code: "ref-unresolved",
    pointer,
    message: "Unresolved reference",
    chain: [`\$ref: ${refTarget}`, `Schema does not exist`],
  };
}

/**
 * Create a $ref siblings diagnostic (keywords ignored alongside $ref)
 */
export function createRefSiblingsDiagnostic(
  pointer: string,
  ignoredKeywords: string[],
): SpecDiagnostic {
  return {
    severity: "warning",
    code: "schema-ref-siblings",
    pointer,
    message: "Keywords ignored alongside $ref",
    ignoredKeywords,
  };
}

/**
 * Create a missing example diagnostic
 */
export function createMissingExampleDiagnostic(
  pointer: string,
  schemaRef?: string,
): SpecDiagnostic {
  const chain = schemaRef ? [`Will generate from: ${schemaRef}`] : undefined;
  return {
    severity: "info",
    code: "mock-no-example",
    pointer,
    message: "No example",
    chain,
  };
}
