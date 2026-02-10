/**
 * ANSI Color Constants - Single source of truth for terminal colors
 */

import type { IssueCategory } from "../diagnostic.ts";

export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",

  // Terminal control
  clearScreen: "\x1b[2J",
  cursorHome: "\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
} as const;

/**
 * Get color for HTTP status code
 */
export function statusColor(code: number): string {
  if (code >= 200 && code < 300) return colors.green;
  if (code >= 400 && code < 500) return colors.yellow;
  if (code >= 500) return colors.red;
  return colors.reset;
}

/**
 * Get color for issue category
 */
export function attributionColor(category: IssueCategory): string {
  switch (category) {
    case "sdk-issue":
      return colors.red;
    case "spec-issue":
      return colors.yellow;
    case "content-note":
      return colors.blue;
    case "ambiguous":
      return colors.gray;
  }
}

/**
 * Get human-readable label for issue category
 */
export function attributionLabel(category: IssueCategory): string {
  switch (category) {
    case "sdk-issue":
      return "SDK Issue";
    case "spec-issue":
      return "Spec Issue";
    case "content-note":
      return "Content Note";
    case "ambiguous":
      return "Unknown";
  }
}

/**
 * Get status text for HTTP status code
 */
export function getStatusText(code: number): string {
  const statusTexts: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return statusTexts[code] || "Unknown";
}

/**
 * Format a status code with color
 */
export function formatStatus(code: number, useColor = true): string {
  const text = `${code} ${getStatusText(code)}`;
  if (!useColor) return text;
  return `${statusColor(code)}${text}${colors.reset}`;
}

/**
 * Colorize helper - wraps text in color if enabled
 */
export function colorize(
  text: string,
  color: string,
  useColor = true,
): string {
  if (!useColor) return text;
  return `${color}${text}${colors.reset}`;
}
