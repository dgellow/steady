// Shared utilities for Steady mock server

// Logging
export { RequestLogger } from "./logger.ts";
export { SimpleLogger } from "./simple-logger.ts";
export { InkSimpleLogger, startInkSimpleLogger } from "./ink-logger.tsx";

// Types
export type { LogLevel, LogValidationResult, StoredRequest } from "./types.ts";
// Re-export ValidationResult alias for backwards compatibility
export type { ValidationResult } from "./logger.ts";

// ANSI color codes
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * Log a warning message with [Steady] prefix
 */
export function warn(message: string): void {
  console.warn(`${YELLOW}[Steady] Warning: ${message}${RESET}`);
}
