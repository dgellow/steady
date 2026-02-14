/**
 * Format-aware query parameter parsing.
 *
 * Called by the diagnostic engine per-parameter. Handles:
 * - Format resolution (auto -> concrete via style/explode)
 * - Schema-aware type detection (array vs object vs scalar)
 * - Structural parsing (getArrayValues, parseObjectValue from param-format.ts)
 * - Deep coercion (string -> number/boolean at leaf level)
 *
 * The engine stays as orchestrator; this module does the parsing work.
 */

import type { Schema } from "@steady/json-schema";
import type { KeyValueSource } from "../param-format.ts";
import {
  getArrayValues,
  hasParamValue,
  parseObjectValue,
  resolveArrayFormat,
  resolveObjectFormat,
} from "../param-format.ts";
import type { ConcreteObjectFormat } from "../param-format.ts";
import type { QueryArrayFormat, QueryObjectFormat } from "../types.ts";
import type { ResolvedParameter } from "./diagnostic-engine.ts";

// ── Public types ───────────────────────────────────────────────────

export interface ParsedParam {
  present: boolean;
  value?: unknown;
}

// ── Schema inspection ──────────────────────────────────────────────

/** Check if a schema describes an array type. Walks anyOf/oneOf/allOf. */
export function isArraySchema(schema: Schema): boolean {
  if (typeof schema === "boolean") return false;
  if (schema.type === "array") return true;
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[key];
    if (variants) {
      for (const variant of variants) {
        if (isArraySchema(variant)) return true;
      }
    }
  }
  return false;
}

/** Check if a schema describes an object type. Walks anyOf/oneOf/allOf. */
export function isObjectSchema(schema: Schema): boolean {
  if (typeof schema === "boolean") return false;
  if (schema.type === "object") return true;
  if (schema.properties !== undefined) return true;
  if (schema.additionalProperties !== undefined) return true;
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[key];
    if (variants) {
      for (const variant of variants) {
        if (isObjectSchema(variant)) return true;
      }
    }
  }
  return false;
}

// ── Scalar coercion ────────────────────────────────────────────────

/**
 * Coerce a raw HTTP string to the type expected by the schema.
 * Returns the raw string if coercion fails (validator will catch the mismatch).
 */
export function coerceScalar(raw: string, schema: Schema): unknown {
  if (typeof schema === "boolean") return raw;

  const schemaType = schema.type;

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

// ── Deep coercion ──────────────────────────────────────────────────

/**
 * Recursively coerce leaf values through array items and object properties.
 * Non-string values pass through unchanged.
 */
export function deepCoerce(value: unknown, schema: Schema): unknown {
  if (typeof schema === "boolean") return value;

  // Array: coerce each item via schema.items
  if (Array.isArray(value)) {
    const itemSchema = schema.items;
    if (!itemSchema || typeof itemSchema === "boolean") return value;
    // schema.items can be Schema | Schema[] per the type definition
    if (Array.isArray(itemSchema)) return value;
    return value.map((item) =>
      typeof item === "string"
        ? coerceScalar(item, itemSchema)
        : deepCoerce(item, itemSchema)
    );
  }

  // Object: coerce each property via schema.properties
  if (typeof value === "object" && value !== null) {
    const props = schema.properties;
    if (!props) return value;
    const result: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      const propSchema = props[k];
      if (propSchema && typeof v === "string") {
        result[k] = coerceScalar(v, propSchema);
      } else if (propSchema && typeof v === "object" && v !== null) {
        result[k] = deepCoerce(v, propSchema);
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

// ── Main parse function ────────────────────────────────────────────

/** Parse a single query parameter using format-aware logic. */
export function parseQueryParam(
  source: KeyValueSource,
  param: ResolvedParameter,
  queryArrayFormat: QueryArrayFormat,
  queryObjectFormat: QueryObjectFormat,
): ParsedParam {
  const schema = param.schema;

  // No schema or boolean schema: treat as simple scalar
  if (!schema || typeof schema === "boolean") {
    const raw = source.get(param.name);
    if (raw === null) return { present: false };
    return { present: true, value: raw };
  }

  const isArray = isArraySchema(schema);
  const isObject = isObjectSchema(schema);

  const arrayFmt = resolveArrayFormat(
    queryArrayFormat,
    param.style,
    param.explode,
  );
  const objectFmt = resolveObjectFormat(
    queryObjectFormat,
    param.style,
    param.explode,
  );

  // For flat objects, presence must check schema property keys
  if (isObject && objectFmt === "flat") {
    const value = parseObjectParam(source, param.name, schema, objectFmt);
    const hasKeys = Object.keys(value).length > 0;
    if (!hasKeys) return { present: false };
    return { present: true, value: deepCoerce(value, schema) };
  }

  // Check presence using format-aware logic
  const present = hasParamValue(
    source,
    param.name,
    isArray,
    isObject,
    arrayFmt,
    objectFmt,
  );
  if (!present) return { present: false };

  // Parse based on detected type
  if (isArray) {
    const raw = getArrayValues(source, param.name, arrayFmt);
    return { present: true, value: deepCoerce(raw, schema) };
  }

  if (isObject) {
    const value = parseObjectParam(source, param.name, schema, objectFmt);
    return { present: true, value: deepCoerce(value, schema) };
  }

  // Scalar
  const raw = source.get(param.name);
  if (raw === null) return { present: false };
  return { present: true, value: coerceScalar(raw, schema) };
}

// ── Object param helper ────────────────────────────────────────────

/**
 * Parse an object query parameter. For "flat" format, we need schema
 * properties to know which top-level keys belong to this param.
 */
function parseObjectParam(
  source: KeyValueSource,
  name: string,
  schema: Schema,
  objectFmt: ConcreteObjectFormat,
): Record<string, unknown> {
  if (objectFmt !== "flat") {
    return parseObjectValue(source, name, objectFmt);
  }

  // Flat format: iterate schema.properties and pull each key from source
  if (typeof schema === "boolean") return {};
  const props = schema.properties;
  if (!props) {
    // No properties defined; try the single value
    const raw = source.get(name);
    if (raw !== null) {
      const result: Record<string, unknown> = Object.create(null);
      result[name] = raw;
      return result;
    }
    return {};
  }

  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(props)) {
    const raw = source.get(key);
    if (raw !== null) {
      result[key] = raw;
    }
  }
  return result;
}

// ── Expected keys computation ──────────────────────────────────────

/**
 * Build the set of expected query keys for unknown-param detection.
 * Returns known exact keys and dynamic prefixes (for bracket/dot notation).
 */
export function getExpectedQueryKeys(
  params: ResolvedParameter[],
  queryArrayFormat: QueryArrayFormat,
  queryObjectFormat: QueryObjectFormat,
): { known: Set<string>; dynamicPrefixes: Set<string> } {
  const known = new Set<string>();
  const dynamicPrefixes = new Set<string>();

  for (const param of params) {
    if (param.in !== "query") continue;

    known.add(param.name);

    const schema = param.schema;
    if (!schema || typeof schema === "boolean") continue;

    const isArray = isArraySchema(schema);
    const isObj = isObjectSchema(schema);

    if (isArray) {
      const arrayFmt = resolveArrayFormat(
        queryArrayFormat,
        param.style,
        param.explode,
      );
      if (arrayFmt === "brackets") {
        known.add(`${param.name}[]`);
      }
    }

    if (isObj) {
      const objectFmt = resolveObjectFormat(
        queryObjectFormat,
        param.style,
        param.explode,
      );
      switch (objectFmt) {
        case "brackets":
          dynamicPrefixes.add(`${param.name}[`);
          break;
        case "dots":
          dynamicPrefixes.add(`${param.name}.`);
          break;
        case "flat": {
          // In flat format, individual property names appear as top-level keys
          const props = schema.properties;
          if (props) {
            for (const key of Object.keys(props)) {
              known.add(key);
            }
          }
          break;
        }
        case "flat-comma":
          // flat-comma uses the param name itself (already added)
          break;
      }
    }
  }

  return { known, dynamicPrefixes };
}
