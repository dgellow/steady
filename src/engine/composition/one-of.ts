/**
 * oneOf composition logic.
 *
 * Uses structural match (not JSON Schema validity) to determine which variant
 * the request was intended for. This is the key improvement over standard
 * JSON Schema evaluation.
 *
 * Cases:
 * 1. Discriminator present → deterministic variant selection
 * 2. One structural match → variant identified, report its content diagnostics
 * 3. Zero structural matches → variant identification via analyzeAllFailed
 * 4. Multiple structural matches → ambiguous (E3012)
 */

import type { Diagnostic } from "../../diagnostic.ts";
import type { CompositionContext, InterpretResult } from "../types.ts";
import { getCode } from "../../codes/registry.ts";
import { analyzeAllFailed } from "./variant-analysis.ts";

/**
 * Attribute a oneOf composition node.
 *
 * @param childResults - Interpreted results from each oneOf variant
 * @param context - Composition context with schema, data, and paths
 */
export function attributeOneOf(
  childResults: InterpretResult[],
  context: CompositionContext,
): InterpretResult {
  // 1. Discriminator shortcut — deterministic variant selection
  const disc = context.schema.discriminator;
  if (disc && typeof disc.propertyName === "string") {
    return handleDiscriminator(childResults, context, disc.propertyName);
  }

  const structuralMatches = childResults.filter((c) => c.structurallyValid);

  // 2. One structural match → variant identified
  if (structuralMatches.length === 1) {
    const match = structuralMatches[0];
    if (match) return match;
  }

  // 3. Zero structural matches → analyze pattern
  if (structuralMatches.length === 0) {
    return analyzeAllFailed(childResults, context);
  }

  // 4. Multiple structural matches → ambiguous
  return reportMultipleMatches(structuralMatches, context);
}

/**
 * Handle oneOf with a discriminator.
 *
 * Discriminator deterministically selects the variant using the request data.
 * Reads the discriminator property from the data, then maps it to a variant
 * index via implicit matching (const values) or explicit mapping ($ref).
 */
function handleDiscriminator(
  childResults: InterpretResult[],
  context: CompositionContext,
  propName: string,
): InterpretResult {
  // Data must be a plain object to read the discriminator property
  if (!isPlainObject(context.data)) {
    return missingDiscriminatorProperty(propName, context);
  }

  // Discriminator property must be present
  if (!(propName in context.data)) {
    return missingDiscriminatorProperty(propName, context);
  }

  const value = context.data[propName];

  // Resolve which variant index this value selects
  const mapping = context.schema.discriminator?.mapping;
  const variantIndex = resolveVariantIndex(value, propName, mapping, context);

  if (variantIndex === null) {
    return invalidDiscriminatorValue(propName, value, context);
  }

  // Return the selected variant's result with high confidence
  const selected = childResults[variantIndex];
  if (!selected) {
    return invalidDiscriminatorValue(propName, value, context);
  }
  return {
    diagnostics: selected.diagnostics.map((d) => ({
      ...d,
      attribution: {
        confidence: 0.95,
        reasoning: [
          `Discriminator "${propName}" selected variant ${variantIndex}`,
          ...d.attribution.reasoning,
        ],
      },
    })),
    structurallyValid: selected.structurallyValid,
    structuralFailureCount: selected.structuralFailureCount,
  };
}

/**
 * Resolve discriminator value to a variant index.
 *
 * Two modes:
 * - Explicit mapping: disc.mapping maps values to $ref strings, matched against
 *   the oneOf array's $ref entries
 * - Implicit: each oneOf variant's properties[propName].const or enum is compared
 */
function resolveVariantIndex(
  value: unknown,
  propName: string,
  mapping: Record<string, string> | undefined,
  context: CompositionContext,
): number | null {
  const oneOfSchemas = context.schema.oneOf;
  if (!oneOfSchemas) return null;

  const strValue = typeof value === "string" ? value : String(value);

  // Explicit mapping: value → $ref, then find that $ref in oneOf
  if (mapping) {
    const targetRef = mapping[strValue];
    if (!targetRef) return null;

    for (let i = 0; i < oneOfSchemas.length; i++) {
      const variant = oneOfSchemas[i];
      if (variant === undefined || typeof variant === "boolean") continue;
      if (variant.$ref === targetRef) return i;
    }
    return null;
  }

  // Implicit: match against properties[propName].const or enum values
  for (let i = 0; i < oneOfSchemas.length; i++) {
    const variant = oneOfSchemas[i];
    if (variant === undefined || typeof variant === "boolean") continue;
    const propSchema = variant.properties?.[propName];
    if (!propSchema || typeof propSchema === "boolean") continue;

    if (propSchema.const === value) {
      return i;
    }
    if (Array.isArray(propSchema.enum) && propSchema.enum.includes(value)) {
      return i;
    }
  }

  return null;
}

function missingDiscriminatorProperty(
  propName: string,
  context: CompositionContext,
): InterpretResult {
  const e3007 = getCode("E3007");

  const diagnostic: Diagnostic = {
    code: "E3007",
    severity: e3007.severity,
    category: e3007.category,
    requestPath: `${context.path}.${propName}`,
    specPointer: context.schemaPath,
    message: `Missing required discriminator property "${propName}"`,
    attribution: {
      confidence: 0.95,
      reasoning: [`Discriminator requires property "${propName}"`],
    },
  };

  return {
    diagnostics: [diagnostic],
    structurallyValid: false,
    structuralFailureCount: 1,
  };
}

function invalidDiscriminatorValue(
  propName: string,
  value: unknown,
  context: CompositionContext,
): InterpretResult {
  const e3011 = getCode("E3011");

  const diagnostic: Diagnostic = {
    code: "E3011",
    severity: e3011.severity,
    category: e3011.category,
    requestPath: `${context.path}.${propName}`,
    specPointer: context.schemaPath,
    message:
      `Invalid discriminator value "${value}" for property "${propName}"`,
    actual: value,
    attribution: {
      confidence: 0.95,
      reasoning: [
        `Value "${value}" does not match any variant's discriminator`,
      ],
    },
  };

  return {
    diagnostics: [diagnostic],
    structurallyValid: false,
    structuralFailureCount: 1,
  };
}

/**
 * Report ambiguity when multiple variants structurally match.
 */
function reportMultipleMatches(
  structuralMatches: InterpretResult[],
  context: CompositionContext,
): InterpretResult {
  const e3012 = getCode("E3012");

  const diagnostic: Diagnostic = {
    code: "E3012",
    severity: e3012.severity,
    category: e3012.category,
    requestPath: context.path,
    specPointer: context.schemaPath,
    message:
      `${structuralMatches.length} variants structurally match — ambiguous`,
    attribution: {
      confidence: 0.4,
      reasoning: [
        `${structuralMatches.length} variants structurally match`,
        "Cannot determine intended variant without additional context",
      ],
    },
  };

  // Include content diagnostics from matching variants
  const contentDiagnostics = structuralMatches.flatMap((c) => c.diagnostics);

  return {
    diagnostics: [diagnostic, ...contentDiagnostics],
    structurallyValid: true,
    structuralFailureCount: 0,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
