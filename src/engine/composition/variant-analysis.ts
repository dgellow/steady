/**
 * Shared variant analysis for oneOf and anyOf zero-match cases.
 *
 * When no variant structurally matches, tries to identify which variant
 * the request was intended for.
 *
 * Uses `structuralFailureCount` from InterpretResult — NOT the diagnostic's
 * category. Structural classification and attribution are independent:
 * E5001 has category "ambiguous" but keyword "type" which IS structural.
 *
 * TODO: Property overlap analysis (step 1 in the plan) should compare
 * keys in context.data against each variant's schema properties.
 */

import type { Diagnostic } from "../../diagnostic.ts";
import type { CompositionContext, InterpretResult } from "../types.ts";
import { getCode } from "../../codes/registry.ts";

/**
 * Analyze a zero-structural-match composition failure.
 *
 * Tries to identify the most likely intended variant using structural
 * failure count. Returns the identified variant's diagnostics with
 * adjusted confidence, or E3012 if no clear winner.
 */
export function analyzeAllFailed(
  childResults: InterpretResult[],
  context: CompositionContext,
): InterpretResult {
  if (childResults.length === 0) {
    return {
      diagnostics: [],
      structurallyValid: false,
      structuralFailureCount: 0,
    };
  }

  // Single variant — it's the only possibility
  const single = childResults[0];
  if (childResults.length === 1 && single) {
    return {
      diagnostics: single.diagnostics,
      structurallyValid: false,
      structuralFailureCount: single.structuralFailureCount,
    };
  }

  const variantDetails = childResults.map((result, index) => ({
    index,
    result,
  }));

  // Sort by structural failure count ascending — fewest first
  variantDetails.sort(
    (a, b) => a.result.structuralFailureCount - b.result.structuralFailureCount,
  );

  const best = variantDetails[0];
  const secondBest = variantDetails[1];

  // Both guaranteed to exist — we returned early for length 0 and 1 above
  if (!best || !secondBest) {
    return {
      diagnostics: [],
      structurallyValid: false,
      structuralFailureCount: 0,
    };
  }

  // If one variant has strictly fewer structural failures, it's likely intended
  if (
    best.result.structuralFailureCount <
      secondBest.result.structuralFailureCount
  ) {
    return {
      diagnostics: best.result.diagnostics.map((d) => ({
        ...d,
        attribution: {
          confidence: 0.7,
          reasoning: [
            `Likely variant ${best.index} (fewest structural failures)`,
            ...d.attribution.reasoning,
          ],
        },
      })),
      structurallyValid: false,
      structuralFailureCount: best.result.structuralFailureCount,
    };
  }

  // No clear variant — report E3012
  return reportAmbiguous(variantDetails, context);
}

function reportAmbiguous(
  variantDetails: { index: number; result: InterpretResult }[],
  context: CompositionContext,
): InterpretResult {
  const e3012 = getCode("E3012");

  const reasoning = variantDetails.map(
    (v) =>
      `Variant ${v.index}: ${v.result.structuralFailureCount} structural failure(s), ${v.result.diagnostics.length} total`,
  );

  const diagnostic: Diagnostic = {
    code: "E3012",
    severity: e3012.severity,
    category: e3012.category,
    requestPath: context.path,
    specPointer: context.schemaPath,
    message:
      `No variant matched: ${variantDetails.length} variants all failed structurally`,
    attribution: {
      confidence: 0.5,
      reasoning,
    },
  };

  return {
    diagnostics: [diagnostic],
    structurallyValid: false,
    structuralFailureCount: 0,
  };
}
