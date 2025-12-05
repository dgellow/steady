/**
 * Attribution - Rules and logic for determining issue responsibility
 *
 * This is Steady's key differentiator - helping developers instantly
 * know if an issue is in their SDK or in the OpenAPI spec.
 */

import type { Attribution, AttributionType, DiagnosticCode } from "./types.ts";

/**
 * Default attribution rules for each diagnostic code
 */
interface AttributionRule {
  type: AttributionType;
  confidence: number;
  reasoning: string;
}

const ATTRIBUTION_RULES: Record<DiagnosticCode, AttributionRule> = {
  // === STATIC - Reference issues (always spec issues) ===
  "ref-unresolved": {
    type: "spec-issue",
    confidence: 1.0,
    reasoning: "The $ref points to a path that doesn't exist in the spec",
  },
  "ref-cycle": {
    type: "spec-issue",
    confidence: 0.9,
    reasoning:
      "Circular reference detected - handled gracefully but indicates spec complexity",
  },
  "ref-deep-chain": {
    type: "spec-issue",
    confidence: 0.6,
    reasoning: "Very deep reference chain may impact performance",
  },

  // === STATIC - Schema quality (always spec issues) ===
  "schema-ref-siblings": {
    type: "spec-issue",
    confidence: 1.0,
    reasoning: "Per JSON Schema 2020-12, keywords alongside $ref are ignored",
  },
  "schema-complexity": {
    type: "spec-issue",
    confidence: 0.7,
    reasoning: "Schema complexity is unusually high",
  },
  "schema-nesting": {
    type: "spec-issue",
    confidence: 0.6,
    reasoning: "Schema nesting is very deep",
  },

  // === STATIC - Mock readiness (spec issues) ===
  "mock-no-example": {
    type: "spec-issue",
    confidence: 0.5,
    reasoning: "No example provided - responses will use generated data",
  },
  "mock-no-schema": {
    type: "spec-issue",
    confidence: 0.9,
    reasoning: "No schema defined - cannot generate meaningful response",
  },

  // === RUNTIME - Path matching (ambiguous) ===
  "request-path-not-found": {
    type: "ambiguous",
    confidence: 0.6,
    reasoning: "Could be wrong URL in SDK or missing endpoint in spec",
  },
  "request-method-not-allowed": {
    type: "ambiguous",
    confidence: 0.7,
    reasoning: "Path exists but method doesn't - check SDK or spec",
  },

  // === RUNTIME - Parameter validation (usually SDK issues) ===
  "request-missing-param": {
    type: "sdk-issue",
    confidence: 0.9,
    reasoning: "Required parameter missing - SDK should include it",
  },
  "request-invalid-param": {
    type: "sdk-issue",
    confidence: 0.85,
    reasoning: "Parameter value doesn't match schema - likely SDK bug",
  },
  "request-invalid-header": {
    type: "sdk-issue",
    confidence: 0.85,
    reasoning: "Header value doesn't match expected format",
  },

  // === RUNTIME - Body validation (usually SDK issues) ===
  "request-invalid-body": {
    type: "sdk-issue",
    confidence: 0.8,
    reasoning:
      "Request body doesn't match schema - likely SDK serialization bug",
  },
  "request-wrong-content-type": {
    type: "sdk-issue",
    confidence: 0.9,
    reasoning: "Wrong Content-Type header - SDK should set correct type",
  },
  "request-body-too-large": {
    type: "sdk-issue",
    confidence: 0.7,
    reasoning: "Request body exceeds size limit",
  },

  // === RUNTIME - Response issues (usually spec issues) ===
  "response-generation-failed": {
    type: "spec-issue",
    confidence: 0.8,
    reasoning: "Could not generate response from schema",
  },
  "response-no-schema": {
    type: "spec-issue",
    confidence: 1.0,
    reasoning: "Spec doesn't define response schema",
  },
  "response-circular-ref": {
    type: "spec-issue",
    confidence: 0.9,
    reasoning: "Circular reference encountered during response generation",
  },
};

/**
 * Get default attribution for a diagnostic code
 */
export function getAttribution(code: DiagnosticCode): Attribution {
  const rule = ATTRIBUTION_RULES[code];
  return {
    type: rule.type,
    confidence: rule.confidence,
    reasoning: rule.reasoning,
  };
}

/**
 * Create a custom attribution
 */
export function createAttribution(
  type: AttributionType,
  confidence: number,
  reasoning: string,
): Attribution {
  return { type, confidence, reasoning };
}

/**
 * Adjust attribution confidence based on context
 */
export function adjustConfidence(
  attribution: Attribution,
  adjustment: number,
): Attribution {
  return {
    ...attribution,
    confidence: Math.max(0, Math.min(1, attribution.confidence + adjustment)),
  };
}

/**
 * Get a human-readable label for attribution type
 */
export function getAttributionLabel(type: AttributionType): string {
  switch (type) {
    case "spec-issue":
      return "Spec Issue";
    case "sdk-issue":
      return "SDK Issue";
    case "ambiguous":
      return "Unknown";
  }
}

/**
 * Get severity suggestion based on attribution
 */
export function suggestSeverity(
  code: DiagnosticCode,
): "error" | "warning" | "info" | "hint" {
  const rule = ATTRIBUTION_RULES[code];

  // High confidence issues are more severe
  if (rule.confidence >= 0.9) {
    if (rule.type === "sdk-issue") return "error";
    if (rule.type === "spec-issue") return "warning";
  }

  if (rule.confidence >= 0.7) {
    return "warning";
  }

  return "info";
}
