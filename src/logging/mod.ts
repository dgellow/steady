/**
 * Logging Module - Exports all logging utilities
 */

// Logger interface and base class
export { BaseLogger } from "./logger.ts";
export type { Logger, LoggerOptions, LogLevel } from "./logger.ts";

// Logger implementations
export { TextLogger } from "./text-logger.ts";
export { JsonLogger } from "./json-logger.ts";
export { TuiLogger } from "./tui-logger.ts";

// Types
export type { RequestEvent, ShutdownEvent, StartupEvent } from "./types.ts";

// Formatting utilities
export { formatActual, formatExpected } from "./format-expected.ts";
export {
  formatDiagnostic,
  formatDiagnostics,
  formatDiagnosticSummary,
  formatExplainHint,
  formatStartupDiagnostics,
} from "./format-diagnostic.ts";

// Colors
export {
  attributionColor,
  attributionLabel,
  colorize,
  colors,
  formatStatus,
  statusColor,
} from "./colors.ts";

/**
 * Log a warning message with [Steady] prefix
 */
export function warn(message: string): void {
  const YELLOW = "\x1b[33m";
  const RESET = "\x1b[0m";
  console.warn(`${YELLOW}[Steady] Warning: ${message}${RESET}`);
}
