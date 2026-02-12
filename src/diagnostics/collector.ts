/**
 * DiagnosticCollector - Collects diagnostics across a session
 *
 * Aggregates both static (startup) and runtime (per-request) diagnostics
 * to provide session-level insights.
 */

import type { Diagnostic, IssueCategory } from "../diagnostic.ts";

/** A runtime diagnostic with request context. */
interface RuntimeEntry {
  diagnostic: Diagnostic;
  method: string;
  path: string;
}

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
  private runtimeEntries: RuntimeEntry[] = [];
  private testedEndpoints = new Set<string>();
  private allEndpoints: string[] = [];
  private generationWarnings: string[] = [];
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
  addRuntimeDiagnostics(
    diagnostics: Diagnostic[],
    method: string,
    path: string,
    success: boolean,
  ): void {
    for (const diagnostic of diagnostics) {
      this.runtimeEntries.push({ diagnostic, method, path });
    }
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
    return this.runtimeEntries.map((e) => e.diagnostic);
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
  ): Array<{
    code: string;
    count: number;
    example: Diagnostic;
    method: string;
    path: string;
  }> {
    const grouped = new Map<string, RuntimeEntry[]>();
    for (const entry of this.runtimeEntries) {
      const existing = grouped.get(entry.diagnostic.code);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(entry.diagnostic.code, [entry]);
      }
    }

    const entries: Array<{
      code: string;
      count: number;
      example: Diagnostic;
      method: string;
      path: string;
    }> = [];
    for (const [code, runtimeEntries] of grouped) {
      const first = runtimeEntries[0];
      if (first) {
        entries.push({
          code,
          count: runtimeEntries.length,
          example: first.diagnostic,
          method: first.method,
          path: first.path,
        });
      }
    }

    entries.sort((a, b) => b.count - a.count);
    return entries.slice(0, limit);
  }

  /**
   * Track a tested endpoint
   */
  trackEndpoint(method: string, pathPattern: string): void {
    this.testedEndpoints.add(`${method.toUpperCase()} ${pathPattern}`);
  }

  /**
   * Set the full list of endpoints from the spec (called at startup).
   */
  setAllEndpoints(endpoints: string[]): void {
    this.allEndpoints = endpoints;
  }

  /**
   * Get endpoint coverage including untested endpoint list.
   */
  getCoverage(): {
    tested: number;
    total: number;
    untestedEndpoints: string[];
  } {
    const untested = this.allEndpoints.filter(
      (e) => !this.testedEndpoints.has(e),
    );
    return {
      tested: this.testedEndpoints.size,
      total: this.allEndpoints.length,
      untestedEndpoints: untested,
    };
  }

  /**
   * Track an endpoint where the response generator produced a minimal response.
   */
  trackGenerationWarning(method: string, pathPattern: string): void {
    this.generationWarnings.push(`${method.toUpperCase()} ${pathPattern}`);
  }

  /**
   * Get list of endpoints with generation warnings.
   */
  getGenerationWarnings(): string[] {
    return [...this.generationWarnings];
  }

  /**
   * Get category breakdown of runtime diagnostics.
   * Returns counts per IssueCategory, only including non-zero categories.
   */
  getCategoryBreakdown(): Partial<Record<IssueCategory, number>> {
    const counts: Partial<Record<IssueCategory, number>> = {};
    for (const entry of this.runtimeEntries) {
      const cat = entry.diagnostic.category;
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Reset runtime diagnostics (useful for testing)
   */
  resetRuntime(): void {
    this.runtimeEntries = [];
    this.testedEndpoints.clear();
    this.generationWarnings = [];
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
