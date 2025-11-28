/**
 * $ref Sibling Keyword Checker
 *
 * According to JSON Schema 2020-12:
 * - When a schema object contains $ref, all sibling keywords are IGNORED
 * - Exception: $id and $anchor are still processed (they identify the schema)
 * - Exception: $comment is still processed (it's for documentation only)
 * - Exception: $defs is still processed (it defines reusable schemas)
 *
 * This is a breaking change from draft-07 where siblings were merged with the referenced schema.
 *
 * Reference: https://json-schema.org/draft/2020-12/json-schema-core.html#name-the-ref-keyword
 */

import type { Schema, SchemaWarning } from "./types.ts";

/**
 * Keywords that are allowed as siblings to $ref in JSON Schema 2020-12
 */
const ALLOWED_REF_SIBLINGS = new Set([
  "$id", // Schema identification
  "$anchor", // Location-independent identification
  "$comment", // Documentation only
  "$defs", // Reusable schema definitions
  "$ref", // The ref itself
]);

/**
 * Check a schema for ignored siblings to $ref
 * Returns warnings for any siblings that will be ignored
 */
export function checkRefSiblings(
  schema: Schema | boolean,
  path: string = "#",
): SchemaWarning[] {
  const warnings: SchemaWarning[] = [];

  if (typeof schema === "boolean") {
    return warnings;
  }

  // Check if this schema has $ref
  if (schema.$ref) {
    // Find all keyword siblings
    const keywords = Object.keys(schema);
    const ignoredKeywords = keywords.filter(
      (key) => !ALLOWED_REF_SIBLINGS.has(key),
    );

    if (ignoredKeywords.length > 0) {
      warnings.push({
        type: "compatibility" as const,
        message:
          `Schema contains $ref with sibling keywords that will be ignored per JSON Schema 2020-12`,
        location: path,
        suggestion: `Remove ignored keywords: ${ignoredKeywords.join(", ")}. ` +
          `In JSON Schema 2020-12, keywords that are siblings to $ref are ignored ` +
          `(except $id, $anchor, $comment, and $defs).`,
      });
    }
  }

  // Recursively check sub-schemas
  if (schema.$defs) {
    for (const [key, subSchema] of Object.entries(schema.$defs)) {
      warnings.push(...checkRefSiblings(subSchema, `${path}/$defs/${key}`));
    }
  }

  if (schema.properties) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      warnings.push(
        ...checkRefSiblings(subSchema, `${path}/properties/${key}`),
      );
    }
  }

  if (schema.patternProperties) {
    for (
      const [pattern, subSchema] of Object.entries(schema.patternProperties)
    ) {
      warnings.push(
        ...checkRefSiblings(subSchema, `${path}/patternProperties/${pattern}`),
      );
    }
  }

  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    warnings.push(
      ...checkRefSiblings(
        schema.additionalProperties,
        `${path}/additionalProperties`,
      ),
    );
  }

  if (schema.items && !Array.isArray(schema.items)) {
    warnings.push(...checkRefSiblings(schema.items, `${path}/items`));
  } else if (Array.isArray(schema.items)) {
    schema.items.forEach((item, i) => {
      warnings.push(...checkRefSiblings(item, `${path}/items/${i}`));
    });
  }

  if (schema.prefixItems) {
    schema.prefixItems.forEach((item, i) => {
      warnings.push(...checkRefSiblings(item, `${path}/prefixItems/${i}`));
    });
  }

  if (schema.allOf) {
    schema.allOf.forEach((s, i) => {
      warnings.push(...checkRefSiblings(s, `${path}/allOf/${i}`));
    });
  }

  if (schema.anyOf) {
    schema.anyOf.forEach((s, i) => {
      warnings.push(...checkRefSiblings(s, `${path}/anyOf/${i}`));
    });
  }

  if (schema.oneOf) {
    schema.oneOf.forEach((s, i) => {
      warnings.push(...checkRefSiblings(s, `${path}/oneOf/${i}`));
    });
  }

  if (schema.not && typeof schema.not === "object") {
    warnings.push(...checkRefSiblings(schema.not, `${path}/not`));
  }

  if (schema.if && typeof schema.if === "object") {
    warnings.push(...checkRefSiblings(schema.if, `${path}/if`));
  }

  if (schema.then && typeof schema.then === "object") {
    warnings.push(...checkRefSiblings(schema.then, `${path}/then`));
  }

  if (schema.else && typeof schema.else === "object") {
    warnings.push(...checkRefSiblings(schema.else, `${path}/else`));
  }

  if (schema.dependentSchemas) {
    for (const [key, subSchema] of Object.entries(schema.dependentSchemas)) {
      warnings.push(
        ...checkRefSiblings(subSchema, `${path}/dependentSchemas/${key}`),
      );
    }
  }

  if (schema.contains && typeof schema.contains === "object") {
    warnings.push(...checkRefSiblings(schema.contains, `${path}/contains`));
  }

  if (schema.propertyNames && typeof schema.propertyNames === "object") {
    warnings.push(
      ...checkRefSiblings(schema.propertyNames, `${path}/propertyNames`),
    );
  }

  if (
    schema.unevaluatedProperties &&
    typeof schema.unevaluatedProperties === "object"
  ) {
    warnings.push(
      ...checkRefSiblings(
        schema.unevaluatedProperties,
        `${path}/unevaluatedProperties`,
      ),
    );
  }

  if (schema.unevaluatedItems && typeof schema.unevaluatedItems === "object") {
    warnings.push(
      ...checkRefSiblings(schema.unevaluatedItems, `${path}/unevaluatedItems`),
    );
  }

  return warnings;
}

/**
 * Get a list of keywords that would be ignored for a schema with $ref
 */
export function getIgnoredKeywords(schema: Schema): string[] {
  if (!schema.$ref) {
    return [];
  }

  const keywords = Object.keys(schema);
  return keywords.filter((key) => !ALLOWED_REF_SIBLINGS.has(key));
}

/**
 * Check if a schema has any ignored sibling keywords to $ref
 */
export function hasIgnoredSiblings(schema: Schema): boolean {
  return getIgnoredKeywords(schema).length > 0;
}
