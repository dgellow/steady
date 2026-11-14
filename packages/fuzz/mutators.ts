/**
 * Mutation strategies for fuzz testing.
 *
 * Each mutator is an object with an `id` and an `apply` method.
 * `apply` takes an OperationInfo and a valid baseline FuzzRequest,
 * then returns MutatedCase[] where exactly one thing is broken.
 * If the mutator doesn't apply, it returns [].
 */

import {
  effectiveProperties,
  effectiveRequired,
  isSchema,
} from "@steady/json-schema";
import type { Schema } from "@steady/json-schema";
import { getOwn, isPlainObject } from "@steady/json-pointer";
import { essenceMatches, getMediaType } from "@steady/media-type";
import type { FuzzRequest, MutatedCase, Mutator } from "./types.ts";

function cloneRequest(req: FuzzRequest): FuzzRequest {
  return {
    path: req.path,
    method: req.method,
    headers: { ...req.headers },
    query: { ...req.query },
    body: req.body !== undefined ? structuredClone(req.body) : undefined,
  };
}

// Deno.serve (and many HTTP servers) silently strip request bodies from
// GET and HEAD requests before the handler sees them. Body mutations on
// these methods are untestable and always produce false positives.
const BODY_STRIPPED_METHODS = new Set(["get", "head"]);

// ── Mutators ──────────────────────────────────────────────────────

export const removeRequiredQueryParam: Mutator = {
  id: "removeRequiredQueryParam",
  apply(op, baseline) {
    const cases: MutatedCase[] = [];
    for (const param of op.queryParams) {
      if (!param.required) continue;
      // Skip params used for route disambiguation. Removing them changes which
      // operation the router matches, not just the validation outcome.
      if (op.routingQueryParams?.has(param.name)) continue;
      const req = cloneRequest(baseline);
      delete req.query[param.name];
      cases.push({
        mutation: `remove required query param '${param.name}'`,
        request: req,
        expectedCodes: ["E3002"],
        detail: { location: "query" },
      });
    }
    return cases;
  },
};

// Headers that the fetch() API manages automatically. Removing these from
// the headers object has no effect on the wire, so mutations targeting
// them would always be false positives.
const FETCH_MANAGED_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "content-length",
  "host",
  "transfer-encoding",
  "user-agent",
]);

export const removeRequiredHeaderParam: Mutator = {
  id: "removeRequiredHeaderParam",
  apply(op, baseline) {
    const cases: MutatedCase[] = [];
    for (const param of op.headerParams) {
      if (!param.required) continue;
      if (FETCH_MANAGED_HEADERS.has(param.name.toLowerCase())) continue;
      const req = cloneRequest(baseline);
      const lowerName = param.name.toLowerCase();
      for (const key of Object.keys(req.headers)) {
        if (key.toLowerCase() === lowerName) {
          delete req.headers[key];
        }
      }
      cases.push({
        mutation: `remove required header '${param.name}'`,
        request: req,
        expectedCodes: ["E3004"],
        detail: { location: "header" },
      });
    }
    return cases;
  },
};

export const wrongContentType: Mutator = {
  id: "wrongContentType",
  apply(op, baseline) {
    if (!op.bodyInfo) return [];
    if (BODY_STRIPPED_METHODS.has(op.method)) return [];
    if (op.bodyInfo.contentTypes.length === 0) return [];

    const accepted = op.bodyInfo.contentTypes;
    const wrong = getMediaType("text/plain");
    if (!wrong || accepted.some((a) => essenceMatches(wrong, a))) return [];

    const req = cloneRequest(baseline);
    req.headers["content-type"] = wrong;

    return [{
      mutation: `wrong Content-Type: '${wrong}' instead of '${
        op.bodyInfo.contentTypes[0]
      }'`,
      request: req,
      expectedCodes: ["E3006"],
      detail: { location: "contentType" },
    }];
  },
};

export const omitRequiredBody: Mutator = {
  id: "omitRequiredBody",
  apply(op, baseline) {
    if (!op.bodyInfo) return [];
    if (BODY_STRIPPED_METHODS.has(op.method)) return [];
    if (!op.bodyInfo.required) return [];

    const req = cloneRequest(baseline);
    delete req.body;
    delete req.headers["content-type"];

    return [{
      mutation: "omit required request body",
      request: req,
      expectedCodes: ["E3005"],
      detail: { location: "body" },
    }];
  },
};

// FIXME: `effectiveRequired` returns the raw union of required names
// across allOf, including entries that are absent from
// `effectiveProperties`. Such "phantom required" entries are a spec
// bug (E1016 catches them at startup) but they survive to this
// mutator and generate noise mutations that delete a field the
// baseline never had. Filter `requiredFields` against
// `effectiveProperties(schema)` here to match the generator's
// treatment in `schema-registry.ts:generateObject`. A better long-term
// fix is to make the filter part of `effectiveRequired`'s contract,
// but that change has its own blast radius.
export const omitRequiredBodyField: Mutator = {
  id: "omitRequiredBodyField",
  apply(op, baseline) {
    if (!op.bodyInfo) return [];
    if (BODY_STRIPPED_METHODS.has(op.method)) return [];
    const schema = op.bodyInfo.schema;
    const requiredFields = effectiveRequired(schema);
    if (requiredFields.length === 0) return [];
    if (!isPlainObject(baseline.body)) return [];

    const cases: MutatedCase[] = [];
    for (const field of requiredFields) {
      const req = cloneRequest(baseline);
      if (isPlainObject(req.body)) {
        delete req.body[field];
      }
      // readOnly fields are excluded from required checks during request
      // validation, so omitting them should be accepted as valid.
      const readOnly = isReadOnlyField(schema, field);
      cases.push({
        mutation: `omit required body field '${field}'`,
        request: req,
        expectedCodes: readOnly ? [] : ["E3008"],
        detail: { location: "body", fieldDepth: 0 },
      });
    }
    return cases;
  },
};

export const wrongBodyFieldType: Mutator = {
  id: "wrongBodyFieldType",
  apply(op, baseline) {
    if (!op.bodyInfo) return [];
    if (BODY_STRIPPED_METHODS.has(op.method)) return [];
    // Use direct schema.properties (not effectiveProperties) because
    // properties found through oneOf/anyOf composition are variant-specific.
    // The "wrong type" value may match a different variant, producing
    // false positives. Direct properties are unambiguously typed.
    const properties = op.bodyInfo.schema.properties;
    if (!properties) return [];
    if (!isPlainObject(baseline.body)) return [];

    const cases: MutatedCase[] = [];
    for (const [field, propSchemaRaw] of Object.entries(properties)) {
      if (!isSchema(propSchemaRaw)) continue;
      // Use direct type for the same reason: effectiveType on a property
      // with anyOf/oneOf may resolve to a type from one variant, but the
      // "wrong" value for that type could be valid in another variant.
      const type = Array.isArray(propSchemaRaw.type)
        ? propSchemaRaw.type[0]
        : propSchemaRaw.type;
      if (!type) continue;

      const wrongValue = getWrongTypeValue(type);
      if (wrongValue === undefined) continue;

      const req = cloneRequest(baseline);
      if (isPlainObject(req.body)) {
        req.body[field] = wrongValue;
      }

      cases.push({
        mutation:
          `wrong type for body field '${field}': sent ${typeof wrongValue} instead of ${type}`,
        request: req,
        expectedCodes: ["E3008"],
        detail: { location: "body", fieldType: type, fieldDepth: 0 },
      });
    }
    return cases;
  },
};

export const extraProperty: Mutator = {
  id: "extraProperty",
  apply(op, baseline) {
    if (!op.bodyInfo) return [];
    if (BODY_STRIPPED_METHODS.has(op.method)) return [];
    if (op.bodyInfo.schema.additionalProperties !== false) return [];
    if (!isPlainObject(baseline.body)) return [];

    const req = cloneRequest(baseline);
    if (isPlainObject(req.body)) {
      req.body["__fuzz_extra_field__"] = "should-not-be-allowed";
    }

    return [{
      mutation: "add extra property when additionalProperties: false",
      request: req,
      expectedCodes: ["E3009"],
      detail: { location: "body" },
    }];
  },
};

export const wrongEnumValue: Mutator = {
  id: "wrongEnumValue",
  apply(op, baseline) {
    if (!op.bodyInfo) return [];
    if (BODY_STRIPPED_METHODS.has(op.method)) return [];
    // Same reasoning as wrongBodyFieldType: only target properties
    // with unambiguous enum constraints at the root level.
    const properties = op.bodyInfo.schema.properties;
    if (!properties) return [];
    if (!isPlainObject(baseline.body)) return [];

    const cases: MutatedCase[] = [];
    for (const [field, propSchemaRaw] of Object.entries(properties)) {
      if (!isSchema(propSchemaRaw)) continue;
      if (!propSchemaRaw.enum || propSchemaRaw.enum.length === 0) continue;

      const req = cloneRequest(baseline);
      if (isPlainObject(req.body)) {
        req.body[field] = "__FUZZ_NOT_IN_ENUM__";
      }

      cases.push({
        mutation: `wrong enum value for body field '${field}'`,
        request: req,
        expectedCodes: ["E3011", "E3016"],
        detail: { location: "body" },
      });
    }
    return cases;
  },
};

/** All built-in mutators in priority order. */
export const ALL_MUTATORS: Mutator[] = [
  removeRequiredQueryParam,
  removeRequiredHeaderParam,
  wrongContentType,
  omitRequiredBody,
  omitRequiredBodyField,
  wrongBodyFieldType,
  extraProperty,
  wrongEnumValue,
];

// ── Helpers ───────────────────────────────────────────────────────

/** Check if a field in a schema is marked readOnly. */
function isReadOnlyField(
  schema: Schema,
  field: string,
): boolean {
  const props = effectiveProperties(schema);
  if (!props) return false;
  const propSchema = getOwn(props, field);
  if (!propSchema || typeof propSchema === "boolean") return false;
  return propSchema.readOnly === true;
}

function getWrongTypeValue(
  expectedType: string,
): string | number | boolean | unknown[] | Record<string, unknown> | undefined {
  switch (expectedType) {
    case "string":
      return 99999;
    case "integer":
    case "number":
      return "not-a-number";
    case "boolean":
      return "not-a-boolean";
    case "array":
      return "not-an-array";
    case "object":
      return "not-an-object";
    default:
      return undefined;
  }
}
