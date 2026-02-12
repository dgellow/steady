import type { ReferenceObject, SchemaObject } from "@steady/openapi";

/**
 * Check if a generated response body is suspiciously minimal given the schema.
 * Returns true if body is {} or [] but the schema declares required properties
 * or has non-trivial property definitions.
 */
export function isMinimalResponse(
  body: unknown,
  schema: SchemaObject | ReferenceObject,
): boolean {
  if (body === null || body === undefined) return false;
  if (typeof body !== "object") return false;

  const isEmptyObject = !Array.isArray(body) &&
    Object.keys(body).length === 0;
  const isEmptyArray = Array.isArray(body) && body.length === 0;

  if (!isEmptyObject && !isEmptyArray) return false;

  // Pure $ref schemas can't be inspected without resolution
  if (!("properties" in schema) && !("required" in schema)) return false;

  if (
    "required" in schema && Array.isArray(schema.required) &&
    schema.required.length > 0
  ) {
    return true;
  }

  if (
    "properties" in schema && schema.properties &&
    typeof schema.properties === "object" &&
    Object.keys(schema.properties).length > 0
  ) {
    return true;
  }

  return false;
}
