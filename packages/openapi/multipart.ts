/**
 * Per-property content type resolution for multipart request bodies.
 *
 * OpenAPI 3.1 specifies, per property of a multipart body, what
 * `Content-Type` each part should have. It is explicit when
 * `encoding[prop].contentType` is declared and derived from the
 * property's schema otherwise (section 4.8.14.5):
 *
 *   - `type: string` with `format: "binary"` or `contentEncoding`
 *     -> `application/octet-stream`
 *   - complex type (object or array of objects, walking composition
 *     and `$ref`) -> `application/json`
 *   - primitive or array of primitives -> `text/plain`
 *
 * This module exposes that as a pure function over `MediaTypeObject`
 * and `SchemaRegistry`. The output is a map from property name to
 * `MediaTypeEssence` (the branded, parsed type from
 * `@steady/media-type`) so that downstream consumers never re-parse a
 * raw content-type string.
 */

import {
  effectiveItems,
  effectiveType,
  isObjectSchema,
  type Schema,
  type SchemaRegistry,
} from "@steady/json-schema";
import {
  getMediaType,
  isJsonMediaType,
  type MediaTypeEssence,
} from "@steady/media-type";
import { getOwn } from "@steady/json-pointer";
import { isReference } from "./openapi.ts";
import type {
  MediaTypeObject,
  ReferenceObject,
  SchemaObject,
} from "./openapi.ts";

/**
 * Pre-parse a known-good media type at module load. Throws if the
 * input is not a parseable essence; used only for the OAS 3.1
 * default constants below.
 */
function parseEssence(raw: string): MediaTypeEssence {
  const essence = getMediaType(raw);
  if (!essence) throw new Error(`Invalid media type constant: ${raw}`);
  return essence;
}

const JSON_ESSENCE = parseEssence("application/json");
const OCTET_STREAM_ESSENCE = parseEssence("application/octet-stream");
const TEXT_PLAIN_ESSENCE = parseEssence("text/plain");

/**
 * Resolve the per-property `Content-Type` map for a multipart body.
 *
 * Entries are returned for every property that appears either in the
 * schema or in `encoding`. A property is omitted from the result when
 * its content type cannot be determined (no schema and no encoding,
 * or an encoding `contentType` string that does not parse). The
 * consumer treats a missing entry as "unknown; use the default
 * parser".
 */
export function resolvePartContentTypes(
  mediaType: MediaTypeObject,
  registry: SchemaRegistry,
): Record<string, MediaTypeEssence> {
  const result: Record<string, MediaTypeEssence> = {};

  const rootSchema = dereference(mediaType.schema, registry);
  const names = new Set<string>();
  if (rootSchema?.properties) {
    for (const name of Object.keys(rootSchema.properties)) names.add(name);
  }
  if (mediaType.encoding) {
    for (const name of Object.keys(mediaType.encoding)) names.add(name);
  }

  for (const name of names) {
    // `name` comes from either map, so each lookup may miss.
    const propSchema = rootSchema?.properties
      ? getOwn(rootSchema.properties, name)
      : undefined;
    const implicit = implicitEssence(propSchema, registry);

    const explicitRaw = mediaType.encoding
      ? getOwn(mediaType.encoding, name)?.contentType
      : undefined;
    if (explicitRaw !== undefined) {
      const explicit = getMediaType(explicitRaw);
      if (!explicit) continue;

      // Reconcile explicit Content-Type with the schema. When the
      // explicit encoding is JSON but the schema implies a non-JSON
      // value (primitive -> text/plain, format:binary -> octet-stream),
      // the schema wins. The explicit Content-Type is transport
      // metadata about the part's serialization; the API value is
      // still a string or bytes, not a parsed JSON tree. This is the
      // pattern used by specs that describe a string whose contents
      // happen to be JSON text.
      if (implicit && isJsonMediaType(explicit) && !isJsonMediaType(implicit)) {
        result[name] = implicit;
        continue;
      }
      result[name] = explicit;
      continue;
    }

    if (implicit) result[name] = implicit;
  }

  return result;
}

/**
 * OAS 3.1 default content type for a property with no explicit
 * encoding. Walks composition and resolves `$ref` through the
 * registry. Returns null if the property schema is absent or a
 * boolean schema (effectively "any").
 */
function implicitEssence(
  propSchema: Schema | ReferenceObject | undefined,
  registry: SchemaRegistry,
): MediaTypeEssence | null {
  const resolved = dereference(propSchema, registry);
  if (!resolved) return null;

  if (isBinaryByEncoding(resolved)) return OCTET_STREAM_ESSENCE;

  if (isObjectSchema(resolved) || effectiveType(resolved) === "object") {
    return JSON_ESSENCE;
  }

  if (effectiveType(resolved) === "array") {
    const items = effectiveItems(resolved);
    const itemSchema = dereference(items ?? undefined, registry);
    if (!itemSchema) return TEXT_PLAIN_ESSENCE;
    if (isBinaryByEncoding(itemSchema)) return OCTET_STREAM_ESSENCE;
    // OAS 3.1: "array of primitives" -> text/plain. Anything else
    // (array of objects, array of arrays, array of composition
    // values) is a complex value -> application/json.
    const itemType = effectiveType(itemSchema);
    if (itemType === "object" || itemType === "array") return JSON_ESSENCE;
    if (isObjectSchema(itemSchema)) return JSON_ESSENCE;
    return TEXT_PLAIN_ESSENCE;
  }

  return TEXT_PLAIN_ESSENCE;
}

/**
 * `format: "binary"` or `contentEncoding` both indicate the value is
 * raw bytes. Either triggers `application/octet-stream` per OAS 3.1.
 */
function isBinaryByEncoding(schema: Schema): boolean {
  return schema.format === "binary" || schema.contentEncoding !== undefined;
}

/**
 * Follow a `$ref` through the registry to its target schema. Inline
 * schemas pass through unchanged. Returns undefined when the target
 * does not resolve to a schema object (e.g. a boolean schema or a
 * dangling reference).
 */
function dereference(
  value: SchemaObject | ReferenceObject | undefined,
  registry: SchemaRegistry,
): SchemaObject | undefined {
  if (!value) return undefined;
  if (!isReference(value)) return value;
  const resolved = registry.resolveRef(value.$ref);
  if (!resolved) return undefined;
  if (typeof resolved.raw === "boolean") return undefined;
  return resolved.raw;
}
