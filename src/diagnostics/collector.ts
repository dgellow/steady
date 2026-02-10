/**
 * DiagnosticCollector - Collects diagnostics across a session
 *
 * Aggregates both static (startup) and runtime (per-request) diagnostics
 * to provide session-level insights.
 */

import type { Diagnostic } from "../diagnostic.ts";

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
   * Get top issues grouped by code
   */
  getTopIssues(
    limit = 10,
  ): Array<{ code: string; count: number; example: Diagnostic }> {
    const grouped = new Map<string, Diagnostic[]>();
    for (const d of this.runtimeDiagnostics) {
      const existing = grouped.get(d.code);
      if (existing) {
        existing.push(d);
      } else {
        grouped.set(d.code, [d]);
      }
    }

    const entries: Array<{ code: string; count: number; example: Diagnostic }> =
      [];
    for (const [code, diagnostics] of grouped) {
      const first = diagnostics[0];
      if (first) {
        entries.push({ code, count: diagnostics.length, example: first });
      }
    }

    entries.sort((a, b) => b.count - a.count);
    return entries.slice(0, limit);
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
