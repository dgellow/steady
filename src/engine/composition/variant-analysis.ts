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
 * Uses `structuralFailureCount` from InterpretResult, NOT the diagnostic's
 * category. Structural classification and attribution are independent:
 * E5001 has category "ambiguous" but keyword "type" which IS structural.
 */

import { isPlainObject } from "@steady/json-pointer";
import type { Schema } from "@steady/json-schema";
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
 * 0. Nullable wrapper pattern: when the composition is `[X, null]` and the
 *    request data is non-null, the SDK clearly didn't intend null. Drop the
 *    null branch before running heuristics.
 * 0b. JSON type: when some variants accept the type of the value and
 *    others do not, drop the ones that do not.
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

  // Single variant. It's the only possibility
  const single = childResults[0];
  if (childResults.length === 1 && single) {
    return {
      diagnostics: single.diagnostics,
      structurallyValid: false,
      structuralFailureCount: single.structuralFailureCount,
    };
  }

  const allVariantDetails: VariantDetail[] = childResults.map(
    (result, index) => ({
      index,
      result,
    }),
  );

  // Step 0: Nullable wrapper pattern. Drop branches whose type is exclusively
  // null when the request data is non-null. The standard nullable encoding
  // `anyOf: [X, {type: "null"}]` exists to make X nullable; if the SDK sent
  // a value, it was clearly trying X. The null branch can only ever fail
  // for non-null data and so contributes no signal to variant identification.
  // Removing it lets failures be attributed to the real branch directly.
  const variantDetails = context.data === null
    ? allVariantDetails
    : filterNullOnlyVariants(allVariantDetails, context.schema);

  // If we filtered out null branches and exactly one variant remains, the
  // SDK's intent is unambiguous: attribute directly with confidence 1.0.
  if (
    variantDetails.length === 1 &&
    variantDetails.length < allVariantDetails.length
  ) {
    const detail = variantDetails[0];
    if (detail) {
      return identifiedVariant(detail, 1.0, "only non-null variant");
    }
  }

  // Step 0b: JSON type. An array sent where the variants are "array of
  // integers" and "integer" was meant as the array. The integer variant
  // fails as well, but on the type of the value itself, and that failure
  // carries no information about what is wrong inside the array. Counting
  // it as one failure against the one failure inside the array would make
  // the two variants look equally close.
  const accepting = variantDetails.filter((v) => v.result.wrongType !== true);
  const candidates = accepting.length > 0 ? accepting : variantDetails;
  if (candidates.length === 1 && variantDetails.length > 1) {
    const detail = candidates[0];
    if (detail) {
      return identifiedVariant(
        detail,
        1.0,
        "only variant that accepts the type of the value",
      );
    }
  }

  // Step 1: Property overlap. Compare request keys against variant properties
  const overlapResult = identifyByPropertyOverlap(candidates, context);
  if (overlapResult) return overlapResult;

  // Step 2: Structural failure count. Fewer failures = more likely intended
  const failureCountResult = identifyByFailureCount(candidates);
  if (failureCountResult) return failureCountResult;

  // Step 3: No clear variant. Report E3012
  return reportAmbiguous(candidates, context);
}

/**
 * Drop variants whose `type` is exclusively `"null"`. Other keywords on
 * those variants can only narrow them further; they can never make them
 * match non-null data. So for the purposes of variant identification when
 * data is non-null, they always fail and provide no useful signal.
 */
function filterNullOnlyVariants(
  variantDetails: VariantDetail[],
  schema: Schema,
): VariantDetail[] {
  if (typeof schema === "boolean") return variantDetails;
  const variants = schema.oneOf ?? schema.anyOf;
  if (!Array.isArray(variants)) return variantDetails;

  return variantDetails.filter((detail) => {
    const variantSchema = variants[detail.index];
    return !isNullOnlyType(variantSchema);
  });
}

/** True if a schema's `type` is exclusively `"null"`. */
function isNullOnlyType(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as Record<string, unknown>;
  if ("$ref" in s) return false;
  return s.type === "null" ||
    (Array.isArray(s.type) && s.type.length === 1 && s.type[0] === "null");
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

  const variants = context.schema.oneOf ?? context.schema.anyOf;
  if (!Array.isArray(variants)) return null;

  const requestKeys = Object.keys(context.data);
  if (requestKeys.length === 0) return null;

  // Calculate overlap score for each variant
  const scores: { detail: VariantDetail; overlap: number }[] = [];
  for (const detail of variantDetails) {
    const variantSchema = variants[detail.index];
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
    requestPath: context.path.join("."),
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
