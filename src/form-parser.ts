/**
 * Form Data Parser - Handles multipart/form-data and application/x-www-form-urlencoded
 *
 * A thin adapter over the schema-driven kernel in `param-format.ts`. Each
 * wrapper collects entries from its data source and hands them to
 * `parseFormEntries`; the kernel takes care of segment parsing, recursion,
 * terminal coalescing, and type coercion. The only form-parser-specific
 * concerns are (1) decoding JSON-encoded multipart parts per the spec's
 * per-property content type map, and (2) extracting File instances into
 * a separate Map with `"[File]"` placeholders.
 */

import { isReference } from "@steady/openapi";
import type { ReferenceObject, SchemaObject } from "@steady/openapi";
import { getOwn, isPlainObject } from "@steady/json-pointer";
import { isJsonMediaType, type MediaTypeEssence } from "@steady/media-type";
import {
  type ConcreteArrayFormat,
  type ConcreteObjectFormat,
  type FormFormat,
  parseFormEntries,
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
  /**
   * Per-property content type map resolved from the spec's
   * `MediaTypeObject` (explicit encoding + OAS 3.1 defaults). The
   * form parser uses this to decide whether a multipart part is
   * JSON-encoded (decode inline) or not (send to the kernel).
   */
  partContentTypes?: Record<string, MediaTypeEssence>;
}

/**
 * Parse a native FormData object into a structured object.
 *
 * Per entry, if `partContentTypes[key]` is a JSON media type the part
 * body is read as text and `JSON.parse`d into place under `key`; the
 * key is never split. All other entries go through `parseFormEntries`
 * for key splitting and scalar coercion.
 *
 * @param formData - Native FormData from `request.formData()`
 * @param options - Parsing options including schema and part content
 *   types for JSON-part decoding
 * @returns Parsed form data with nested objects and type-coerced
 *   values; File instances moved to the `files` map with `"[File]"`
 *   placeholders in the data tree
 */
export async function parseFormData(
  formData: FormData,
  options: FormParserOptions = {},
): Promise<ParsedFormData> {
  const { schema, resolveSchema, partContentTypes } = options;
  const format: FormFormat = {
    array: options.formArrayFormat ?? "repeat",
    object: options.formObjectFormat ?? "flat",
  };
  const rootSchema = resolveRoot(schema, resolveSchema);

  const kernelEntries: [string, string | File][] = [];
  const jsonBuckets = new Map<string, unknown[]>();

  for (const [key, value] of formData.entries()) {
    const essence = partContentTypes
      ? getOwn(partContentTypes, key)
      : undefined;
    if (essence && isJsonMediaType(essence)) {
      const text = value instanceof File ? await value.text() : value;
      try {
        const parsed = JSON.parse(text);
        const bucket = jsonBuckets.get(key);
        if (bucket) bucket.push(parsed);
        else jsonBuckets.set(key, [parsed]);
      } catch {
        // Malformed JSON for a part the spec said is JSON: let the
        // kernel handle it as a normal entry. Validation downstream
        // sees the type mismatch and reports it.
        kernelEntries.push([key, value]);
      }
      continue;
    }
    kernelEntries.push([key, value]);
  }

  const data = parseFormEntries(
    kernelEntries,
    rootSchema ?? null,
    format,
    resolveSchema,
  );

  // Merge decoded JSON parts. Unwrap single-part buckets; leave
  // multi-part buckets as arrays. The bucket is always an array, so
  // a single JSON value that happens to be an array stays one value.
  for (const [key, values] of jsonBuckets) {
    data[key] = values.length === 1 ? values[0] : values;
  }

  const files = extractFiles(data);
  return { data, files };
}

/**
 * Parse a URL-encoded string into a structured object.
 *
 * No JSON-part handling here; URL-encoded bodies carry only strings.
 *
 * @param body - URL-encoded string (e.g., "name=sam&age=30")
 * @param options - Parsing options
 * @returns Parsed form data
 */
export function parseUrlEncoded(
  body: string,
  options: FormParserOptions = {},
): ParsedFormData {
  const { schema, resolveSchema } = options;
  const format: FormFormat = {
    array: options.formArrayFormat ?? "repeat",
    object: options.formObjectFormat ?? "flat",
  };

  const rootSchema = resolveRoot(schema, resolveSchema);
  const params = new URLSearchParams(body);
  const data = parseFormEntries(
    params.entries(),
    rootSchema ?? null,
    format,
    resolveSchema,
  );
  return { data, files: new Map() };
}

/**
 * Follow a top-level `$ref` on the body schema. The kernel walks
 * composition keywords on its own, so only the top-level reference
 * is resolved here.
 */
function resolveRoot(
  schema: SchemaObject | ReferenceObject | undefined,
  resolveSchema?: (
    schema: SchemaObject | ReferenceObject,
  ) => SchemaObject | undefined,
): SchemaObject | undefined {
  if (!schema) return undefined;
  if (isReference(schema)) return resolveSchema?.(schema);
  return schema;
}

// =============================================================================
// File extraction post-walk
// =============================================================================

/**
 * Walk a parsed tree, replacing File instances with "[File]" placeholders
 * and collecting them into a files Map keyed by dot-joined path.
 */
function extractFiles(
  data: Record<string, unknown>,
  prefix = "",
): Map<string, File | File[]> {
  const files = new Map<string, File | File[]>();

  for (const key of Object.keys(data)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = data[key];

    if (value instanceof File) {
      files.set(fullKey, value);
      data[key] = "[File]";
    } else if (Array.isArray(value)) {
      const fileItems = value.filter((v): v is File => v instanceof File);
      if (fileItems.length > 0 && fileItems.length === value.length) {
        files.set(fullKey, fileItems);
        data[key] = fileItems.map(() => "[File]");
      } else {
        for (const item of value) {
          if (!(item instanceof File) && isPlainObject(item)) {
            const subFiles = extractFiles(item, fullKey);
            for (const [k, v] of subFiles) {
              files.set(k, v);
            }
          }
        }
      }
    } else if (!(value instanceof File) && isPlainObject(value)) {
      const subFiles = extractFiles(value, fullKey);
      for (const [k, v] of subFiles) {
        files.set(k, v);
      }
    }
  }

  return files;
}
