/**
 * Schema inspection and coercion utilities.
 *
 * Pure, stateless functions that resolve schema semantics through
 * composition keywords (allOf/anyOf/oneOf). Consumers should use
 * these instead of accessing schema.type, schema.properties, etc.
 * directly, which breaks when schemas use composition.
 *
 * No registry dependency. No $ref resolution (refs must be resolved
 * before calling these functions).
 */

import { getOwn } from "@steady/json-pointer";
import type { Schema, SchemaType } from "./types.ts";

/** Guard against pathological nesting in composition walks. */
const MAX_COMPOSITION_DEPTH = 50;

// ── Schema inspection ─────────────────────────────────────────────

/**
 * Resolve the effective type of a schema, walking allOf/anyOf/oneOf.
 *
 * Priority:
 * 1. Direct `type` field (filter out "null" from type arrays)
 * 2. allOf members (any member's type applies)
 * 3. anyOf/oneOf members (first non-null type, preferring non-string
 *    for coercion: if the spec allows "string | integer", coercing to
 *    integer is more useful than leaving the value as a string)
 * 4. Structural inference (properties -> "object", items -> "array", etc.)
 *
 * Returns null if no type can be determined.
 */
export function effectiveType(schema: Schema | boolean): SchemaType | null {
  return resolveType(schema, 0);
}

function resolveType(
  schema: Schema | boolean,
  depth: number,
): SchemaType | null {
  if (typeof schema === "boolean") return null;
  if (depth > MAX_COMPOSITION_DEPTH) return null;

  // Direct type field
  if (schema.type) {
    if (Array.isArray(schema.type)) {
      const nonNull = schema.type.filter((t) => t !== "null");
      return nonNull[0] ?? null;
    }
    return schema.type;
  }

  // Walk allOf: any member's type applies (they all describe the same value)
  if (schema.allOf) {
    for (const member of schema.allOf) {
      const t = resolveType(member, depth + 1);
      if (t) return t;
    }
  }

  // Walk anyOf/oneOf: prefer non-null, non-string types for coercion
  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = schema[key];
    if (!variants) continue;
    let fallback: SchemaType | null = null;
    for (const variant of variants) {
      const t = resolveType(variant, depth + 1);
      if (t && t !== "null") {
        if (t !== "string") return t;
        if (!fallback) fallback = t;
      }
    }
    if (fallback) return fallback;
  }

  // Structural inference
  if (
    schema.properties || schema.patternProperties ||
    schema.additionalProperties
  ) {
    return "object";
  }
  if (schema.items || schema.prefixItems || schema.contains) {
    return "array";
  }
  if (
    schema.pattern || schema.minLength !== undefined ||
    schema.maxLength !== undefined
  ) {
    return "string";
  }
  if (
    schema.minimum !== undefined || schema.maximum !== undefined ||
    schema.multipleOf !== undefined
  ) {
    return "number";
  }

  return null;
}

/**
 * Collect the merged property map by walking allOf/anyOf/oneOf.
 *
 * For allOf: unions all members' properties (last wins on conflict).
 * For anyOf/oneOf: returns first variant that has properties.
 * Returns null if no properties found anywhere.
 */
export function effectiveProperties(
  schema: Schema | boolean,
): Record<string, Schema> | null {
  if (typeof schema === "boolean") return null;
  return collectProperties(schema, 0);
}

function collectProperties(
  schema: Schema,
  depth: number,
): Record<string, Schema> | null {
  if (depth > MAX_COMPOSITION_DEPTH) return null;

  let merged: Record<string, Schema> | null = null;

  // Direct properties
  if (schema.properties) {
    merged = { ...schema.properties };
  }

  // allOf: merge all members' properties
  if (schema.allOf) {
    for (const member of schema.allOf) {
      if (typeof member === "boolean") continue;
      const memberProps = collectProperties(member, depth + 1);
      if (memberProps) {
        merged = merged ? { ...merged, ...memberProps } : { ...memberProps };
      }
    }
  }

  if (merged) return merged;

  // anyOf/oneOf: pick first variant with properties
  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = schema[key];
    if (!variants) continue;
    for (const variant of variants) {
      if (typeof variant === "boolean") continue;
      const variantProps = collectProperties(variant, depth + 1);
      if (variantProps) return variantProps;
    }
  }

  return null;
}

/**
 * Resolve the effective items schema through composition.
 * Returns null if no items schema found.
 */
export function effectiveItems(
  schema: Schema | boolean,
): Schema | null {
  return resolveItems(schema, 0);
}

function resolveItems(
  schema: Schema | boolean,
  depth: number,
): Schema | null {
  if (typeof schema === "boolean") return null;
  if (depth > MAX_COMPOSITION_DEPTH) return null;

  // Direct items
  if (schema.items !== undefined) {
    // items can be Schema | Schema[]; for coercion we only handle single schema
    if (Array.isArray(schema.items)) return null;
    return schema.items;
  }

  // Walk composition
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const variants = schema[key];
    if (!variants) continue;
    for (const variant of variants) {
      const items = resolveItems(variant, depth + 1);
      if (items !== null) return items;
    }
  }

  return null;
}

/**
 * Collect merged required fields, walking allOf (union, deduplicated).
 * Returns empty array if none found.
 *
 * NOTE: this returns the raw "what the spec author declared" set. It
 * is NOT filtered against `effectiveProperties(schema)`, so it can
 * contain names that are not defined as properties anywhere in the
 * schema. Such "phantom required" entries are a spec bug (E1016
 * catches them at startup), and consumers that iterate this list to
 * generate or mutate data must filter them themselves. The standard
 * pattern is
 *   `for (const name of effectiveRequired(schema)) {
 *      if (!props[name]) continue;
 *      ...
 *    }`
 * Two distinct questions deserve two distinct answers: "what does the
 * spec say is required?" is this function; "what can a consumer
 * actually do with the required list?" is the caller's job.
 */
export function effectiveRequired(
  schema: Schema | boolean,
): string[] {
  if (typeof schema === "boolean") return [];
  const set = new Set<string>();
  collectRequired(schema, set, 0);
  return [...set];
}

function collectRequired(
  schema: Schema,
  set: Set<string>,
  depth: number,
): void {
  if (depth > MAX_COMPOSITION_DEPTH) return;

  if (schema.required) {
    for (const name of schema.required) {
      set.add(name);
    }
  }

  // allOf: merge all members' required
  if (schema.allOf) {
    for (const member of schema.allOf) {
      if (typeof member === "boolean") continue;
      collectRequired(member, set, depth + 1);
    }
  }
}

/**
 * Check if a schema describes an array type.
 * Walks anyOf/oneOf/allOf.
 */
export function isArraySchema(schema: Schema | boolean): boolean {
  return checkArraySchema(schema, 0);
}

function checkArraySchema(
  schema: Schema | boolean,
  depth: number,
): boolean {
  if (typeof schema === "boolean") return false;
  if (depth > MAX_COMPOSITION_DEPTH) return false;
  if (schema.type === "array") return true;
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[key];
    if (variants) {
      for (const variant of variants) {
        if (checkArraySchema(variant, depth + 1)) return true;
      }
    }
  }
  return false;
}

/**
 * Check if a schema describes an object type.
 * Walks anyOf/oneOf/allOf.
 */
export function isObjectSchema(schema: Schema | boolean): boolean {
  return checkObjectSchema(schema, 0);
}

function checkObjectSchema(
  schema: Schema | boolean,
  depth: number,
): boolean {
  if (typeof schema === "boolean") return false;
  if (depth > MAX_COMPOSITION_DEPTH) return false;
  if (schema.type === "object") return true;
  if (schema.properties !== undefined) return true;
  if (schema.additionalProperties !== undefined) return true;
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[key];
    if (variants) {
      for (const variant of variants) {
        if (checkObjectSchema(variant, depth + 1)) return true;
      }
    }
  }
  return false;
}

// ── Coercion ──────────────────────────────────────────────────────

/**
 * Coerce a raw HTTP string to the type declared by the schema.
 * Walks composition keywords to find the effective type.
 * Returns the raw string if coercion fails (validator will catch the mismatch).
 */
export function coerceScalar(raw: string, schema: Schema | boolean): unknown {
  const schemaType = effectiveType(schema);

  if (schemaType === "integer" || schemaType === "number") {
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      if (schemaType === "integer" && Number.isInteger(num)) return num;
      if (schemaType === "number") return num;
    }
    return raw;
  }

  if (schemaType === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return raw;
  }

  return raw;
}

/**
 * Coerce a raw form-field string to the type declared by the schema.
 *
 * This is the terminal transformation applied to every leaf value in the
 * form parser. For primitive target types (integer, number, boolean,
 * string, null) it delegates to `coerceScalar`. For complex target types
 * (object, array) the raw string is returned unchanged; validation
 * downstream will see a type mismatch and report it.
 *
 * Keep this in sync with `coerceScalar`'s primitive set. New primitive
 * types added to the former should flow through here too.
 */
export function coerceFormValue(
  raw: string,
  schema: Schema | boolean,
): unknown {
  return coerceScalar(raw, schema);
}

/**
 * Recursively coerce leaf string values in arrays/objects using schema structure.
 * Walks composition keywords to find effective properties and items.
 * Non-string values pass through unchanged.
 */
export function coerceDeep(value: unknown, schema: Schema | boolean): unknown {
  if (typeof schema === "boolean") return value;

  // Array: coerce each item via effective items schema
  if (Array.isArray(value)) {
    const itemSchema = effectiveItems(schema);
    if (!itemSchema) return value;
    return value.map((item) =>
      typeof item === "string"
        ? coerceScalar(item, itemSchema)
        : coerceDeep(item, itemSchema)
    );
  }

  // Object: coerce each property via effective properties
  if (typeof value === "object" && value !== null) {
    const props = effectiveProperties(schema);
    if (!props) return value;
    const result: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      const propSchema = getOwn(props, k);
      if (propSchema && typeof v === "string") {
        result[k] = coerceScalar(v, propSchema);
      } else if (propSchema && typeof v === "object" && v !== null) {
        result[k] = coerceDeep(v, propSchema);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  // Scalar leaf
  if (typeof value === "string") {
    return coerceScalar(value, schema);
  }

  return value;
}
