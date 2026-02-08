/**
 * Core diagnostic types for Steady's diagnostics system.
 *
 * A Diagnostic is the unit of output — it tells the developer what happened,
 * where, whose responsibility it is, and what to do about it.
 */

/** Who is responsible for the issue. */
export type IssueCategory =
  | "sdk-issue"
  | "content-note"
  | "spec-issue"
  | "ambiguous";

/** How severe the issue is. */
export type Severity = "error" | "warning" | "info";

/** Where the validation error occurred. */
export type DiagnosticLocation =
  | "path"
  | "query"
  | "header"
  | "cookie"
  | "body";

/**
 * A single diagnostic produced by the diagnostics engine.
 *
 * The E-code tells test frameworks WHAT happened, the category tells them
 * WHO's responsible, and the reasoning tells developers WHY.
 */
export interface Diagnostic {
  /** E-code (e.g., "E3007"). */
  code: string;

  severity: Severity;

  /** Attribution category — whose responsibility this issue is. */
  category: IssueCategory;

  /** Where in the request this issue was found (e.g., "body.email"). */
  requestPath: string;

  /** JSON pointer into the OpenAPI spec (e.g., "#/components/schemas/User/..."). */
  specPointer: string;

  /** Human-readable description. */
  message: string;

  /** What the spec expected (when applicable). */
  expected?: unknown;

  /** What the request actually contained (when applicable). */
  actual?: unknown;

  /** Attribution reasoning chain. */
  attribution: {
    /** 0.0-1.0 confidence in the attribution. */
    confidence: number;
    /** Chain of reasoning explaining the attribution. */
    reasoning: string[];
  };

  /** Actionable suggestion for fixing the issue. */
  suggestion?: string;
}
