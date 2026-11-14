/**
 * E-code registry. Source of truth for diagnostic code definitions.
 *
 * Each E-code has a default category and severity. The interpreter may override
 * the category based on context (e.g., E3009 re-attributed to spec-issue when
 * caused by allOf + additionalProperties pitfall).
 *
 * Code ranges:
 *   E1xxx: Spec issues (problems with the OpenAPI spec itself)
 *   E2xxx: Routing (request doesn't match any operation)
 *   E3xxx: Transport/structural (SDK's responsibility)
 *   E4xxx: Content (value validation, not SDK's fault)
 *   E5xxx: Ambiguous (can't determine responsibility)
 */

import type { IssueCategory, Severity } from "../diagnostic.ts";

export interface ECodeDefinition {
  title: string;
  severity: Severity;
  /** Default category. Engine may override based on context. */
  category: IssueCategory;
  /** If true, Steady cannot serve this spec at all. */
  fatal?: boolean;
  /** When this code can be detected. */
  context?: "startup" | "runtime" | "both";
}

/** Union of all known E-code strings. */
export type ECode =
  // E1xxx: Spec issues
  | "E1001"
  | "E1002"
  | "E1003"
  | "E1004"
  | "E1005"
  | "E1006"
  | "E1007"
  | "E1008"
  | "E1009"
  | "E1010"
  | "E1011"
  | "E1012"
  | "E1013"
  | "E1014"
  | "E1015"
  | "E1016"
  | "E1017"
  | "E1018"
  | "E1019"
  | "E1020"
  | "E1021"
  | "E1022"
  | "E1023"
  // E2xxx: Routing
  | "E2001"
  | "E2002"
  // E3xxx: Transport / Structural
  | "E3001"
  | "E3002"
  | "E3003"
  | "E3004"
  | "E3005"
  | "E3006"
  | "E3007"
  | "E3008"
  | "E3009"
  | "E3010"
  | "E3011"
  | "E3012"
  | "E3013"
  | "E3014"
  | "E3015"
  | "E3016"
  | "E3017"
  | "E3018"
  | "E3019"
  | "E3020"
  | "E3021"
  | "E3022"
  | "E3023"
  // E4xxx: Content
  | "E4001"
  | "E4002"
  | "E4003"
  | "E4004"
  | "E4005"
  | "E4007"
  // E5xxx: Ambiguous
  | "E5001"
  | "E5003";

const CODES: Record<ECode, ECodeDefinition> = {
  // ── E1xxx: Spec Issues ──────────────────────────────────────────────
  E1001: {
    title: "Invalid syntax",
    severity: "error",
    category: "spec-issue",
    fatal: true,
    context: "startup",
  },
  E1002: {
    title: "Unsupported OpenAPI version",
    severity: "error",
    category: "spec-issue",
    fatal: true,
    context: "startup",
  },
  E1003: {
    title: "Missing required spec field",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1004: {
    title: "Unresolved reference",
    severity: "error",
    category: "spec-issue",
    fatal: true,
    context: "both",
  },
  E1005: {
    title: "Forced circular reference",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1006: {
    title: "Invalid schema definition",
    severity: "error",
    category: "spec-issue",
    fatal: true,
    context: "startup",
  },
  E1007: {
    title: "Keywords alongside $ref ignored",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1008: {
    title: "Duplicate path patterns",
    severity: "warning",
    category: "spec-issue",
    context: "both",
  },
  E1009: {
    title: "Duplicate path parameter name",
    severity: "warning",
    category: "spec-issue",
    context: "both",
  },
  E1010: {
    title: "Missing responses object",
    severity: "warning",
    category: "spec-issue",
    context: "both",
  },
  E1011: {
    title: "Invalid component name",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1012: {
    title: "Impossible schema constraint",
    severity: "error",
    category: "spec-issue",
    context: "both",
  },
  E1013: {
    title: "Multiple question marks in path",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1014: {
    title: "Question mark in parameter name",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1015: {
    title: "Non-standard usage",
    severity: "info",
    category: "spec-issue",
    context: "startup",
  },
  E1016: {
    title: "Required property not in properties",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1017: {
    title: "Redirect without Location header",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1018: {
    title: "Null-body status with response content",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1019: {
    title: "No success response defined",
    severity: "error",
    category: "spec-issue",
    context: "startup",
  },
  E1020: {
    title: "Request body on GET/HEAD/DELETE/OPTIONS",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1021: {
    title: "URI fragment in path",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1022: {
    title: "Invalid content type key",
    severity: "error",
    category: "spec-issue",
    context: "startup",
  },
  E1023: {
    title: "Value of the wrong type ignored",
    severity: "error",
    category: "spec-issue",
    context: "startup",
  },

  // ── E2xxx: Routing ──────────────────────────────────────────────────
  E2001: {
    title: "Path not found",
    severity: "error",
    category: "sdk-issue",
    context: "runtime",
  },
  E2002: {
    title: "Method not allowed",
    severity: "error",
    category: "sdk-issue",
    context: "runtime",
  },

  // ── E3xxx: Transport / Structural ───────────────────────────────────
  E3001: {
    title: "Path parameter type mismatch",
    severity: "error",
    category: "sdk-issue",
  },
  E3002: {
    title: "Missing required query parameter",
    severity: "error",
    category: "sdk-issue",
  },
  E3003: {
    title: "Query parameter type mismatch",
    severity: "error",
    category: "sdk-issue",
  },
  E3004: {
    title: "Missing required header",
    severity: "error",
    category: "sdk-issue",
  },
  E3005: {
    title: "Missing request body",
    severity: "error",
    category: "sdk-issue",
  },
  E3006: {
    title: "Wrong Content-Type",
    severity: "error",
    category: "sdk-issue",
  },
  E3007: {
    title: "Missing required field",
    severity: "error",
    category: "sdk-issue",
  },
  E3008: {
    title: "Field type mismatch",
    severity: "error",
    category: "sdk-issue",
  },
  E3009: {
    title: "Additional property not allowed",
    severity: "error",
    category: "sdk-issue",
  },
  E3010: {
    title: "Invalid array item type",
    severity: "error",
    category: "sdk-issue",
  },
  E3011: {
    title: "Invalid discriminator value",
    severity: "error",
    category: "sdk-issue",
  },
  E3012: {
    title: "Schema composition mismatch",
    severity: "warning",
    category: "ambiguous",
  },
  E3013: {
    title: "Required field in optional parent",
    severity: "warning",
    category: "ambiguous",
    context: "runtime",
  },
  E3014: {
    title: "Parameter serialization mismatch",
    severity: "warning",
    category: "sdk-issue",
    context: "runtime",
  },
  E3015: {
    title: "Undocumented query parameter",
    severity: "info",
    category: "ambiguous",
    context: "runtime",
  },
  E3016: {
    title: "Invalid enum value",
    severity: "error",
    category: "sdk-issue",
  },
  E3017: {
    title: "Const value mismatch",
    severity: "error",
    category: "sdk-issue",
  },
  E3018: {
    title: "Encoding format mismatch",
    severity: "error",
    category: "sdk-issue",
  },
  E3019: {
    title: "Invalid Content-Length",
    severity: "error",
    category: "sdk-issue",
    context: "runtime",
  },
  E3020: {
    title: "Malformed Content-Type",
    severity: "error",
    category: "sdk-issue",
    context: "runtime",
  },
  E3021: {
    title: "Malformed request body",
    severity: "error",
    category: "sdk-issue",
    context: "runtime",
  },
  E3022: {
    title: "Malformed Accept header",
    severity: "warning",
    category: "sdk-issue",
    context: "runtime",
  },
  E3023: {
    title: "Form field format mismatch",
    severity: "warning",
    category: "sdk-issue",
    context: "runtime",
  },

  // ── E4xxx: Content ──────────────────────────────────────────────────
  E4001: {
    title: "Value-validation format mismatch",
    severity: "info",
    category: "content-note",
  },
  E4002: {
    title: "Pattern mismatch",
    severity: "info",
    category: "content-note",
  },
  E4003: {
    title: "String length violation",
    severity: "info",
    category: "content-note",
  },
  E4004: {
    title: "Numeric range violation",
    severity: "info",
    category: "content-note",
  },
  E4005: {
    title: "Array size violation",
    severity: "info",
    category: "content-note",
  },
  E4007: {
    title: "Multiple-of violation",
    severity: "info",
    category: "content-note",
  },

  // ── E5xxx: Ambiguous ────────────────────────────────────────────────
  E5001: {
    title: "Null for non-nullable field",
    severity: "warning",
    category: "ambiguous",
  },
  E5003: {
    title: "Additional properties (spec silent)",
    severity: "warning",
    category: "ambiguous",
  },
};

/**
 * Look up an E-code definition. Only accepts known codes, enforced at compile time.
 */
export function getCode(code: ECode): ECodeDefinition {
  return CODES[code];
}

/**
 * Check if a string is a known E-code.
 */
export function hasCode(code: string): code is ECode {
  return code in CODES;
}

/**
 * Get all registered codes. Returns a shallow copy.
 */
export function allCodes(): Record<ECode, ECodeDefinition> {
  return { ...CODES };
}
