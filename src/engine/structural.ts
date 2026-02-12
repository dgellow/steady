/**
 * Structural keyword classification.
 *
 * Determines whether a keyword failure means the variant's structure doesn't
 * match (structural) or the value doesn't meet a constraint (content).
 *
 * This is a function, not a table. Some keywords depend on schema context:
 * - `format` is structural for encoding formats (binary, byte), content for
 *   value-validation formats (email, uri, etc.)
 * - `additionalProperties` is structural when explicitly false
 *
 * Structural match is independent of attribution. An E5001 (null for
 * non-nullable, ambiguous) has keyword `type` → structural. An E4001 (email
 * format, content-note) has keyword `format` with value `email` → content.
 */

import type { Schema } from "@steady/json-schema";

/** Encoding formats that are the SDK's responsibility. */
export const STRUCTURAL_FORMATS: ReadonlySet<string> = new Set([
  "binary",
  "byte",
]);

/** Keywords that are always structural. Failure means the variant doesn't match. */
const ALWAYS_STRUCTURAL: ReadonlySet<string> = new Set([
  "type",
  "required",
  "enum",
  "const",
]);

/** Keywords that are always content. Failure means the value is wrong, not the structure. */
const ALWAYS_CONTENT: ReadonlySet<string> = new Set([
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "multipleOf",
  "minProperties",
  "maxProperties",
  "uniqueItems",
]);

/**
 * Determine whether a keyword failure is structural (variant doesn't match)
 * or content (value constraint violation).
 *
 * @param keyword - The JSON Schema keyword that failed validation
 * @param schema - The schema containing the keyword (needed for context-dependent keywords)
 * @returns true if the failure is structural
 */
export function isStructural(keyword: string, schema: Schema): boolean {
  if (ALWAYS_STRUCTURAL.has(keyword)) {
    return true;
  }

  if (ALWAYS_CONTENT.has(keyword)) {
    return false;
  }

  if (keyword === "format") {
    const format = schema.format;
    return typeof format === "string" && STRUCTURAL_FORMATS.has(format);
  }

  if (keyword === "additionalProperties") {
    return schema.additionalProperties === false;
  }

  // Unknown keyword. Conservative default: not structural
  return false;
}
