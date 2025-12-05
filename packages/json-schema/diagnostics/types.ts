/**
 * Diagnostic Types - Core types for the Steady diagnostic system
 *
 * These types provide a unified structure for both static analysis
 * (at startup) and runtime validation (per request).
 */

/**
 * All diagnostic codes, organized by phase
 */
export type DiagnosticCode =
  // === STATIC (Startup) - Reference issues ===
  | "ref-unresolved"
  | "ref-cycle"
  | "ref-deep-chain"
  // === STATIC (Startup) - Schema quality ===
  | "schema-ref-siblings"
  | "schema-complexity"
  | "schema-nesting"
  // === STATIC (Startup) - Mock readiness ===
  | "mock-no-example"
  | "mock-no-schema"
  // === RUNTIME (Request) - Path matching ===
  | "request-path-not-found"
  | "request-method-not-allowed"
  // === RUNTIME (Request) - Parameter validation ===
  | "request-missing-param"
  | "request-invalid-param"
  | "request-invalid-header"
  // === RUNTIME (Request) - Body validation ===
  | "request-invalid-body"
  | "request-wrong-content-type"
  | "request-body-too-large"
  // === RUNTIME (Response) ===
  | "response-generation-failed"
  | "response-no-schema"
  | "response-circular-ref";

/**
 * Severity levels following LSP conventions
 */
export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

/**
 * Attribution type - who is responsible for the issue?
 */
export type AttributionType = "spec-issue" | "sdk-issue" | "ambiguous";

/**
 * Attribution with confidence and reasoning
 */
export interface Attribution {
  /** Who is responsible for this issue */
  type: AttributionType;
  /** Confidence in attribution (0.0 - 1.0) */
  confidence: number;
  /** Human-readable explanation */
  reasoning: string;
}

/**
 * Phase when the diagnostic was generated
 */
export type DiagnosticPhase = "startup" | "request" | "response";

/**
 * Runtime context - only present for runtime diagnostics
 */
export interface DiagnosticContext {
  /** When was this diagnostic generated */
  phase: DiagnosticPhase;

  /** Request context (when phase is "request" or "response") */
  request?: {
    method: string;
    path: string;
    operationId?: string;
  };

  /** The actual value that caused the issue */
  actualValue?: unknown;

  /** What was expected */
  expectedValue?: unknown;
}

/**
 * A related diagnostic location
 */
export interface RelatedDiagnostic {
  /** JSON Pointer to the related location */
  pointer: string;
  /** Description of the relationship */
  message: string;
}

/**
 * Universal diagnostic type - works for both static and runtime issues
 */
export interface Diagnostic {
  // === Identification ===
  /** Diagnostic code identifying the type of issue */
  code: DiagnosticCode;
  /** Severity level */
  severity: DiagnosticSeverity;

  // === Location ===
  /** JSON Pointer to the issue location in the spec */
  pointer: string;

  // === Context ===
  /** Runtime context (only present for runtime diagnostics) */
  context?: DiagnosticContext;

  // === Description ===
  /** Human-readable message describing the issue */
  message: string;

  // === Attribution ===
  /** Who is responsible and why */
  attribution: Attribution;

  // === Actionability ===
  /** What to do about it */
  suggestion?: string;
  /** Link to relevant documentation */
  documentation?: string;

  // === Related ===
  /** Related locations or issues */
  related?: RelatedDiagnostic[];
}

/**
 * Summary of diagnostics by category
 */
export interface DiagnosticSummary {
  /** Total number of diagnostics */
  total: number;
  /** Count by severity */
  bySeverity: Record<DiagnosticSeverity, number>;
  /** Count by attribution type */
  byAttribution: Record<AttributionType, number>;
  /** Count by code */
  byCode: Partial<Record<DiagnosticCode, number>>;
}

/**
 * Create a diagnostic summary from a list of diagnostics
 */
export function summarizeDiagnostics(
  diagnostics: Diagnostic[],
): DiagnosticSummary {
  const summary: DiagnosticSummary = {
    total: diagnostics.length,
    bySeverity: { error: 0, warning: 0, info: 0, hint: 0 },
    byAttribution: { "spec-issue": 0, "sdk-issue": 0, ambiguous: 0 },
    byCode: {},
  };

  for (const d of diagnostics) {
    summary.bySeverity[d.severity]++;
    summary.byAttribution[d.attribution.type]++;
    summary.byCode[d.code] = (summary.byCode[d.code] ?? 0) + 1;
  }

  return summary;
}

/**
 * Filter diagnostics by severity threshold
 */
export function filterBySeverity(
  diagnostics: Diagnostic[],
  minSeverity: DiagnosticSeverity,
): Diagnostic[] {
  const severityOrder: DiagnosticSeverity[] = [
    "error",
    "warning",
    "info",
    "hint",
  ];
  const minIndex = severityOrder.indexOf(minSeverity);

  return diagnostics.filter((d) => {
    const index = severityOrder.indexOf(d.severity);
    return index <= minIndex;
  });
}

/**
 * Group diagnostics by code for aggregated display
 */
export function groupByCode(
  diagnostics: Diagnostic[],
): Map<DiagnosticCode, Diagnostic[]> {
  const groups = new Map<DiagnosticCode, Diagnostic[]>();

  for (const d of diagnostics) {
    const group = groups.get(d.code);
    if (group) {
      group.push(d);
    } else {
      groups.set(d.code, [d]);
    }
  }

  return groups;
}
