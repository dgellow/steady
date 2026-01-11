/**
 * Form Data Parser - Handles multipart/form-data and application/x-www-form-urlencoded
 *
 * Uses Deno's native FormData API (web standard) for parsing, then converts
 * to plain objects with proper nested property handling.
 *
 * Supports:
 * - Dot notation: `user.name=sam` → `{user: {name: "sam"}}`
 * - Bracket notation: `user[name]=sam` → `{user: {name: "sam"}}`
 * - Array fields: `tags=a&tags=b` → `{tags: ["a", "b"]}`
 * - File uploads: Returns File objects for binary fields
 * - Type coercion: Converts strings to numbers/booleans based on schema
 */

import type { ReferenceObject, SchemaObject } from "@steady/openapi";
import { isReference } from "./types.ts";
import {
  type ConcreteArrayFormat,
  type ConcreteObjectFormat,
  groupFormEntries,
  isNumericString,
  parseKeyToPath,
  setNestedValue,
} from "./param-format.ts";

/**
 * Result of parsing form data
 */
export interface ParsedFormData {
  /** Parsed form fields as a nested object */
  data: Record<string, unknown>;
  /** Any files found in the form data, keyed by field name */
  files: Map<string, File | File[]>;
}

// Re-export format types for external use
export type { ConcreteArrayFormat, ConcreteObjectFormat };

/**
 * Options for form parsing
 */
export interface FormParserOptions {
  /** Schema for type coercion (optional) */
  schema?: SchemaObject | ReferenceObject;
  /** How array fields are serialized. Default: 'repeat' */
  formArrayFormat?: ConcreteArrayFormat;
  /** How object fields are serialized. Default: 'flat' */
  formObjectFormat?: ConcreteObjectFormat;
  /** Schema resolver function for $ref resolution */
  resolveSchema?: (
    schema: SchemaObject | ReferenceObject,
  ) => SchemaObject | undefined;
}

/**
 * Parse a native FormData object into a structured object
 *
 * @param formData - Native FormData from request.formData()
 * @param options - Parsing options including schema for type coercion
 * @returns Parsed form data with nested objects and type-coerced values
 */
export function parseFormData(
  formData: FormData,
  options: FormParserOptions = {},
): ParsedFormData {
  const {
    schema,
    formArrayFormat = "repeat",
    formObjectFormat = "flat",
    resolveSchema,
  } = options;
  const result: Record<string, unknown> = Object.create(null);
  const files = new Map<string, File | File[]>();

  // Track which fields are explicitly arrays (brackets notation)
  const explicitArrayFields = new Set<string>();

  // Group all values by field name (handles repeated fields)
  const fieldValues = new Map<string, (string | File)[]>();

  for (const [rawKey, value] of formData.entries()) {
    // Normalize key based on array format
    let key = rawKey;
    if (formArrayFormat === "brackets" && rawKey.endsWith("[]")) {
      key = rawKey.slice(0, -2);
      explicitArrayFields.add(key);
    }

    const existing = fieldValues.get(key) || [];
    existing.push(value);
    fieldValues.set(key, existing);
  }

  // Process each field
  for (const [key, values] of fieldValues) {
    // Separate files from regular values
    const fileValues = values.filter((v): v is File => v instanceof File);
    const stringValues = values.filter((v): v is string =>
      typeof v === "string"
    );

    // Handle file fields
    if (fileValues.length > 0) {
      const firstFile = fileValues[0];
      if (fileValues.length === 1 && firstFile !== undefined) {
        files.set(key, firstFile);
      } else {
        files.set(key, fileValues);
      }
      // Also set a placeholder in the data for schema validation
      const filePlaceholder = fileValues.length === 1
        ? "[File]"
        : fileValues.map(() => "[File]");
      const path = parseKeyToPath(key, formObjectFormat);
      setNestedValue(result, path, filePlaceholder);
      continue;
    }

    // Handle string fields
    if (stringValues.length === 0) continue;

    // Get the schema for this property (for type coercion)
    const propertySchema = getPropertySchema(
      key,
      schema,
      formObjectFormat,
      resolveSchema,
    );

    // Determine if this should be an array
    const isExplicitArray = explicitArrayFields.has(key);
    const isArrayField = isExplicitArray ||
      shouldBeArray(propertySchema, stringValues.length);

    // Handle comma format: split single value into array if schema expects array
    if (
      formArrayFormat === "comma" && stringValues.length === 1 &&
      propertySchema?.type === "array"
    ) {
      const parts = stringValues[0]!.split(",");
      const itemSchema =
        propertySchema.items && !isReference(propertySchema.items)
          ? propertySchema.items
          : undefined;
      const finalValue = parts.map((v) => coerceValue(v.trim(), itemSchema));
      const path = parseKeyToPath(key, formObjectFormat);
      setNestedValue(result, path, finalValue);
      continue;
    }

    // Coerce values based on schema
    let finalValue: unknown;
    if (isArrayField) {
      finalValue = stringValues.map((v) => coerceValue(v, propertySchema));
    } else {
      const firstValue = stringValues[0];
      finalValue = firstValue !== undefined
        ? coerceValue(firstValue, propertySchema)
        : undefined;
    }

    const path = parseKeyToPath(key, formObjectFormat);
    setNestedValue(result, path, finalValue);
  }

  return { data: result, files };
}

/**
 * Parse a URL-encoded string into a structured object
 *
 * @param body - URL-encoded string (e.g., "name=sam&age=30")
 * @param options - Parsing options
 * @returns Parsed form data
 */
export function parseUrlEncoded(
  body: string,
  options: FormParserOptions = {},
): ParsedFormData {
  const {
    schema,
    formArrayFormat = "repeat",
    formObjectFormat = "flat",
    resolveSchema,
  } = options;
  const params = new URLSearchParams(body);
  const result: Record<string, unknown> = Object.create(null);

  // Use shared groupFormEntries for array format normalization
  const stringEntries: [string, string][] = [];
  for (const [key, value] of params.entries()) {
    stringEntries.push([key, value]);
  }
  const { groups, explicitArrays } = groupFormEntries(
    stringEntries,
    formArrayFormat,
  );

  // Process each field
  for (const [key, values] of groups) {
    const propertySchema = getPropertySchema(
      key,
      schema,
      formObjectFormat,
      resolveSchema,
    );
    const isExplicitArray = explicitArrays.has(key);
    const isArrayField = isExplicitArray ||
      shouldBeArray(propertySchema, values.length);

    let finalValue: unknown;
    if (isArrayField) {
      finalValue = values.map((v) => coerceValue(v, propertySchema));
    } else {
      const firstValue = values[0];
      finalValue = firstValue !== undefined
        ? coerceValue(firstValue, propertySchema)
        : undefined;
    }

    const path = parseKeyToPath(key, formObjectFormat);
    setNestedValue(result, path, finalValue);
  }

  return { data: result, files: new Map() };
}

/**
 * Get the schema for a potentially nested property
 */
function getPropertySchema(
  key: string,
  schema: SchemaObject | ReferenceObject | undefined,
  objectFormat: ConcreteObjectFormat,
  resolveSchema?: (
    schema: SchemaObject | ReferenceObject,
  ) => SchemaObject | undefined,
): SchemaObject | undefined {
  if (!schema) return undefined;

  // Resolve reference if needed
  let resolved: SchemaObject | undefined;
  if (isReference(schema)) {
    resolved = resolveSchema?.(schema);
  } else {
    resolved = schema;
  }

  if (!resolved) return undefined;

  // Parse the key path using the specified format
  const path = parseKeyToPath(key, objectFormat);

  // Navigate to the nested property schema
  let current: SchemaObject | undefined = resolved;

  for (const segment of path) {
    if (!current) return undefined;

    if (current.type === "array" && isNumericString(segment)) {
      // Array index - get items schema
      const itemsSchema: SchemaObject | ReferenceObject | undefined =
        current.items;
      if (!itemsSchema) return undefined;
      if (isReference(itemsSchema)) {
        current = resolveSchema?.(itemsSchema);
      } else {
        current = itemsSchema;
      }
    } else if (current.properties) {
      // Object property
      const prop = current.properties[segment];
      if (!prop) return undefined;
      if (isReference(prop)) {
        current = resolveSchema?.(prop);
      } else {
        current = prop;
      }
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Determine if a field should be an array based on schema or value count
 */
function shouldBeArray(
  schema: SchemaObject | undefined,
  valueCount: number,
): boolean {
  // If schema says it's an array, it's an array
  if (schema?.type === "array") return true;

  // Multiple values without explicit schema → probably an array
  if (valueCount > 1) return true;

  return false;
}

/**
 * Get the primary type from a schema, handling anyOf/oneOf compositions.
 * Returns the first non-null type found.
 */
function getPrimaryType(schema: SchemaObject | undefined): string {
  if (!schema) return "string";

  // Direct type check
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of types) {
      if (t !== "null") return t;
    }
  }

  // Check anyOf/oneOf for a type (commonly used for nullable types)
  if (schema.anyOf) {
    for (const sub of schema.anyOf) {
      if (!isReference(sub)) {
        const subType = getPrimaryType(sub);
        if (subType !== "string") return subType;
      }
    }
  }
  if (schema.oneOf) {
    for (const sub of schema.oneOf) {
      if (!isReference(sub)) {
        const subType = getPrimaryType(sub);
        if (subType !== "string") return subType;
      }
    }
  }

  return "string";
}

/**
 * Coerce a string value to the appropriate type based on schema
 */
function coerceValue(
  value: string,
  schema: SchemaObject | undefined,
): unknown {
  if (!schema) return value;

  const primaryType = getPrimaryType(schema);

  switch (primaryType) {
    case "integer":
      return parseInt(value, 10);

    case "number":
      return parseFloat(value);

    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      // Invalid boolean - return as string, let schema validation catch it
      return value;

    case "array":
      // If the schema expects an array but we got a single string,
      // it might be comma-separated - split and coerce each item
      if (value.includes(",")) {
        const items = schema.items;
        return value.split(",").map((v) =>
          items && !isReference(items) ? coerceValue(v.trim(), items) : v.trim()
        );
      }
      // Don't auto-wrap single values - caller handles array structure
      return value;

    case "object":
      // Try to parse as JSON
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }

    default:
      return value;
  }
}

/**
 * Get media type from Content-Type header (strips parameters like charset, boundary)
 */
export function getMediaType(contentType: string): string {
  return contentType.split(";")[0]?.trim() || "application/json";
}

/**
 * Check if a media type is a form type
 */
export function isFormMediaType(mediaType: string): boolean {
  return (
    mediaType === "multipart/form-data" ||
    mediaType === "application/x-www-form-urlencoded"
  );
}

/**
 * Check if a media type is JSON
 */
export function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType.endsWith("+json");
}
