/**
 * DiagnosticCollector - Collects diagnostics across a session
 *
 * Aggregates both static (startup) and runtime (per-request) diagnostics
 * to provide session-level insights.
 */

import type { Diagnostic, DiagnosticSummary } from "@steady/json-schema";
import { groupByCode, summarizeDiagnostics } from "@steady/json-schema";

/**
 * Session statistics
 */
export interface SessionStats {
  /** Total requests handled */
  requestCount: number;
  /** Successful requests (no validation errors) */
  successCount: number;
  /** Failed requests (validation errors) */
  failedCount: number;
  /** Start time of session */
  startTime: Date;
  /** Duration in milliseconds (set on getStats) */
  durationMs?: number;
}

/**
 * Complete session summary
 */
export interface SessionSummary {
  stats: SessionStats;
  staticDiagnostics: DiagnosticSummary;
  runtimeDiagnostics: DiagnosticSummary;
  topIssues: Array<{
    code: string;
    count: number;
    example: Diagnostic;
  }>;
}

/**
 * Collects diagnostics across a session
 */
export class DiagnosticCollector {
  private staticDiagnostics: Diagnostic[] = [];
  private runtimeDiagnostics: Diagnostic[] = [];
  private stats: SessionStats;

  constructor() {
    this.stats = {
      requestCount: 0,
      successCount: 0,
      failedCount: 0,
      startTime: new Date(),
    };
  }

  /**
   * Set static diagnostics (called at startup)
   */
  setStaticDiagnostics(diagnostics: Diagnostic[]): void {
    this.staticDiagnostics = diagnostics;
  }

  /**
   * Get static diagnostics
   */
  getStaticDiagnostics(): Diagnostic[] {
    return this.staticDiagnostics;
  }

  /**
   * Add runtime diagnostics (called per request)
   */
  addRuntimeDiagnostics(diagnostics: Diagnostic[], success: boolean): void {
    this.runtimeDiagnostics.push(...diagnostics);
    this.stats.requestCount++;
    if (success) {
      this.stats.successCount++;
    } else {
      this.stats.failedCount++;
    }
  }

  /**
   * Get all runtime diagnostics
   */
  getRuntimeDiagnostics(): Diagnostic[] {
    return this.runtimeDiagnostics;
  }

  /**
   * Get current stats
   */
  getStats(): SessionStats {
    return {
      ...this.stats,
      durationMs: Date.now() - this.stats.startTime.getTime(),
    };
  }

  /**
   * Get complete session summary
   */
  getSummary(): SessionSummary {
    const grouped = groupByCode(this.runtimeDiagnostics);
    const topIssues = Array.from(grouped.entries())
      .map(([code, diagnostics]) => ({
        code,
        count: diagnostics.length,
        example: diagnostics[0]!,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      stats: this.getStats(),
      staticDiagnostics: summarizeDiagnostics(this.staticDiagnostics),
      runtimeDiagnostics: summarizeDiagnostics(this.runtimeDiagnostics),
      topIssues,
    };
  }

  /**
   * Reset runtime diagnostics (useful for testing)
   */
  resetRuntime(): void {
    this.runtimeDiagnostics = [];
    this.stats = {
      requestCount: 0,
      successCount: 0,
      failedCount: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get count of static errors
   */
  getStaticErrorCount(): number {
    return this.staticDiagnostics.filter((d) => d.severity === "error").length;
  }

  /**
   * Get count of static warnings
   */
  getStaticWarningCount(): number {
    return this.staticDiagnostics.filter((d) => d.severity === "warning")
      .length;
  }

  /**
   * Check if there are any static errors
   */
  hasStaticErrors(): boolean {
    return this.getStaticErrorCount() > 0;
  }
}

/**
 * Global collector instance for the server
 */
let globalCollector: DiagnosticCollector | null = null;

/**
 * Get or create the global collector
 */
export function getCollector(): DiagnosticCollector {
  if (!globalCollector) {
    globalCollector = new DiagnosticCollector();
  }
  return globalCollector;
}

/**
 * Reset the global collector (useful for testing)
 */
export function resetCollector(): void {
  globalCollector = null;
}
