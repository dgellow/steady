/**
 * Session store. Per-session diagnostic accumulation.
 *
 * Sessions are created implicitly when a request arrives with an
 * X-Steady-Session header. Diagnostics from each request are grouped
 * by category for the session report.
 *
 * In-memory only. Cleared on server shutdown.
 */

import type { Diagnostic, IssueCategory, Severity } from "../diagnostic.ts";

/** A diagnostic enriched with the HTTP context it came from. */
export interface SessionDiagnostic {
  code: string;
  severity: Severity;
  message: string;
  method: string;
  path: string;
  requestPath: string;
  specPointer: string;
  attribution: {
    category: IssueCategory;
    confidence: number;
    reasoning: string[];
  };
  suggestion?: string;
}

/** The report returned by GET /_x-steady/sessions/{id}. */
export interface SessionReport {
  sessionId: string;
  requests: number;
  result: "passed" | "failed";
  summary: { total: number; valid: number; invalid: number };
  coverage?: { total: number; tested: number; endpoints: string[] };
  sdkIssues: SessionDiagnostic[];
  contentNotes: SessionDiagnostic[];
  ambiguous: SessionDiagnostic[];
  specIssues: SessionDiagnostic[];
}

interface SessionData {
  requestCount: number;
  validCount: number;
  invalidCount: number;
  testedEndpoints: Set<string>;
  diagnostics: SessionDiagnostic[];
}

export class SessionStore {
  private sessions = new Map<string, SessionData>();
  private allEndpoints: string[] = [];

  /**
   * Set the full list of endpoints from the spec.
   * Called once at startup to enable coverage tracking.
   */
  setAllEndpoints(endpoints: string[]): void {
    this.allEndpoints = endpoints;
  }

  /**
   * Record a request's diagnostics in the given session.
   * Creates the session if it doesn't exist.
   */
  addRequest(
    sessionId: string,
    method: string,
    path: string,
    diagnostics: Diagnostic[],
    pathPattern?: string,
  ): void {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        requestCount: 0,
        validCount: 0,
        invalidCount: 0,
        testedEndpoints: new Set(),
        diagnostics: [],
      };
      this.sessions.set(sessionId, session);
    }

    session.requestCount++;

    const hasSdkIssue = diagnostics.some((d) => d.category === "sdk-issue");
    if (hasSdkIssue) {
      session.invalidCount++;
    } else {
      session.validCount++;
    }

    if (pathPattern) {
      session.testedEndpoints.add(
        `${method.toUpperCase()} ${pathPattern}`,
      );
    }

    for (const d of diagnostics) {
      session.diagnostics.push({
        code: d.code,
        severity: d.severity,
        message: d.message,
        method: method.toUpperCase(),
        path,
        requestPath: d.requestPath,
        specPointer: d.specPointer,
        attribution: {
          category: d.category,
          confidence: d.attribution.confidence,
          reasoning: d.attribution.reasoning,
        },
        suggestion: d.suggestion,
      });
    }
  }

  /**
   * Get the session report. Returns undefined if the session doesn't exist.
   */
  getSession(sessionId: string): SessionReport | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const sdkIssues: SessionDiagnostic[] = [];
    const contentNotes: SessionDiagnostic[] = [];
    const ambiguous: SessionDiagnostic[] = [];
    const specIssues: SessionDiagnostic[] = [];

    for (const d of session.diagnostics) {
      switch (d.attribution.category) {
        case "sdk-issue":
          sdkIssues.push(d);
          break;
        case "content-note":
          contentNotes.push(d);
          break;
        case "ambiguous":
          ambiguous.push(d);
          break;
        case "spec-issue":
          specIssues.push(d);
          break;
      }
    }

    const hasSdkIssues = sdkIssues.length > 0;
    const result: "passed" | "failed" = hasSdkIssues ? "failed" : "passed";

    const report: SessionReport = {
      sessionId,
      requests: session.requestCount,
      result,
      summary: {
        total: session.requestCount,
        valid: session.validCount,
        invalid: session.invalidCount,
      },
      sdkIssues,
      contentNotes,
      ambiguous,
      specIssues,
    };

    if (this.allEndpoints.length > 0) {
      const tested = [...session.testedEndpoints];
      report.coverage = {
        total: this.allEndpoints.length,
        tested: tested.length,
        endpoints: tested,
      };
    }

    return report;
  }
}
