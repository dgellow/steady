/**
 * Shared parameter format parsing logic
 *
 * Used by both query parameter validation and form data parsing.
 * Handles array and object serialization formats per OpenAPI spec.
 */

import type { QueryArrayFormat, QueryObjectFormat } from "./types.ts";
import { isPlainObject } from "@steady/json-pointer";
import {
  coerceFormValue,
  effectiveItems,
  effectiveProperties,
  isArraySchema,
  isObjectSchema,
} from "@steady/json-schema";
import type { Schema } from "@steady/json-schema";

// Re-export types for convenience
export type { QueryArrayFormat, QueryObjectFormat };

/**
 * Concrete format types (excludes 'auto')
 */
export type ConcreteArrayFormat = Exclude<QueryArrayFormat, "auto">;
export type ConcreteObjectFormat = Exclude<QueryObjectFormat, "auto">;

/**
 * A parameter's wire encoding, determined by (schema type + format flags).
 *
 * This is the single decision point for how a parameter appears on the wire.
 * All consumers (presence detection, parsing, expected-key registration) use
 * this instead of independently branching on isArray/isObject + format.
 */
export type ParamEncoding =
  | { kind: "scalar" }
  | { kind: "flat-array"; arrayFmt: ConcreteArrayFormat }
  | { kind: "flat-object"; objectFmt: "flat" | "flat-comma" }
  | { kind: "nested"; objectFmt: "dots" | "brackets" };

/**
 * Determine how a parameter is encoded on the wire.
 *
 * This is the single decision point that combines schema type and format
 * flags into an encoding kind. All consumers (presence detection, parsing,
 * expected-key registration) use this instead of independently branching
 * on isArray/isObject + format.
 */
export function resolveParamEncoding(
  schema: Schema | null,
  arrayFmt: ConcreteArrayFormat,
  objectFmt: ConcreteObjectFormat,
): ParamEncoding {
  if (!schema || typeof schema === "boolean") return { kind: "scalar" };

  const isArray = isArraySchema(schema);
  const isObject = isObjectSchema(schema);

  // Nested formats (dots, brackets) produce prefixed keys for objects
  // and arrays of objects. Arrays of scalars use flat array encoding.
  const nestedFmt = objectFmt === "dots" || objectFmt === "brackets";
  if (nestedFmt && isObject) {
    return { kind: "nested", objectFmt };
  }
  if (nestedFmt && isArray) {
    const items = effectiveItems(schema);
    if (items && typeof items !== "boolean" && isObjectSchema(items)) {
      return { kind: "nested", objectFmt };
    }
  }

  // Flat object formats
  if (isObject && (objectFmt === "flat" || objectFmt === "flat-comma")) {
    return { kind: "flat-object", objectFmt };
  }

  // Flat array formats
  if (isArray) {
    return { kind: "flat-array", arrayFmt };
  }

  return { kind: "scalar" };
}

/**
 * Interface for key-value pair sources (URLSearchParams, FormData entries, etc.)
 */
export interface KeyValueSource {
  entries(): Iterable<[string, string]>;
  get(key: string): string | null;
  getAll(key: string): string[];
}

/**
 * Wrap URLSearchParams to implement KeyValueSource
 */
export function wrapURLSearchParams(params: URLSearchParams): KeyValueSource {
  return {
    entries: () => params.entries(),
    get: (key) => params.get(key),
    getAll: (key) => params.getAll(key),
  };
}

/**
 * Wrap a Map<string, string[]> to implement KeyValueSource
 */
export function wrapStringMap(map: Map<string, string[]>): KeyValueSource {
  return {
    entries: function* () {
      for (const [key, values] of map) {
        for (const value of values) {
          yield [key, value] as [string, string];
        }
      }
    },
    get: (key) => map.get(key)?.[0] ?? null,
    getAll: (key) => map.get(key) ?? [],
  };
}

// =============================================================================
// Format Resolution (auto -> concrete)
// =============================================================================

/**
 * Resolve array format from 'auto' to concrete format based on parameter spec.
 * When format is 'auto', reads from OpenAPI style/explode properties.
 */
export function resolveArrayFormat(
  format: QueryArrayFormat,
  style?: string,
  explode?: boolean,
): ConcreteArrayFormat {
  if (format !== "auto") {
    return format;
  }

  const s = style ?? "form";
  const e = explode ?? (s === "form");

  switch (s) {
    case "form":
      return e ? "repeat" : "comma";
    case "spaceDelimited":
      return "space";
    case "pipeDelimited":
      return "pipe";
    default:
      return "repeat";
  }
}

/**
 * Resolve object format from 'auto' to concrete format based on OpenAPI
 * style/explode. When format is not 'auto', returns it directly.
 */
export function resolveObjectFormat(
  format: QueryObjectFormat,
  style?: string,
  explode?: boolean,
): ConcreteObjectFormat {
  if (format !== "auto") {
    return format;
  }

  const s = style ?? "form";
  const e = explode ?? (s === "form");

  switch (s) {
    case "form":
      return e ? "flat" : "flat-comma";
    case "deepObject":
      return "brackets";
    default:
      return "flat";
  }
}

// =============================================================================
// Array Parsing
// =============================================================================

/**
 * Get array values from key-value source based on format.
 *
 * @param source - Key-value pair source
 * @param name - Parameter name
 * @param format - Array serialization format (must be concrete, not 'auto')
 * @returns Array of string values
 */
export function getArrayValues(
  source: KeyValueSource,
  name: string,
  format: ConcreteArrayFormat,
): string[] {
  switch (format) {
    case "repeat":
      // colors=red&colors=green
      return source.getAll(name);
    case "comma": {
      // colors=red,green,blue
      const value = source.get(name);
      return value ? value.split(",") : [];
    }
    case "space": {
      // colors=red%20green%20blue
      const value = source.get(name);
      return value ? value.split(" ") : [];
    }
    case "pipe": {
      // colors=red|green|blue
      const value = source.get(name);
      return value ? value.split("|") : [];
    }
    case "brackets": {
      // colors[]=red&colors[]=green
      return source.getAll(`${name}[]`);
    }
  }
}

/**
 * Check if a parameter has a value in the source.
 */
export function hasParamValue(
  source: KeyValueSource,
  name: string,
  encoding: ParamEncoding,
): boolean {
  switch (encoding.kind) {
    case "scalar":
      return source.get(name) !== null;

    case "flat-array":
      return getArrayValues(source, name, encoding.arrayFmt).length > 0;

    case "flat-object":
      if (encoding.objectFmt === "flat") {
        return source.get(name) !== null;
      }
      // flat-comma: value must contain a comma
      {
        const value = source.get(name);
        return value !== null && value.includes(",");
      }

    case "nested": {
      const prefix = encoding.objectFmt === "dots" ? `${name}.` : `${name}[`;
      for (const [key] of source.entries()) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    }
  }
}

// =============================================================================
// Nested Array Parsing
// =============================================================================

/**
 * Parse an array of objects from prefixed query keys.
 *
 * Handles two encoding patterns:
 *
 * 1. Repeated keys (repeat + dots/brackets):
 *    search.field=a&search.op=eq&search.field=b&search.op=ne
 *    -> [{field: "a", op: "eq"}, {field: "b", op: "ne"}]
 *
 *    Keys repeat for each array item. Items are reconstructed by grouping
 *    values positionally: the Nth occurrence of each key belongs to item N.
 *
 * 2. Single item (same encoding, single occurrence):
 *    search.field=a&search.op=eq
 *    -> [{field: "a", op: "eq"}]
 *
 * Returns an empty array if no prefixed keys are found.
 */
export function parseNestedArrayValues(
  source: KeyValueSource,
  name: string,
): Record<string, unknown>[] {
  const prefix = `${name}.`;

  // Collect all prefixed entries in order, extracting the sub-path
  const entries: { path: string[]; value: string }[] = [];
  for (const [key, value] of source.entries()) {
    if (!key.startsWith(prefix)) continue;
    const path = key.slice(prefix.length).split(".");
    entries.push({ path, value });
  }

  if (entries.length === 0) return [];

  // Check if the first path segment is numeric (indexed encoding).
  // Indexed: search.0.field=a  -> path ["0", "field"]
  // Flat:    search.field=a    -> path ["field"]
  const firstSegment = entries[0]?.path[0];
  if (firstSegment !== undefined && isNumericString(firstSegment)) {
    return parseIndexedEntries(entries);
  }

  return parseRepeatedEntries(entries);
}

/**
 * Parse indexed entries: search.0.field=a&search.0.op=eq&search.1.field=b
 * Path segments start with a numeric index.
 */
function parseIndexedEntries(
  entries: { path: string[]; value: string }[],
): Record<string, unknown>[] {
  const byIndex = new Map<number, { path: string[]; value: string }[]>();
  for (const entry of entries) {
    const indexStr = entry.path[0];
    if (indexStr === undefined) continue;
    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) continue;
    const group = byIndex.get(index) ?? [];
    group.push({ path: entry.path.slice(1), value: entry.value });
    byIndex.set(index, group);
  }

  const result: Record<string, unknown>[] = [];
  for (const idx of [...byIndex.keys()].sort((a, b) => a - b)) {
    const group = byIndex.get(idx);
    if (!group) continue;
    const obj: Record<string, unknown> = Object.create(null);
    for (const entry of group) {
      setNestedValue(obj, entry.path, entry.value);
    }
    result.push(obj);
  }
  return result;
}

/**
 * Parse repeated entries: search.field=a&search.op=eq&search.field=b&search.op=ne
 * Same property keys repeat for each item. Group by position.
 */
function parseRepeatedEntries(
  entries: { path: string[]; value: string }[],
): Record<string, unknown>[] {
  // Track occurrence count per top-level key to assign items by position
  const keyCounts = new Map<string, number>();
  const itemEntries = new Map<number, { path: string[]; value: string }[]>();

  for (const entry of entries) {
    const topKey = entry.path[0];
    if (topKey === undefined) continue;
    const count = keyCounts.get(topKey) ?? 0;
    keyCounts.set(topKey, count + 1);

    const group = itemEntries.get(count) ?? [];
    group.push(entry);
    itemEntries.set(count, group);
  }

  const result: Record<string, unknown>[] = [];
  for (const idx of [...itemEntries.keys()].sort((a, b) => a - b)) {
    const group = itemEntries.get(idx);
    if (!group) continue;
    const obj: Record<string, unknown> = Object.create(null);
    for (const entry of group) {
      setNestedValue(obj, entry.path, entry.value);
    }
    result.push(obj);
  }
  return result;
}

// =============================================================================
// Object Parsing
// =============================================================================

/**
 * Set a value at a nested path in an object.
 * Creates intermediate objects/arrays as needed.
 *
 * Safe from prototype pollution when obj is created with Object.create(null).
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  if (path.length === 0) return;

  let current: unknown = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const nextSegment = path[i + 1];

    if (segment === undefined || nextSegment === undefined) continue;

    if (isPlainObject(current)) {
      // Ensure container exists at this segment
      if (!(segment in current)) {
        current[segment] = isNumericString(nextSegment)
          ? []
          : Object.create(null);
      }
      const next = current[segment];
      if (typeof next !== "object" || next === null) {
        current[segment] = isNumericString(nextSegment)
          ? []
          : Object.create(null);
      }
      current = current[segment];
    } else if (Array.isArray(current)) {
      const idx = parseInt(segment, 10);
      if (isNaN(idx) || idx < 0) break;
      current = current[idx];
    } else {
      break;
    }
  }

  // Set the final value
  const lastKey = path[path.length - 1];
  if (lastKey !== undefined) {
    if (isPlainObject(current)) {
      current[lastKey] = value;
    } else if (Array.isArray(current)) {
      const idx = parseInt(lastKey, 10);
      if (!isNaN(idx) && idx >= 0) {
        current[idx] = value;
      }
    }
  }
}

/**
 * Check if a string is a numeric index (for array detection)
 */
export function isNumericString(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * Parse object parameter from key-value source based on format.
 * Returns a nested object structure.
 *
 * Note: This is the basic parsing without schema-based type coercion.
 * The caller should apply type coercion based on schema if needed.
 *
 * @param source - Key-value pair source
 * @param name - Parameter name (base name for nested formats)
 * @param format - Object serialization format (must be concrete, not 'auto')
 * @returns Parsed object
 */
export function parseObjectValue(
  source: KeyValueSource,
  name: string,
  format: ConcreteObjectFormat,
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);

  switch (format) {
    case "flat": {
      // In flat format, we can't know which top-level params belong to this object
      // without schema info. Return the single value if present.
      const value = source.get(name);
      if (value !== null) {
        result[name] = value;
      }
      return result;
    }

    case "flat-comma": {
      // id=role,admin,firstName,Alex -> {role: "admin", firstName: "Alex"}
      const value = source.get(name);
      if (!value) return result;

      const parts = value.split(",");
      for (let i = 0; i < parts.length - 1; i += 2) {
        const key = parts[i];
        const val = parts[i + 1];
        if (key !== undefined && val !== undefined) {
          result[key] = val;
        }
      }
      return result;
    }

    case "dots": {
      // id.role=admin&id.firstName=Alex -> {role: "admin", firstName: "Alex"}
      const prefix = `${name}.`;

      for (const [key, value] of source.entries()) {
        if (key.startsWith(prefix)) {
          const path = key.slice(prefix.length).split(".");
          if (path.length > 0) {
            setNestedValue(result, path, value);
          }
        }
      }
      return result;
    }

    case "brackets":
      // Brackets format is handled by parseFormEntries
      return result;
  }
}

// =============================================================================
// Form Entry Parsing: Schema-Driven Tree Builder
// =============================================================================

/** Combined array + object format descriptor for form entry parsing. */
export interface FormFormat {
  array: ConcreteArrayFormat;
  object: ConcreteObjectFormat;
}

/** A single segment in a structured key path. */
export type KeySegment =
  | { type: "key"; name: string }
  | { type: "index"; index: number }
  | { type: "append" };

/**
 * Parse a raw form key into typed segments based on the active format.
 *
 * The object format decides how the key is split into a path. The array
 * format decides whether a trailing `[]` is recognised as an append marker
 * (only under the `brackets` array format; otherwise it is treated as a
 * literal part of the key).
 *
 * Examples (objectFmt=brackets):
 *   "name"           -> [key("name")]
 *   "tags[]"         -> [key("tags"), append]
 *   "assoc[][id]"    -> [key("assoc"), append, key("id")]
 *   "items[0][name]" -> [key("items"), index(0), key("name")]
 *
 * Examples (objectFmt=dots):
 *   "user.name"      -> [key("user"), key("name")]
 *   "user.tags[]"    -> (arrayFmt=brackets) [key("user"), key("tags"), append]
 *
 * Examples (objectFmt=flat):
 *   "user.name"      -> [key("user.name")]
 *   "tags[]"         -> (arrayFmt=brackets) [key("tags"), append]
 */
export function parseKeySegments(
  rawKey: string,
  objectFmt: ConcreteObjectFormat,
  arrayFmt: ConcreteArrayFormat,
): KeySegment[] {
  // Strip trailing `[]` as an explicit append marker when the array format
  // is brackets. Other array formats treat `[]` as literal.
  let key = rawKey;
  let explicitAppend = false;
  if (arrayFmt === "brackets" && key.endsWith("[]")) {
    key = key.slice(0, -2);
    explicitAppend = true;
  }

  const base = parseKeyByObjectFormat(key, objectFmt);
  return explicitAppend ? [...base, { type: "append" }] : base;
}

function parseKeyByObjectFormat(
  key: string,
  objectFmt: ConcreteObjectFormat,
): KeySegment[] {
  switch (objectFmt) {
    case "flat":
    case "flat-comma":
      return key.length > 0 ? [{ type: "key", name: key }] : [];

    case "brackets":
      return parseBracketKey(key);

    case "dots": {
      if (key.length === 0) return [];
      return key.split(".").map((name) => ({ type: "key", name }));
    }
  }
}

function parseBracketKey(key: string): KeySegment[] {
  const match = key.match(/^([^[]+)(.*)/);
  if (!match || match[1] === undefined) {
    return key.length > 0 ? [{ type: "key", name: key }] : [];
  }

  const segments: KeySegment[] = [{ type: "key", name: match[1] }];
  const rest = match[2] ?? "";
  const bracketRegex = /\[([^\]]*)\]/g;
  let bracketMatch: RegExpExecArray | null;

  while ((bracketMatch = bracketRegex.exec(rest)) !== null) {
    const content = bracketMatch[1];
    if (content === undefined) continue;

    if (content === "") {
      segments.push({ type: "append" });
    } else if (isNumericString(content)) {
      segments.push({ type: "index", index: parseInt(content, 10) });
    } else {
      segments.push({ type: "key", name: content });
    }
  }

  return segments;
}

/** A form entry with parsed segments and its raw value. */
export interface KeyEntry {
  segments: KeySegment[];
  value: string | File;
}

/** Callback to resolve $ref schemas. */
export type RefResolver = (schema: Schema) => Schema | undefined;

/** Resolve a schema, following $ref if present. */
function resolve(
  schema: Schema | null | undefined,
  resolver?: RefResolver,
): Schema | undefined {
  if (schema === null || schema === undefined) return undefined;
  if (typeof schema === "boolean") return undefined;
  if ("$ref" in schema && typeof schema.$ref === "string" && resolver) {
    return resolver(schema) ?? undefined;
  }
  return schema;
}

/** Coerce a terminal value using the schema, or return as-is. */
function coerceLeaf(value: string | File, schema: Schema | null): unknown {
  if (value instanceof File) return value;
  return coerceFormValue(value, schema ?? true);
}

/**
 * Parse form entries into a structured object tree, guided by schema.
 *
 * Single entry point for all form entry parsing: multipart form data,
 * URL-encoded bodies, and nested query parameters. The format descriptor
 * decides both how keys are split into segments and how values are
 * coalesced at terminal positions.
 */
export function parseFormEntries(
  rawEntries: Iterable<[string, string | File]>,
  schema: Schema | null,
  format: FormFormat,
  resolver?: RefResolver,
): Record<string, unknown> {
  const entries: KeyEntry[] = [];
  for (const [rawKey, value] of rawEntries) {
    const segments = parseKeySegments(rawKey, format.object, format.array);
    if (segments.length > 0) {
      entries.push({ segments, value });
    }
  }
  return assembleObject(entries, schema, format, resolver);
}

/**
 * Recursive core: assemble a value from form entries guided by schema.
 *
 * Structure comes from two signals:
 *   - The key segments (append/index → array, key → object, empty →
 *     terminal) always win when present.
 *   - At the terminal (bare-entry) position, the active array format and
 *     the schema decide whether to coalesce as scalar or array.
 *
 * In brackets array format, bare repeated keys are scalars (last wins)
 * because the format distinguishes arrays by an explicit `[]`/`[N]`
 * marker. In every other array format, bare repeated entries or an
 * array-typed schema produce an array; comma format splits a single
 * terminal string on commas.
 */
function assembleValue(
  entries: KeyEntry[],
  schema: Schema | null,
  format: FormFormat,
  resolver?: RefResolver,
): unknown {
  if (entries.length === 0) return undefined;

  const resolved = resolve(schema, resolver) ?? null;

  // Terminal: all entries have no remaining segments.
  if (entries.every((e) => e.segments.length === 0)) {
    return assembleTerminal(entries, resolved, format, resolver);
  }

  // Non-terminal: check the first segment to determine structure.
  // Only append ([]) and index ([N]) produce arrays. Property-access
  // keys always produce objects, regardless of schema.
  const firstSeg = entries[0]?.segments[0];
  if (firstSeg && (firstSeg.type === "append" || firstSeg.type === "index")) {
    const items = resolved ? effectiveItems(resolved) : null;
    const resolvedItems = resolve(items, resolver) ?? null;
    return assembleArray(entries, resolvedItems, format, resolver);
  }

  return assembleObject(entries, resolved, format, resolver);
}

/**
 * Terminal coalescing. All entries are at their leaf position; decide
 * scalar vs array based on array format and schema.
 */
function assembleTerminal(
  entries: KeyEntry[],
  resolved: Schema | null,
  format: FormFormat,
  resolver?: RefResolver,
): unknown {
  // Brackets array format: bare repeated keys are scalars (last wins).
  // Arrays are only produced via explicit `[]` or `[N]` markers, which
  // would have been handled as non-terminal above.
  if (format.array === "brackets") {
    const last = entries[entries.length - 1];
    return last ? coerceLeaf(last.value, resolved) : undefined;
  }

  const schemaIsArray = resolved !== null && isArraySchema(resolved);

  // Comma format: a single terminal string value on an array-typed schema
  // splits on commas into array items.
  if (
    format.array === "comma" &&
    entries.length === 1 &&
    schemaIsArray
  ) {
    const entry = entries[0]!;
    if (typeof entry.value === "string") {
      const itemSchema = resolve(effectiveItems(resolved!), resolver) ?? null;
      const parts = entry.value.split(",").map((p) => p.trim());
      return parts.map((p) => coerceLeaf(p, itemSchema));
    }
  }

  // Array if the schema says array, or if there are multiple repeated
  // entries for the same bare key (only possible in non-brackets array
  // formats that accept repetition, e.g. `repeat`).
  if (schemaIsArray || entries.length > 1) {
    const itemSchema = schemaIsArray
      ? (resolve(effectiveItems(resolved!), resolver) ?? null)
      : resolved;
    return entries.map((e) => coerceLeaf(e.value, itemSchema));
  }

  // Scalar
  const first = entries[0];
  return first ? coerceLeaf(first.value, resolved) : undefined;
}

/**
 * Assemble an array value. Only called when the first segment is
 * append ([]) or index ([N]).
 */
function assembleArray(
  entries: KeyEntry[],
  itemSchema: Schema | null,
  format: FormFormat,
  resolver?: RefResolver,
): unknown[] {
  if (entries.length === 0) return [];

  const first = entries[0]?.segments[0];
  if (!first) return entries.map((e) => coerceLeaf(e.value, itemSchema));

  if (first.type === "index") {
    return assembleIndexedArray(entries, itemSchema, format, resolver);
  }

  if (first.type === "append") {
    const stripped = entries.map((e) => ({
      segments: e.segments.slice(1),
      value: e.value,
    }));
    if (stripped.every((e) => e.segments.length === 0)) {
      return stripped.map((e) => coerceLeaf(e.value, itemSchema));
    }
    return groupAppendEntries(stripped, itemSchema, format, resolver);
  }

  return [];
}

/** Group entries by explicit numeric index. */
function assembleIndexedArray(
  entries: KeyEntry[],
  itemSchema: Schema | null,
  format: FormFormat,
  resolver?: RefResolver,
): unknown[] {
  const byIndex = new Map<number, KeyEntry[]>();
  for (const entry of entries) {
    const seg = entry.segments[0];
    if (!seg || seg.type !== "index") continue;
    const group = byIndex.get(seg.index) ?? [];
    group.push({ segments: entry.segments.slice(1), value: entry.value });
    byIndex.set(seg.index, group);
  }

  const result: unknown[] = [];
  for (const idx of [...byIndex.keys()].sort((a, b) => a - b)) {
    const group = byIndex.get(idx);
    if (group) result.push(assembleValue(group, itemSchema, format, resolver));
  }
  return result;
}

/**
 * Group append entries into array elements by detecting property boundaries.
 * A new element starts when a sub-path that was already set on the current
 * element appears again (Rack semantics): `a[][meta][x]` and `a[][meta][y]`
 * belong to the same element, while a second `a[][meta][x]` starts a new one.
 * Sub-paths containing a nested append (`a[][tags][]`) accumulate into the
 * current element and never start a new one.
 */
function groupAppendEntries(
  entries: KeyEntry[],
  itemSchema: Schema | null,
  format: FormFormat,
  resolver?: RefResolver,
): unknown[] {
  const elements: KeyEntry[][] = [[]];
  const seen = new Set<string>();

  for (const entry of entries) {
    const seg = entry.segments[0];
    if (!seg || seg.type !== "key") continue;

    const hasNestedAppend = entry.segments.some((s) => s.type === "append");
    const path = entry.segments
      .map((s) =>
        s.type === "key" ? s.name : s.type === "index" ? String(s.index) : "[]"
      )
      .join(".");

    if (!hasNestedAppend) {
      if (seen.has(path)) {
        elements.push([]);
        seen.clear();
      }
      seen.add(path);
    }
    const current = elements[elements.length - 1];
    if (current) current.push(entry);
  }

  return elements
    .filter((g) => g.length > 0)
    .map((group) => assembleValue(group, itemSchema, format, resolver));
}

/** Assemble an object by grouping entries by first key segment. */
function assembleObject(
  entries: KeyEntry[],
  schema: Schema | null,
  format: FormFormat,
  resolver?: RefResolver,
): Record<string, unknown> {
  const resolved = (schema && typeof schema !== "boolean") ? schema : null;
  const props = resolved ? effectiveProperties(resolved) : null;

  const groups = new Map<string, KeyEntry[]>();
  for (const entry of entries) {
    const seg = entry.segments[0];
    if (!seg || seg.type !== "key") continue;
    const group = groups.get(seg.name) ?? [];
    group.push({ segments: entry.segments.slice(1), value: entry.value });
    groups.set(seg.name, group);
  }

  // Keys not declared in `properties` fall back to the `additionalProperties`
  // schema (when it's a schema object) so map values still get type coercion.
  const additional = resolved && isPlainObject(resolved.additionalProperties)
    ? resolved.additionalProperties as Schema
    : null;

  const result: Record<string, unknown> = Object.create(null);
  for (const [key, subEntries] of groups) {
    const propSchema = resolve(props?.[key] ?? additional, resolver) ?? null;
    result[key] = assembleValue(subEntries, propSchema, format, resolver);
  }
  return result;
}
