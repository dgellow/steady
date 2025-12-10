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

/**
 * Result of parsing form data
 */
export interface ParsedFormData {
  /** Parsed form fields as a nested object */
  data: Record<string, unknown>;
  /** Any files found in the form data, keyed by field name */
  files: Map<string, File | File[]>;
}

/**
 * Options for form parsing
 */
export interface FormParserOptions {
  /** Schema for type coercion (optional) */
  schema?: SchemaObject | ReferenceObject;
  /** How to handle nested keys - 'dots' for user.name, 'brackets' for user[name] */
  nestedFormat?: "dots" | "brackets";
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
  const { schema, nestedFormat = "dots", resolveSchema } = options;
  const result: Record<string, unknown> = Object.create(null);
  const files = new Map<string, File | File[]>();

  // Group all values by field name (handles repeated fields)
  const fieldValues = new Map<string, (string | File)[]>();

  for (const [key, value] of formData.entries()) {
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
      setNestedValue(result, key, filePlaceholder, nestedFormat);
      continue;
    }

    // Handle string fields
    if (stringValues.length === 0) continue;

    // Get the schema for this property (for type coercion)
    const propertySchema = getPropertySchema(key, schema, resolveSchema);

    // Determine if this should be an array
    const isArrayField = shouldBeArray(propertySchema, stringValues.length);

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

    setNestedValue(result, key, finalValue, nestedFormat);
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
  const { schema, nestedFormat = "dots", resolveSchema } = options;
  const params = new URLSearchParams(body);
  const result: Record<string, unknown> = Object.create(null);

  // Group all values by key
  const fieldValues = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    const existing = fieldValues.get(key) || [];
    existing.push(value);
    fieldValues.set(key, existing);
  }

  // Process each field
  for (const [key, values] of fieldValues) {
    const propertySchema = getPropertySchema(key, schema, resolveSchema);
    const isArrayField = shouldBeArray(propertySchema, values.length);

    let finalValue: unknown;
    if (isArrayField) {
      finalValue = values.map((v) => coerceValue(v, propertySchema));
    } else {
      const firstValue = values[0];
      finalValue = firstValue !== undefined
        ? coerceValue(firstValue, propertySchema)
        : undefined;
    }

    setNestedValue(result, key, finalValue, nestedFormat);
  }

  return { data: result, files: new Map() };
}

/**
 * Set a value in a nested object using dot or bracket notation
 *
 * Examples:
 * - "user.name" → obj.user.name
 * - "user[name]" → obj.user.name
 * - "items[0]" → obj.items[0]
 * - "user[address][city]" → obj.user.address.city
 *
 * Safe from prototype pollution when obj is created with Object.create(null).
 */
function setNestedValue(
  obj: Record<string, unknown>,
  key: string,
  value: unknown,
  format: "dots" | "brackets",
): void {
  // Parse the key into path segments
  const path = parseKeyPath(key, format);

  if (path.length === 0) return;

  // Navigate/create the nested structure
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const nextSegment = path[i + 1];

    // TypeScript safety: these are guaranteed to be strings from parseKeyPath
    if (segment === undefined || nextSegment === undefined) continue;

    if (!(segment in current)) {
      // Create object or array based on next segment
      current[segment] = isNumericString(nextSegment)
        ? []
        : Object.create(null);
    }

    const next = current[segment];
    if (typeof next !== "object" || next === null) {
      // Can't traverse further, overwrite
      current[segment] = isNumericString(nextSegment)
        ? []
        : Object.create(null);
    }

    current = current[segment] as Record<string, unknown>;
  }

  // Set the final value
  const lastKey = path[path.length - 1];
  if (lastKey !== undefined) {
    current[lastKey] = value;
  }
}

/**
 * Parse a key into path segments
 *
 * "user.name" → ["user", "name"]
 * "user[name]" → ["user", "name"]
 * "items[0]" → ["items", "0"]
 * "user[address][city]" → ["user", "address", "city"]
 * "user.address.city" → ["user", "address", "city"]
 */
function parseKeyPath(
  key: string,
  format: "dots" | "brackets",
): string[] {
  if (format === "dots") {
    return key.split(".");
  }

  return parseBracketPath(key);
}

/**
 * Parse bracket notation path
 * "user[address][city]" → ["user", "address", "city"]
 * "user[0]" → ["user", "0"]
 */
function parseBracketPath(key: string): string[] {
  const result: string[] = [];

  // Match: base name, then any number of [segment] parts
  const match = key.match(/^([^\[]+)(.*)$/);
  if (!match || match[1] === undefined) return [key];

  result.push(match[1]);

  // Extract all bracketed segments
  const brackets = match[2] ?? "";
  const bracketRegex = /\[([^\]]*)\]/g;
  let bracketMatch: RegExpExecArray | null;

  while ((bracketMatch = bracketRegex.exec(brackets)) !== null) {
    const segment = bracketMatch[1];
    if (segment !== undefined) {
      result.push(segment);
    }
  }

  return result;
}

/**
 * Check if a string is numeric (for array index detection)
 */
function isNumericString(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * Get the schema for a potentially nested property
 */
function getPropertySchema(
  key: string,
  schema: SchemaObject | ReferenceObject | undefined,
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

  // Parse the key path
  const path = key.includes("[") ? parseBracketPath(key) : key.split(".");

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
 * Coerce a string value to the appropriate type based on schema
 */
function coerceValue(
  value: string,
  schema: SchemaObject | undefined,
): unknown {
  if (!schema) return value;

  // Get the effective type (handle arrays of types)
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
    ? [schema.type]
    : [];

  // Find the first non-null type
  const primaryType = types.find((t) => t !== "null") || "string";

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
      // it might be comma-separated
      if (value.includes(",")) {
        const items = schema.items;
        return value.split(",").map((v) =>
          items && !isReference(items) ? coerceValue(v.trim(), items) : v.trim()
        );
      }
      return [value];

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
