/**
 * Top-level diagnostic engine. Coordinates route matching, parameter
 * presence checking, body validation, and spec issue detection.
 *
 * The engine works against a Spec abstraction, not raw OpenAPI
 * types. It asks structured questions ("what are the required parameters?")
 * rather than parsing spec objects directly.
 *
 * Flow:
 *   1. Route matching → E2001/E2002 if no match
 *   2. Runtime spec issues → E1010 if no responses
 *   3. Parameter presence → E3002/E3004/E3007 for missing required params
 *   4. Content-Type validation → E3006 if wrong Content-Type
 *   5. Body validation → SchemaValidator + interpret()
 *   6. Return all diagnostics
 */

import type { Schema } from "@steady/json-schema";
import { effectiveType, isObjectSchema } from "@steady/json-schema";
import type { MediaTypeEssence } from "@steady/media-type";
import {
  formatFragmentPointer,
  type FragmentPointer,
} from "@steady/json-pointer";
import type { Diagnostic, DiagnosticLocation } from "../diagnostic.ts";
import type { QueryArrayFormat, QueryObjectFormat } from "../types.ts";
import type {
  ConcreteArrayFormat,
  ConcreteObjectFormat,
} from "../param-format.ts";
import { wrapURLSearchParams } from "../param-format.ts";
import type { SpecResolver, ValidationNode } from "./types.ts";
import { type ECode, getCode } from "../codes/registry.ts";
import { essenceMatches, getMediaType, parseAccept } from "../media-type.ts";
import type { Router } from "../router.ts";
import { interpret } from "./interpreter.ts";
import {
  deserializeNonQueryParam,
  getExpectedQueryKeys,
  parseQueryParam,
} from "./parameter-parser.ts";

// ── Interfaces ─────────────────────────────────────────────────────

/** Structured access to an OpenAPI spec document. */
export interface Spec {
  /**
   * Resolved parameters for a matched route.
   * Merges path-level and operation-level. Resolves $refs.
   * Path parameters have required: true (implicit per OpenAPI spec).
   */
  getParameters(pathPattern: string, method: string): ResolvedParameter[];

  /**
   * Body schema for a matched route at a specific content type.
   * null if no requestBody or no matching content type entry.
   * Resolves $refs in the request body.
   */
  getBodySchema(
    pathPattern: string,
    method: string,
    contentType: string,
  ): BodySchemaInfo | null;

  /**
   * Whether the operation has response definitions.
   * Returns false when responses is empty/missing (E1010).
   */
  hasResponses(pathPattern: string, method: string): boolean;

  /**
   * Accepted content types for a request body.
   * Returns the keys of requestBody.content, or null if no requestBody.
   */
  getAcceptedContentTypes(pathPattern: string, method: string): string[] | null;

  /**
   * Resolve a schema by its JSON pointer in the spec.
   * Used to create a SpecResolver for the interpreter.
   */
  resolveSchema(schemaPath: string): Schema;
}

/** A parameter definition resolved from the spec. */
export interface ResolvedParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: Schema | null;
  /** JSON pointer to this parameter's schema. null if no schema. */
  schemaPath: FragmentPointer | null;
  /** OpenAPI style (form, spaceDelimited, pipeDelimited, deepObject). */
  style?: string;
  /** OpenAPI explode flag. */
  explode?: boolean;
}

/** Body schema and its location in the spec. */
export interface BodySchemaInfo {
  schema: Schema;
  /** JSON pointer to the body schema in the spec. */
  schemaPath: FragmentPointer;
  /** Whether the request body is required (requestBody.required in OpenAPI). */
  required: boolean;
  /**
   * Per-property content type map for multipart request bodies.
   * Populated only when the matched media type is `multipart/form-data`.
   * Values are parsed `MediaTypeEssence` so consumers classify with
   * `@steady/media-type` predicates instead of re-parsing strings.
   */
  partContentTypes?: Record<string, MediaTypeEssence>;
}

/** Validates data against a JSON Schema, producing a validation tree. */
export interface SchemaValidator {
  /**
   * Validate data against a schema, return a validation tree.
   * @param data - The value to validate
   * @param schema - The resolved JSON Schema
   * @param schemaPath - JSON pointer to the schema (for tree node schemaPath fields)
   * @param dataPath - Location prefix for tree node path fields (e.g., ["body"])
   */
  validate(
    data: unknown,
    schema: Schema | boolean,
    schemaPath: FragmentPointer,
    dataPath: string[],
  ): ValidationNode;
}

/** Input to the engine's analyze method. */
export interface AnalyzeRequest {
  path: string;
  method: string;
  queryParams?: URLSearchParams;
  headers?: Record<string, string>;
  pathParams?: Record<string, string>;
  body?: unknown;
  /** Effective query array format (already merged by caller). Defaults to "auto". */
  queryArrayFormat?: QueryArrayFormat;
  /** Effective query object format (already merged by caller). Defaults to "auto". */
  queryObjectFormat?: QueryObjectFormat;
  /** Query keys consumed during route disambiguation (e.g., /files?download vs /files?upload). */
  consumedQueryParams?: string[];
  /** Effective form array format for multipart/urlencoded bodies. */
  formArrayFormat?: ConcreteArrayFormat;
  /** Effective form object format for multipart/urlencoded bodies. */
  formObjectFormat?: ConcreteObjectFormat;
  /** Raw form entry key names (with duplicates) for format mismatch detection. */
  rawFormKeys?: string[];
}

// ── Engine ──────────────────────────────────────────────────────────

export class DiagnosticEngine {
  private readonly spec: Spec;
  private readonly validator: SchemaValidator;
  private readonly specResolver: SpecResolver;
  private readonly router: Router;

  constructor(spec: Spec, validator: SchemaValidator, router: Router) {
    this.spec = spec;
    this.validator = validator;
    this.router = router;
    this.specResolver = {
      resolve: (path) => this.spec.resolveSchema(path),
    };
  }

  analyze(request: AnalyzeRequest): Diagnostic[] {
    // 1. Route matching (uses the shared pre-compiled Router)
    const route = this.router.match({
      path: request.path,
      method: request.method,
      queryParams: request.queryParams,
    });

    if (!route.matched) {
      return route.diagnostics;
    }

    const { pathPattern } = route;
    const method = request.method.toLowerCase();
    const diagnostics: Diagnostic[] = [];

    // 2. Runtime spec issues
    if (!this.spec.hasResponses(pathPattern, method)) {
      diagnostics.push(
        createMissingResponsesDiagnostic(pathPattern, method),
      );
    }

    // 3. Parameter presence + value validation
    const parameters = this.spec.getParameters(pathPattern, method);
    const queryArrayFormat = request.queryArrayFormat ?? "auto";
    const queryObjectFormat = request.queryObjectFormat ?? "auto";
    const querySource = request.queryParams
      ? wrapURLSearchParams(request.queryParams)
      : undefined;

    for (const param of parameters) {
      if (param.in === "query") {
        // Format-aware query parameter parsing
        if (!querySource) {
          if (param.required) {
            diagnostics.push(
              createMissingParamDiagnostic(param, pathPattern),
            );
          }
          continue;
        }

        const parsed = parseQueryParam(
          querySource,
          param,
          queryArrayFormat,
          queryObjectFormat,
        );

        if (!parsed.present) {
          if (param.required) {
            diagnostics.push(
              createMissingParamDiagnostic(param, pathPattern),
            );
          }
          continue;
        }

        // Value validation
        if (param.schema && param.schemaPath && parsed.value !== undefined) {
          const location: DiagnosticLocation = "query";
          const dataPath = ["query", param.name];

          const tree = this.validator.validate(
            parsed.value,
            param.schema,
            param.schemaPath,
            dataPath,
          );

          if (!tree.valid) {
            const result = interpret(
              tree,
              this.specResolver,
              location,
              parsed.value,
            );
            diagnostics.push(...result.diagnostics);
          }
        }
      } else {
        // Header, path, cookie: scalar logic (no format serialization)
        const present = isParameterPresent(param, request);

        if (!present) {
          if (param.required) {
            diagnostics.push(
              createMissingParamDiagnostic(param, pathPattern),
            );
          }
          continue;
        }

        if (param.schema && param.schemaPath) {
          const rawValue = getParameterValue(param, request);
          if (rawValue !== undefined) {
            const coerced = deserializeNonQueryParam(rawValue, param);
            const location: DiagnosticLocation = param.in;
            const dataPath = [param.in, param.name];

            const tree = this.validator.validate(
              coerced,
              param.schema,
              param.schemaPath,
              dataPath,
            );

            if (!tree.valid) {
              const result = interpret(
                tree,
                this.specResolver,
                location,
                coerced,
              );
              diagnostics.push(...result.diagnostics);
            }
          }
        }
      }
    }

    // 3.5 Unknown query parameter detection
    if (request.queryParams) {
      const { known, dynamicPrefixes } = getExpectedQueryKeys(
        parameters,
        queryArrayFormat,
        queryObjectFormat,
      );

      // Route-disambiguation keys (e.g., ?download) are not spec parameters
      // but were consumed during routing. Exclude them from unknown-param checks.
      if (request.consumedQueryParams) {
        for (const key of request.consumedQueryParams) {
          known.add(key);
        }
      }
      const seen = new Set<string>();
      for (const key of request.queryParams.keys()) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (known.has(key)) continue;

        // Check dynamic prefixes (brackets, dots)
        let matchesPrefix = false;
        for (const prefix of dynamicPrefixes) {
          if (key.startsWith(prefix)) {
            matchesPrefix = true;
            break;
          }
        }
        if (matchesPrefix) continue;

        const baseName = extractBaseName(key);

        if (baseName !== key && known.has(baseName)) {
          diagnostics.push(
            createSerializationMismatchDiagnostic(
              key,
              baseName,
              pathPattern,
            ),
          );
        } else {
          diagnostics.push(
            createUndocumentedParamDiagnostic(key, pathPattern),
          );
        }
      }
    }

    // 3.6 Form array/object format mismatch detection
    if (request.rawFormKeys && request.formArrayFormat) {
      const contentType = getHeaderValue(request.headers, "content-type");
      const formEssence = contentType ? getMediaType(contentType) : null;
      const bodyInfo = this.spec.getBodySchema(
        pathPattern,
        method,
        formEssence ?? "multipart/form-data",
      );
      if (bodyInfo) {
        const bodySchema = this.specResolver.resolve(bodyInfo.schemaPath);
        const schemaProps = (bodySchema && typeof bodySchema === "object" &&
            "properties" in bodySchema)
          ? bodySchema.properties
          : undefined;

        if (schemaProps && typeof schemaProps === "object") {
          const knownProps = new Set(Object.keys(schemaProps));
          const formArrayFormat = request.formArrayFormat;
          const formObjectFormat = request.formObjectFormat ?? "flat";

          // Track which (baseName → axis) pairs we already flagged to avoid
          // duplicate diagnostics when a key matches both axes.
          const flagged = new Set<string>();

          // Detect bracket/dot notation on bare keys; which axis to report
          // depends on whether the SDK was likely trying to serialise an
          // array (array axis) or an object (object axis).
          const seen = new Set<string>();
          for (const key of request.rawFormKeys) {
            if (seen.has(key)) continue;
            seen.add(key);
            const detected = detectKeyFormat(key);
            if (!detected) continue;
            const baseName = extractBaseName(key);
            if (!knownProps.has(baseName)) continue;

            const axis = resolveFormatAxis(
              schemaProps[baseName],
              this.specResolver,
            );
            const configured = axis === "object"
              ? formObjectFormat
              : formArrayFormat;
            if (configured === detected) continue;

            const dedupeKey = `${axis}:${baseName}`;
            if (flagged.has(dedupeKey)) continue;
            flagged.add(dedupeKey);

            diagnostics.push(
              createFormFormatMismatchDiagnostic({
                actualKey: key,
                baseName,
                detectedFormat: detected,
                configuredFormat: configured,
                axis,
                pathPattern,
              }),
            );
          }

          // Detect bare repeated keys when array format is brackets.
          if (formArrayFormat === "brackets") {
            const keyCounts = new Map<string, number>();
            for (const key of request.rawFormKeys) {
              keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
            }
            for (const [key, count] of keyCounts) {
              if (count <= 1) continue;
              if (extractBaseName(key) !== key) continue;
              if (!knownProps.has(key)) continue;
              diagnostics.push(
                createFormFormatMismatchDiagnostic({
                  actualKey: `${key} (repeated ${count} times)`,
                  baseName: key,
                  detectedFormat: "repeat",
                  configuredFormat: formArrayFormat,
                  axis: "array",
                  pathPattern,
                }),
              );
            }
          }
        }
      }
    }

    // 4. Content-Type validation
    const contentType = getHeaderValue(request.headers, "content-type");
    const essence = contentType ? getMediaType(contentType) : null;
    if (contentType) {
      if (!essence) {
        diagnostics.push(
          createMalformedContentTypeDiagnostic(contentType),
        );
      } else {
        const acceptedTypes = this.spec.getAcceptedContentTypes(
          pathPattern,
          method,
        );
        if (acceptedTypes) {
          const acceptedEssences = acceptedTypes.flatMap((t) => {
            const e = getMediaType(t);
            return e ? [e] : [];
          });
          if (
            !acceptedEssences.some((a) => essenceMatches(essence, a))
          ) {
            diagnostics.push(
              createWrongContentTypeDiagnostic(
                pathPattern,
                method,
                essence,
                acceptedTypes,
              ),
            );
          }
        }
      }
    }

    // 4b. Accept header validation
    const acceptHeader = getHeaderValue(request.headers, "accept");
    if (acceptHeader) {
      if (parseAccept(acceptHeader).length === 0) {
        diagnostics.push(
          createMalformedAcceptDiagnostic(acceptHeader),
        );
      }
    }

    // 5. Body validation
    const bodyInfo = this.spec.getBodySchema(
      pathPattern,
      method,
      essence ?? "application/json",
    );
    if (bodyInfo) {
      if (request.body === undefined) {
        // Body not provided. E3005 if required, skip validation otherwise
        if (bodyInfo.required) {
          diagnostics.push(
            createMissingBodyDiagnostic(pathPattern, method),
          );
        }
      } else {
        const tree = this.validator.validate(
          request.body,
          bodyInfo.schema,
          bodyInfo.schemaPath,
          ["body"],
        );

        if (!tree.valid) {
          const result = interpret(
            tree,
            this.specResolver,
            "body",
            request.body,
          );
          diagnostics.push(...result.diagnostics);
        }
      }
    }

    // 6. Return all diagnostics
    return diagnostics;
  }
}

// ── Parameter presence ─────────────────────────────────────────────

/**
 * Check if a non-query parameter is present in the request.
 * Query params are handled by parseQueryParam in parameter-parser.ts.
 *
 * - header: case-insensitive key lookup
 * - path: always present after successful routing
 * - cookie: parses Cookie header for the named cookie
 */
function isParameterPresent(
  param: ResolvedParameter,
  request: AnalyzeRequest,
): boolean {
  switch (param.in) {
    case "query":
      // Should not be called for query params; handled by parseQueryParam
      return request.queryParams?.has(param.name) ?? false;

    case "header": {
      if (!request.headers) return false;
      const lowerName = param.name.toLowerCase();
      return Object.keys(request.headers).some(
        (key) => key.toLowerCase() === lowerName,
      );
    }

    case "path":
      // Path params are always present after routing
      return true;

    case "cookie": {
      const cookies = parseCookieHeader(request.headers);
      return cookies.has(param.name);
    }
  }
}

// ── Diagnostic creation ────────────────────────────────────────────

/** Map parameter location to the E-code for a missing required parameter. */
function missingParamCode(location: ResolvedParameter["in"]): ECode {
  switch (location) {
    case "query":
      return "E3002";
    case "header":
      return "E3004";
    default:
      return "E3007"; // cookie (and body, though body has its own path)
  }
}

/**
 * Create a diagnostic for a missing required parameter.
 */
function createMissingParamDiagnostic(
  param: ResolvedParameter,
  pathPattern: string,
): Diagnostic {
  const code = missingParamCode(param.in);
  const codeInfo = getCode(code);

  return {
    code,
    severity: codeInfo.severity,
    category: codeInfo.category,
    requestPath: `${param.in}.${param.name}`,
    specPointer: formatFragmentPointer(["paths", pathPattern]),
    message: `Missing required ${param.in} parameter: ${param.name}`,
    attribution: {
      confidence: 1.0,
      reasoning: [
        `${
          capitalize(param.in)
        } parameter '${param.name}' is marked required in the spec`,
        `Request did not include ${param.in} parameter '${param.name}'`,
      ],
    },
  };
}

/**
 * Create an E3005 diagnostic for a missing required request body.
 */
function createMissingBodyDiagnostic(
  pathPattern: string,
  method: string,
): Diagnostic {
  const e3005 = getCode("E3005");

  return {
    code: "E3005",
    severity: e3005.severity,
    category: e3005.category,
    requestPath: "body",
    specPointer: formatFragmentPointer([
      "paths",
      pathPattern,
      method,
      "requestBody",
    ]),
    message:
      `Operation ${method.toUpperCase()} ${pathPattern} requires a request body`,
    attribution: {
      confidence: 1.0,
      reasoning: [
        `Operation ${method.toUpperCase()} ${pathPattern} has requestBody.required: true`,
        "Request did not include a body",
      ],
    },
  };
}

/**
 * Create an E1010 diagnostic for an operation with no response definitions.
 *
 * Convention: requestPath is empty string for diagnostics that don't relate
 * to a specific request location (e.g., E1010 missing responses).
 */
function createMissingResponsesDiagnostic(
  pathPattern: string,
  method: string,
): Diagnostic {
  const e1010 = getCode("E1010");

  return {
    code: "E1010",
    severity: e1010.severity,
    category: e1010.category,
    requestPath: `${method.toUpperCase()} ${pathPattern}`,
    specPointer: formatFragmentPointer([
      "paths",
      pathPattern,
      method,
      "responses",
    ]),
    message:
      `Operation ${method.toUpperCase()} ${pathPattern} has no response definitions`,
    attribution: {
      confidence: 1.0,
      reasoning: [
        `Operation ${method.toUpperCase()} ${pathPattern} has no responses object in the spec`,
        "Cannot generate a mock response without response definitions",
      ],
    },
  };
}

/**
 * Create an E3006 diagnostic for a wrong Content-Type.
 */
function createWrongContentTypeDiagnostic(
  pathPattern: string,
  method: string,
  actualType: string,
  acceptedTypes: string[],
): Diagnostic {
  const e3006 = getCode("E3006");

  return {
    code: "E3006",
    severity: e3006.severity,
    category: e3006.category,
    requestPath: "header.content-type",
    specPointer: formatFragmentPointer([
      "paths",
      pathPattern,
      method,
      "requestBody",
      "content",
    ]),
    message: `Content-Type "${actualType}" is not accepted. Expected: ${
      acceptedTypes.join(", ")
    }`,
    expected: acceptedTypes,
    actual: actualType,
    attribution: {
      confidence: 1.0,
      reasoning: [
        `Spec accepts: ${acceptedTypes.join(", ")}`,
        `Request sent Content-Type "${actualType}"`,
      ],
    },
  };
}

/**
 * Extract a header value by name (case-insensitive).
 */
function getHeaderValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Create an E3020 diagnostic for a malformed Content-Type header.
 */
function createMalformedContentTypeDiagnostic(
  rawContentType: string,
): Diagnostic {
  const def = getCode("E3020");

  return {
    code: "E3020",
    severity: def.severity,
    category: def.category,
    requestPath: "header.content-type",
    specPointer: "",
    message:
      `Content-Type "${rawContentType}" is not a valid media type. Expected a type/subtype format like "application/json"`,
    actual: rawContentType,
    attribution: {
      confidence: 1.0,
      reasoning: [
        `Content-Type header value "${rawContentType}" cannot be parsed as a media type`,
      ],
    },
    suggestion:
      "Check the SDK's Content-Type header. It should follow the type/subtype format (e.g. application/json)",
  };
}

/**
 * Create an E3022 diagnostic for a fully malformed Accept header.
 */
function createMalformedAcceptDiagnostic(
  rawAccept: string,
): Diagnostic {
  const def = getCode("E3022");

  return {
    code: "E3022",
    severity: def.severity,
    category: def.category,
    requestPath: "header.accept",
    specPointer: "",
    message:
      `Accept header "${rawAccept}" contains no valid media types. Content negotiation will use the server default`,
    actual: rawAccept,
    attribution: {
      confidence: 1.0,
      reasoning: [
        `Accept header "${rawAccept}" has no parseable media type entries`,
      ],
    },
    suggestion:
      "Check the SDK's Accept header. It should contain type/subtype values like application/json or */*",
  };
}

/**
 * Parse the Cookie header into a name→value map.
 * Cookie header format (RFC 6265): "name1=value1; name2=value2"
 */
function parseCookieHeader(
  headers: Record<string, string> | undefined,
): Map<string, string> {
  if (!headers) return new Map();

  // Case-insensitive lookup for Cookie header
  let cookieHeader: string | undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "cookie") {
      cookieHeader = value;
      break;
    }
  }

  if (!cookieHeader) return new Map();

  const cookies = new Map<string, string>();
  for (const pair of cookieHeader.split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const name = pair.substring(0, eqIndex).trim();
    const value = pair.substring(eqIndex + 1).trim();
    if (name) cookies.set(name, value);
  }

  return cookies;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Parameter value extraction ──────────────────────────────────────

/**
 * Extract the raw string value of a parameter from the request.
 * Returns undefined if the parameter is not present.
 */
function getParameterValue(
  param: ResolvedParameter,
  request: AnalyzeRequest,
): string | undefined {
  switch (param.in) {
    case "query":
      return request.queryParams?.get(param.name) ?? undefined;

    case "header": {
      if (!request.headers) return undefined;
      const lowerName = param.name.toLowerCase();
      for (const [key, value] of Object.entries(request.headers)) {
        if (key.toLowerCase() === lowerName) return value;
      }
      return undefined;
    }

    case "path":
      return request.pathParams?.[param.name];

    case "cookie": {
      const cookies = parseCookieHeader(request.headers);
      return cookies.get(param.name);
    }
  }
}

/**
 * Extract the base name from a serialized query parameter key.
 * "items[]" → "items", "user.name" → "user", "user[name]" → "user"
 * If no serialization suffix is found, returns the key unchanged.
 */
function extractBaseName(key: string): string {
  // Bracket notation: items[] or user[name]
  const bracketIndex = key.indexOf("[");
  if (bracketIndex > 0) return key.slice(0, bracketIndex);

  // Dot notation: user.name
  const dotIndex = key.indexOf(".");
  if (dotIndex > 0) return key.slice(0, dotIndex);

  return key;
}

/**
 * Create an E3014 diagnostic for a parameter serialization mismatch.
 */
function createSerializationMismatchDiagnostic(
  actualKey: string,
  baseName: string,
  pathPattern: string,
): Diagnostic {
  const e3014 = getCode("E3014");

  return {
    code: "E3014",
    severity: e3014.severity,
    category: e3014.category,
    requestPath: `query.${actualKey}`,
    specPointer: formatFragmentPointer(["paths", pathPattern]),
    message:
      `Query parameter "${actualKey}" looks like a serialization of "${baseName}" - check the encoding format`,
    expected: baseName,
    actual: actualKey,
    suggestion:
      `The spec defines "${baseName}" but the SDK sent "${actualKey}". Check the SDK's query parameter serialization format`,
    attribution: {
      confidence: 0.7,
      reasoning: [
        `Spec defines parameter '${baseName}'`,
        `Request sent '${actualKey}', which looks like a serialized form of '${baseName}'`,
      ],
    },
  };
}

/**
 * Classify a form key's wire notation by looking for the first
 * serialization marker in the key. Returns null if the key has no
 * recognisable nesting syntax.
 */
function detectKeyFormat(key: string): "brackets" | "dots" | null {
  const bracketIndex = key.indexOf("[");
  const dotIndex = key.indexOf(".");
  if (bracketIndex > 0 && (dotIndex < 0 || bracketIndex < dotIndex)) {
    return "brackets";
  }
  if (dotIndex > 0) return "dots";
  return null;
}

/**
 * Decide which format-flag axis applies to a schema property: object
 * format for object-typed properties, array format otherwise.
 *
 * Walks composition (allOf/anyOf/oneOf) via `effectiveType` /
 * `isObjectSchema` so that a property like
 * `{ allOf: [{ type: "object", ... }] }` is correctly routed to the
 * object axis.
 *
 * A $ref that hasn't been resolved (no resolver surfaced the target)
 * is assumed to be an object. This keeps nested refs on the object
 * axis; the wrong axis is less useful than the right one, and most
 * $refs in multipart bodies point at object schemas.
 */
function resolveFormatAxis(
  propSchema: unknown,
  resolver: SpecResolver,
): "object" | "array" {
  if (!propSchema || typeof propSchema !== "object") return "array";
  const schema = propSchema as Schema;

  // Unresolved $ref: try to resolve via the spec resolver, otherwise
  // default to the object axis (most multipart complex props are objects).
  if ("$ref" in schema && typeof schema.$ref === "string") {
    const resolved = resolver.resolve(schema.$ref as FragmentPointer);
    if (resolved && typeof resolved !== "boolean") {
      return isObjectSchema(resolved) ? "object" : "array";
    }
    return "object";
  }

  if (isObjectSchema(schema)) return "object";
  if (effectiveType(schema) === "object") return "object";
  return "array";
}

interface FormFormatMismatchInput {
  actualKey: string;
  baseName: string;
  detectedFormat: "brackets" | "dots" | "repeat";
  configuredFormat: ConcreteArrayFormat | ConcreteObjectFormat;
  axis: "array" | "object";
  pathPattern: string;
}

/**
 * Create an E3023 diagnostic for a form field serialization mismatch on
 * either the array or object axis.
 */
function createFormFormatMismatchDiagnostic(
  input: FormFormatMismatchInput,
): Diagnostic {
  const {
    actualKey,
    baseName,
    detectedFormat,
    configuredFormat,
    axis,
    pathPattern,
  } = input;
  const e3023 = getCode("E3023");
  const flag = axis === "object"
    ? "--validator-form-object-format"
    : "--validator-form-array-format";
  const label = axis === "object" ? "formObjectFormat" : "formArrayFormat";

  return {
    code: "E3023",
    severity: e3023.severity,
    category: e3023.category,
    requestPath: `body.${baseName}`,
    specPointer: formatFragmentPointer(["paths", pathPattern]),
    message:
      `Form field "${actualKey}" uses ${detectedFormat} encoding, but ${label} is "${configuredFormat}"`,
    expected: configuredFormat,
    actual: detectedFormat,
    suggestion:
      `Set ${flag}=${detectedFormat} to match the SDK encoding, or update the SDK to use ${configuredFormat} format`,
    attribution: {
      confidence: 0.8,
      reasoning: [
        `Configured ${label}: '${configuredFormat}'`,
        `Request sent '${actualKey}', which uses ${detectedFormat} encoding`,
      ],
    },
  };
}

/**
 * Create an E3015 diagnostic for an undocumented query parameter.
 */
function createUndocumentedParamDiagnostic(
  key: string,
  pathPattern: string,
): Diagnostic {
  const e3015 = getCode("E3015");

  return {
    code: "E3015",
    severity: e3015.severity,
    category: e3015.category,
    requestPath: `query.${key}`,
    specPointer: formatFragmentPointer(["paths", pathPattern]),
    message: `Query parameter "${key}" is not defined in the spec`,
    actual: key,
    attribution: {
      confidence: 0.5,
      reasoning: [
        `Query parameter '${key}' is not declared in the spec for this operation`,
        "Could be: undocumented parameter, or SDK sending extra fields",
      ],
    },
  };
}
