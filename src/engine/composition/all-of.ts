/**
 * allOf composition logic.
 *
 * allOf requires ALL children to match. Structural match is the AND of all
 * children. Unlike oneOf, there's no variant selection. Every child's
 * diagnostics are reported.
 *
 * Pitfall detection:
 * - additionalProperties: false rejecting sibling allOf members' properties
 * - Contradictory type constraints (impossible schema)
 */

import type { Diagnostic } from "../../diagnostic.ts";
import type { CompositionContext, InterpretResult } from "../types.ts";
import { getCode } from "../../codes/registry.ts";

/**
 * Attribute an allOf composition node.
 */
export function attributeAllOf(
  childResults: InterpretResult[],
  context: CompositionContext,
): InterpretResult {
  // Pitfall: contradictory types. Check first since it overrides everything
  const contradictory = detectContradictoryTypes(childResults, context);
  if (contradictory) {
    return contradictory;
  }

  let diagnostics = childResults.flatMap((c) => c.diagnostics);
  const structurallyValid = childResults.every((c) => c.structurallyValid);
  const structuralFailureCount = childResults.reduce(
    (sum, c) => sum + c.structuralFailureCount,
    0,
  );

  // Pitfall: additionalProperties: false rejecting sibling properties
  diagnostics = detectAdditionalPropertiesPitfall(diagnostics, context);

  return { diagnostics, structurallyValid, structuralFailureCount };
}

/**
 * Detect the allOf + additionalProperties: false pitfall.
 *
 * When an allOf member has additionalProperties: false, it only sees its own
 * properties. Properties from sibling members are "additional" from its
 * perspective. This is almost always a spec issue, not an SDK issue.
 */
function detectAdditionalPropertiesPitfall(
  diagnostics: Diagnostic[],
  context: CompositionContext,
): Diagnostic[] {
  const allOfMembers = context.schema.allOf;
  if (!allOfMembers || allOfMembers.length < 2) {
    return diagnostics;
  }

  const hasE3009 = diagnostics.some((d) => d.code === "E3009");
  if (!hasE3009) {
    return diagnostics;
  }

  // Collect property names from each allOf member
  const memberProperties: Set<string>[] = allOfMembers.map(
    (member) => {
      if (typeof member === "boolean" || !member.properties) {
        return new Set<string>();
      }
      return new Set(Object.keys(member.properties));
    },
  );

  return diagnostics.map((diag) => {
    if (diag.code !== "E3009") return diag;

    const propertyName = typeof diag.actual === "string" ? diag.actual : null;
    if (!propertyName) return diag;

    const existsInSibling = memberProperties.some((props) =>
      props.has(propertyName)
    );
    if (!existsInSibling) return diag;

    return {
      ...diag,
      category: "spec-issue" as const,
      attribution: {
        confidence: 0.9,
        reasoning: [
          "allOf + additionalProperties pitfall",
          `Property "${propertyName}" exists in a sibling allOf member`,
          ...diag.attribution.reasoning,
        ],
      },
      suggestion:
        "Use unevaluatedProperties instead of additionalProperties in allOf",
    };
  });
}

/**
 * Detect contradictory type constraints in allOf (impossible schema).
 */
function detectContradictoryTypes(
  childResults: InterpretResult[],
  context: CompositionContext,
): InterpretResult | null {
  const allOfMembers = context.schema.allOf;
  if (!allOfMembers || allOfMembers.length < 2) return null;

  const types: string[] = [];
  for (const member of allOfMembers) {
    if (typeof member === "boolean") continue;
    if (typeof member.type === "string") {
      types.push(member.type);
    }
  }

  if (types.length < 2) return null;

  const uniqueTypes = new Set(types);
  if (uniqueTypes.size <= 1) return null;

  const e1012 = getCode("E1012");
  const typeList = [...uniqueTypes].join(" and ");
  const structuralFailureCount = childResults.reduce(
    (sum, c) => sum + c.structuralFailureCount,
    0,
  );

  const diagnostic: Diagnostic = {
    code: "E1012",
    severity: e1012.severity,
    category: e1012.category,
    requestPath: context.path,
    specPointer: context.schemaPath,
    message: `Impossible schema: allOf requires both ${typeList}`,
    attribution: {
      confidence: 0.95,
      reasoning: [
        `allOf members have contradictory type constraints: ${
          [...uniqueTypes].join(", ")
        }`,
        "No valid input can satisfy this schema",
      ],
    },
    suggestion: "Fix the allOf to use compatible type constraints",
  };

  return {
    diagnostics: [
      diagnostic,
      ...childResults.flatMap((c) => c.diagnostics),
    ],
    structurallyValid: false,
    structuralFailureCount,
  };
}
