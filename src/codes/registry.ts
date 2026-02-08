/**
 * E-code registry — source of truth for diagnostic code definitions.
 *
 * Each E-code has a default category and severity. The interpreter may override
 * the category based on context (e.g., E3009 re-attributed to spec-issue when
 * caused by allOf + additionalProperties pitfall).
 *
 * Code ranges:
 *   E1xxx — Spec issues (problems with the OpenAPI spec itself)
 *   E2xxx — Routing (request doesn't match any operation)
 *   E3xxx — Transport/structural (SDK's responsibility)
 *   E4xxx — Content (value validation, not SDK's fault)
 *   E5xxx — Ambiguous (can't determine responsibility)
 */

import type { IssueCategory, Severity } from "../diagnostic.ts";

export interface ECodeDefinition {
  title: string;
  severity: Severity;
  /** Default category — engine may override based on context. */
  category: IssueCategory;
  /** If true, Steady cannot serve this spec at all. */
  fatal?: boolean;
  /** When this code can be detected. */
  context?: "startup" | "runtime" | "both";
}

const CODES = {
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
    title: "Unresolvable $ref",
    severity: "error",
    category: "spec-issue",
    fatal: true,
    context: "startup",
  },
  E1004: {
    title: "Circular $ref without base case",
    severity: "warning",
    category: "spec-issue",
    context: "startup",
  },
  E1010: {
    title: "Missing responses object",
    severity: "warning",
    category: "spec-issue",
    context: "runtime",
  },
  E1011: {
    title: "Empty schema",
    severity: "warning",
    category: "spec-issue",
    context: "runtime",
  },
  E1012: {
    title: "Impossible schema constraint",
    severity: "error",
    category: "spec-issue",
    context: "both",
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
    title: "Header type mismatch",
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
} satisfies Record<string, ECodeDefinition>;

/** Union of all known E-code strings. */
export type ECode = keyof typeof CODES;

/**
 * Look up an E-code definition. Only accepts known codes — enforced at compile time.
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
