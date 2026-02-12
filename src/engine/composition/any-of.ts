/**
 * anyOf composition logic.
 *
 * anyOf requires AT LEAST ONE child to match. Unlike oneOf, multiple
 * structural matches are fine. They all contribute diagnostics.
 *
 * Cases:
 * 1. One or more structural matches → success, merge their diagnostics
 * 2. Zero structural matches → same analysis as oneOf's zero-match case
 */

import type { CompositionContext, InterpretResult } from "../types.ts";
import { analyzeAllFailed } from "./variant-analysis.ts";

/**
 * Attribute an anyOf composition node.
 */
export function attributeAnyOf(
  childResults: InterpretResult[],
  context: CompositionContext,
): InterpretResult {
  const structuralMatches = childResults.filter((c) => c.structurallyValid);

  // 1. One or more structural matches → success
  if (structuralMatches.length >= 1) {
    return {
      diagnostics: structuralMatches.flatMap((c) => c.diagnostics),
      structurallyValid: true,
      structuralFailureCount: 0,
    };
  }

  // 2. Zero structural matches → same analysis as oneOf
  return analyzeAllFailed(childResults, context);
}
