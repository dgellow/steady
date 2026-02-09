/**
 * Shared variant analysis for oneOf and anyOf zero-match cases.
 *
 * When no variant structurally matches, tries to identify which variant
 * the request was intended for. Identification, not guessing.
 *
 * Steps (in order per plan):
 * 1. Property overlap: compare request keys against each variant's properties
 * 2. Structural failure count: fewer failures = more likely intended
 * 3. No clear variant → E3012
 *
 * Uses `structuralFailureCount` from InterpretResult — NOT the diagnostic's
 * category. Structural classification and attribution are independent:
 * E5001 has category "ambiguous" but keyword "type" which IS structural.
 */

import type { Diagnostic } from "../../diagnostic.ts";
import type { CompositionContext, InterpretResult } from "../types.ts";
import { getCode } from "../../codes/registry.ts";

interface VariantDetail {
  index: number;
  result: InterpretResult;
}

/**
 * Analyze a zero-structural-match composition failure.
 *
 * Tries to identify the most likely intended variant using:
 * 1. Property overlap (request keys vs variant schema properties)
 * 2. Structural failure count
 * Returns the identified variant's diagnostics with adjusted confidence,
 * or E3012 if no clear winner.
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

  const variantDetails: VariantDetail[] = childResults.map((result, index) => ({
    index,
    result,
  }));

  // Step 1: Property overlap — compare request keys against variant properties
  const overlapResult = identifyByPropertyOverlap(variantDetails, context);
  if (overlapResult) return overlapResult;

  // Step 2: Structural failure count — fewer failures = more likely intended
  const failureCountResult = identifyByFailureCount(variantDetails);
  if (failureCountResult) return failureCountResult;

  // Step 3: No clear variant — report E3012
  return reportAmbiguous(variantDetails, context);
}

/**
 * Step 1: Identify the intended variant by comparing request property names
 * against each variant's schema properties.
 *
 * Returns null if data isn't an object, schema lacks oneOf, or overlap
 * doesn't clearly distinguish one variant.
 */
function identifyByPropertyOverlap(
  variantDetails: VariantDetail[],
  context: CompositionContext,
): InterpretResult | null {
  if (!isPlainObject(context.data)) return null;

  const oneOfSchemas = context.schema.oneOf;
  if (!Array.isArray(oneOfSchemas)) return null;

  const requestKeys = Object.keys(context.data);
  if (requestKeys.length === 0) return null;

  // Calculate overlap score for each variant
  const scores: { detail: VariantDetail; overlap: number }[] = [];
  for (const detail of variantDetails) {
    const variantSchema = oneOfSchemas[detail.index];
    if (
      variantSchema === undefined ||
      typeof variantSchema === "boolean" ||
      !variantSchema.properties
    ) {
      scores.push({ detail, overlap: 0 });
      continue;
    }

    const variantKeys = new Set(Object.keys(variantSchema.properties));
    let overlap = 0;
    for (const key of requestKeys) {
      if (variantKeys.has(key)) overlap++;
    }
    scores.push({ detail, overlap });
  }

  // Sort by overlap descending
  scores.sort((a, b) => b.overlap - a.overlap);

  const best = scores[0];
  const secondBest = scores[1];
  if (!best || !secondBest) return null;

  // Only identify if one variant has strictly higher overlap
  if (best.overlap <= 0 || best.overlap <= secondBest.overlap) return null;

  // Confidence scales with how distinguishing the overlap is.
  // gap/requestKeys = what fraction of request keys are exclusive to the winner.
  // All keys exclusive → 0.9. One distinguishing key among many shared → ~0.55.
  const gap = best.overlap - secondBest.overlap;
  const confidence = 0.5 + 0.4 * (gap / requestKeys.length);

  return identifiedVariant(best.detail, confidence, "property overlap");
}

/**
 * Step 2: Identify the intended variant by structural failure count.
 * Fewer structural failures = more likely intended.
 */
function identifyByFailureCount(
  variantDetails: VariantDetail[],
): InterpretResult | null {
  const sorted = [...variantDetails].sort(
    (a, b) => a.result.structuralFailureCount - b.result.structuralFailureCount,
  );

  const best = sorted[0];
  const secondBest = sorted[1];
  if (!best || !secondBest) return null;

  const bestCount = best.result.structuralFailureCount;
  const secondBestCount = secondBest.result.structuralFailureCount;

  if (bestCount >= secondBestCount) return null;

  // Confidence scales with how clear the gap is.
  // gap/(gap+bestCount) captures both absolute gap and relative position.
  // 1 vs 10 → 9/10 = 0.9 → confidence 0.77
  // 1 vs 3 → 2/3 = 0.67 → confidence 0.7
  // 3 vs 4 → 1/4 = 0.25 → confidence 0.58
  const gap = secondBestCount - bestCount;
  const confidence = 0.5 + 0.3 * (gap / (gap + bestCount));

  return identifiedVariant(best, confidence, "fewest structural failures");
}

/**
 * Build the result for an identified variant: its diagnostics with
 * adjusted confidence and reasoning.
 */
function identifiedVariant(
  variant: VariantDetail,
  confidence: number,
  reason: string,
): InterpretResult {
  return {
    diagnostics: variant.result.diagnostics.map((d) => ({
      ...d,
      attribution: {
        confidence,
        reasoning: [
          `Likely variant ${variant.index} (${reason})`,
          ...d.attribution.reasoning,
        ],
      },
    })),
    structurallyValid: false,
    structuralFailureCount: variant.result.structuralFailureCount,
  };
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
