/**
 * Shape of a schema as it comes out of a parser.
 *
 * `Schema` declares the type of every keyword: `allOf` is an array of
 * schemas, `required` an array of strings, `pattern` a string. A parsed
 * document promises none of that. `allOf: 5` is valid JSON.
 *
 * `normalizeSchemaShape` is the boundary between the two. It checks every
 * keyword the code reads, in the schema and in all schemas below it. A
 * keyword of the wrong type is reported and removed, which makes it absent:
 * the one state every reader already handles. After it has run, the value
 * really is a `Schema`, and readers do not need to check again.
 *
 * Removing is deliberate. A keyword that cannot be read states no
 * constraint; dropping it keeps the rest of the schema usable, and the
 * report tells the author exactly what was dropped.
 */

import { isPlainObject, type PointerPath } from "@steady/json-pointer";

/** A value that does not have the type its position requires. */
export interface ShapeProblem {
  /** Where the value is. */
  path: PointerPath;
  /** What the position requires, e.g. "an array of schemas". */
  expected: string;
  /** What was found, e.g. "number". */
  actual: string;
  /**
   * Set when "expected X, found Y" does not describe the problem: the full
   * sentence to show instead.
   */
  message?: string;
}

export type ReportShapeProblem = (problem: ShapeProblem) => void;

/** JSON type name of a value, for messages. */
export function describeJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

type Check = (value: unknown) => boolean;

const isString: Check = (v) => typeof v === "string";
const isNumber: Check = (v) => typeof v === "number" && Number.isFinite(v);
const isBoolean: Check = (v) => typeof v === "boolean";
const isCount: Check = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
const isArray: Check = (v) => Array.isArray(v);
const isStringArray: Check = (v) => Array.isArray(v) && v.every(isString);
const isSchemaValue: Check = (v) => typeof v === "boolean" || isPlainObject(v);

/** Keywords whose value is checked and not looked into. */
const VALUE_KEYWORDS: Record<string, { check: Check; expected: string }> = {
  $ref: { check: isString, expected: "a string" },
  $id: { check: isString, expected: "a string" },
  $anchor: { check: isString, expected: "a string" },
  type: {
    check: (v) => isString(v) || isStringArray(v),
    expected: "a string or an array of strings",
  },
  enum: { check: isArray, expected: "an array" },
  required: { check: isStringArray, expected: "an array of strings" },
  pattern: { check: isString, expected: "a string" },
  format: { check: isString, expected: "a string" },
  multipleOf: { check: isNumber, expected: "a number" },
  maximum: { check: isNumber, expected: "a number" },
  minimum: { check: isNumber, expected: "a number" },
  // A boolean in OpenAPI 3.0, a number in 3.1.
  exclusiveMaximum: {
    check: (v) => isNumber(v) || isBoolean(v),
    expected: "a number or a boolean",
  },
  exclusiveMinimum: {
    check: (v) => isNumber(v) || isBoolean(v),
    expected: "a number or a boolean",
  },
  maxLength: { check: isCount, expected: "a non-negative integer" },
  minLength: { check: isCount, expected: "a non-negative integer" },
  maxItems: { check: isCount, expected: "a non-negative integer" },
  minItems: { check: isCount, expected: "a non-negative integer" },
  maxProperties: { check: isCount, expected: "a non-negative integer" },
  minProperties: { check: isCount, expected: "a non-negative integer" },
  maxContains: { check: isCount, expected: "a non-negative integer" },
  minContains: { check: isCount, expected: "a non-negative integer" },
  uniqueItems: { check: isBoolean, expected: "a boolean" },
  nullable: { check: isBoolean, expected: "a boolean" },
  readOnly: { check: isBoolean, expected: "a boolean" },
  writeOnly: { check: isBoolean, expected: "a boolean" },
  deprecated: { check: isBoolean, expected: "a boolean" },
  examples: { check: isArray, expected: "an array" },
  dependentRequired: {
    check: (v) => isPlainObject(v) && Object.values(v).every(isStringArray),
    expected: "an object of arrays of strings",
  },
  discriminator: {
    check: (v) =>
      isPlainObject(v) && typeof v.propertyName === "string" &&
      (v.mapping === undefined ||
        (isPlainObject(v.mapping) &&
          Object.values(v.mapping).every(isString))),
    expected:
      "an object with a string propertyName and an optional mapping of strings",
  },
};

/** Keywords whose value is one schema. */
const SCHEMA_KEYWORDS = [
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "contains",
  "contentSchema",
  "not",
  "if",
  "then",
  "else",
];

/** Keywords whose value is an array of schemas. */
const SCHEMA_ARRAY_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"];

/** Keywords whose value is an object of schemas. */
const SCHEMA_MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
];

/**
 * A location as a chain to its parent. Extending it is one allocation
 * whatever the depth; the full path is only built when a problem is
 * reported. Copying the path at every node would cost the depth of the
 * document per node.
 */
interface Location {
  parent: Location | null;
  segment: string;
}

function locationOf(path: PointerPath): Location | null {
  let location: Location | null = null;
  for (const segment of path) location = { parent: location, segment };
  return location;
}

function pathOf(location: Location | null): PointerPath {
  const path: string[] = [];
  for (let at = location; at !== null; at = at.parent) path.push(at.segment);
  return path.reverse();
}

const child = (parent: Location | null, segment: string): Location => ({
  parent,
  segment,
});

interface Pending {
  schema: Record<string, unknown>;
  at: Location | null;
}

/**
 * Check the schema held by `holder[key]` and every schema below it.
 *
 * A value that is not a schema (an object or a boolean) is reported and
 * removed from the holder. Returns whether a schema is left at the position.
 */
export function normalizeSchemaShape(
  holder: Record<string, unknown>,
  key: string,
  path: PointerPath,
  report: ReportShapeProblem,
): boolean {
  const start = locationOf(path);
  if (!keepSchema(holder, key, start, report)) return false;

  // Schemas still to look into. A loop, not recursion: the depth is the
  // nesting of the document.
  const pending: Pending[] = [];
  const first = holder[key];
  if (isPlainObject(first)) pending.push({ schema: first, at: start });

  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { schema, at } = item;

    for (const keyword of Object.keys(schema)) {
      if (!Object.hasOwn(VALUE_KEYWORDS, keyword)) continue;
      const rule = VALUE_KEYWORDS[keyword];
      if (rule !== undefined && !rule.check(schema[keyword])) {
        report({
          path: pathOf(child(at, keyword)),
          expected: rule.expected,
          actual: describeJsonType(schema[keyword]),
        });
        delete schema[keyword];
      }
    }

    for (const keyword of SCHEMA_KEYWORDS) {
      if (!Object.hasOwn(schema, keyword)) continue;
      const location = child(at, keyword);
      if (keepSchema(schema, keyword, location, report)) {
        const value = schema[keyword];
        if (isPlainObject(value)) pending.push({ schema: value, at: location });
      }
    }

    // `items` is one schema, or an array of them in drafts before 2020-12.
    if (Object.hasOwn(schema, "items")) {
      const location = child(at, "items");
      const items = schema.items;
      if (Array.isArray(items)) {
        keepSchemas(items, location, report, pending);
      } else if (keepSchema(schema, "items", location, report)) {
        if (isPlainObject(items)) pending.push({ schema: items, at: location });
      }
    }

    for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
      if (!Object.hasOwn(schema, keyword)) continue;
      const location = child(at, keyword);
      const list = schema[keyword];
      if (!Array.isArray(list)) {
        report({
          path: pathOf(location),
          expected: "an array of schemas",
          actual: describeJsonType(list),
        });
        delete schema[keyword];
        continue;
      }
      keepSchemas(list, location, report, pending);
    }

    for (const keyword of SCHEMA_MAP_KEYWORDS) {
      if (!Object.hasOwn(schema, keyword)) continue;
      const location = child(at, keyword);
      const map = schema[keyword];
      if (!isPlainObject(map)) {
        report({
          path: pathOf(location),
          expected: "an object of schemas",
          actual: describeJsonType(map),
        });
        delete schema[keyword];
        continue;
      }
      for (const name of Object.keys(map)) {
        const entry = child(location, name);
        if (keepSchema(map, name, entry, report)) {
          const value = map[name];
          if (isPlainObject(value)) pending.push({ schema: value, at: entry });
        }
      }
    }
  }

  return true;
}

/** Report and remove `holder[key]` unless it is an object or a boolean. */
function keepSchema(
  holder: Record<string, unknown>,
  key: string,
  at: Location | null,
  report: ReportShapeProblem,
): boolean {
  const value = holder[key];
  if (isSchemaValue(value)) return true;
  report({
    path: pathOf(at),
    expected: "a schema (an object or a boolean)",
    actual: describeJsonType(value),
  });
  delete holder[key];
  return false;
}

/**
 * Report and remove the entries of `list` that are not schemas, and queue
 * the object schemas that remain. Paths use the index before removal, which
 * is the index in the document.
 */
function keepSchemas(
  list: unknown[],
  at: Location | null,
  report: ReportShapeProblem,
  pending: Pending[],
): void {
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const entry = list[read];
    const location = child(at, String(read));
    if (!isSchemaValue(entry)) {
      report({
        path: pathOf(location),
        expected: "a schema (an object or a boolean)",
        actual: describeJsonType(entry),
      });
      continue;
    }
    list[write++] = entry;
    if (isPlainObject(entry)) pending.push({ schema: entry, at: location });
  }
  list.length = write;
}
