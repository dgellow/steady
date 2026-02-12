/**
 * Top-level diagnostic engine — coordinates route matching, parameter
 * presence checking, body validation, and spec issue detection.
 *
 * The engine works against a SpecDocument abstraction, not raw OpenAPI
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
import type { PathsObject } from "@steady/openapi";
import type { Diagnostic, DiagnosticLocation } from "../diagnostic.ts";
import type { SpecResolver, ValidationNode } from "./types.ts";
import { type ECode, getCode } from "../codes/registry.ts";
import { matchRoute } from "./routing.ts";
import { interpret } from "./interpreter.ts";

// ── Interfaces ─────────────────────────────────────────────────────

/** Structured access to an OpenAPI spec document. */
export interface SpecDocument {
  /** All path templates, for routing. */
  readonly paths: PathsObject;

  /**
   * Resolved parameters for a matched route.
   * Merges path-level and operation-level. Resolves $refs.
   * Path parameters have required: true (implicit per OpenAPI spec).
   */
  getParameters(pathPattern: string, method: string): ResolvedParameter[];

  /**
   * Body schema for a matched route. null if no request body defined.
   * Resolves $refs in the request body.
   */
  getBodySchema(pathPattern: string, method: string): BodySchemaInfo | null;

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
  schemaPath: string | null;
}

/** Body schema and its location in the spec. */
export interface BodySchemaInfo {
  schema: Schema;
  /** JSON pointer to the body schema in the spec. */
  schemaPath: string;
  /** Whether the request body is required (requestBody.required in OpenAPI). */
  required: boolean;
}

/** Validates data against a JSON Schema, producing a validation tree. */
export interface SchemaValidator {
  /**
   * Validate data against a schema, return a validation tree.
   * @param data - The value to validate
   * @param schema - The resolved JSON Schema
   * @param schemaPath - JSON pointer to the schema (for tree node schemaPath fields)
   * @param dataPath - Location prefix for tree node path fields (e.g., "body")
   */
  validate(
    data: unknown,
    schema: Schema,
    schemaPath: string,
    dataPath: string,
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
}

// ── Engine ──────────────────────────────────────────────────────────

export class DiagnosticEngine {
  private readonly spec: SpecDocument;
  private readonly validator: SchemaValidator;
  private readonly specResolver: SpecResolver;

  constructor(spec: SpecDocument, validator: SchemaValidator) {
    this.spec = spec;
    this.validator = validator;
    this.specResolver = {
      resolve: (path: string) => this.spec.resolveSchema(path),
    };
  }

  analyze(request: AnalyzeRequest): Diagnostic[] {
    // 1. Route matching
    const route = matchRoute(this.spec.paths, {
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
    for (const param of parameters) {
      const present = isParameterPresent(param, request);

      if (!present) {
        if (param.required) {
          diagnostics.push(
            createMissingParamDiagnostic(param, pathPattern),
          );
        }
        continue;
      }

      // Value validation: if param has a schema and is present, validate
      if (param.schema && param.schemaPath) {
        const rawValue = getParameterValue(param, request);
        if (rawValue !== undefined) {
          const coerced = coerceParameterValue(rawValue, param.schema);
          const location: DiagnosticLocation = param.in;
          const dataPath = `${param.in}.${param.name}`;

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

    // 3.5 Unknown query parameter detection
    if (request.queryParams) {
      const specParamNames = new Set(
        parameters.filter((p) => p.in === "query").map((p) => p.name),
      );
      const seen = new Set<string>();
      for (const key of request.queryParams.keys()) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (specParamNames.has(key)) continue;

        const baseName = extractBaseName(key);

        if (baseName !== key && specParamNames.has(baseName)) {
          diagnostics.push(
            createSerializationMismatchDiagnostic(
              key,
              baseName,
              pathPattern,
            ),
          );
        } else if (!specParamNames.has(baseName)) {
          diagnostics.push(
            createUndocumentedParamDiagnostic(key, pathPattern),
          );
        }
      }
    }

    // 4. Content-Type validation
    const acceptedTypes = this.spec.getAcceptedContentTypes(
      pathPattern,
      method,
    );
    if (acceptedTypes) {
      const contentType = getContentType(request.headers);
      if (contentType) {
        const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
        if (
          mediaType && !acceptedTypes.some((t) => t.toLowerCase() === mediaType)
        ) {
          diagnostics.push(
            createWrongContentTypeDiagnostic(
              pathPattern,
              method,
              mediaType,
              acceptedTypes,
            ),
          );
        }
      }
    }

    // 5. Body validation
    const bodyInfo = this.spec.getBodySchema(pathPattern, method);
    if (bodyInfo) {
      if (request.body === undefined) {
        // Body not provided — E3005 if required, skip validation otherwise
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
          "body",
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
 * Check if a required parameter is present in the request.
 *
 * - query: checks URLSearchParams.has()
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
    specPointer: `#/paths/${escapeJsonPointer(pathPattern)}`,
    message: `Missing required ${param.in} parameter: ${param.name}`,
    attribution: {
      confidence: 0.9,
      reasoning: [
        `${param.in} parameter "${param.name}" is required but not present in the request`,
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
    specPointer: `#/paths/${
      escapeJsonPointer(pathPattern)
    }/${method}/requestBody`,
    message:
      `Operation ${method.toUpperCase()} ${pathPattern} requires a request body`,
    attribution: {
      confidence: 0.95,
      reasoning: [
        "requestBody.required is true in the spec, but no body was sent",
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
    specPointer: `#/paths/${
      escapeJsonPointer(pathPattern)
    }/${method}/responses`,
    message:
      `Operation ${method.toUpperCase()} ${pathPattern} has no response definitions`,
    attribution: {
      confidence: 1.0,
      reasoning: [
        "Operation has no responses object defined in the spec",
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
    specPointer: `#/paths/${
      escapeJsonPointer(pathPattern)
    }/${method}/requestBody/content`,
    message: `Content-Type "${actualType}" is not accepted. Expected: ${
      acceptedTypes.join(", ")
    }`,
    expected: acceptedTypes,
    actual: actualType,
    attribution: {
      confidence: 0.95,
      reasoning: [
        `Request Content-Type "${actualType}" does not match any accepted type in the spec`,
      ],
    },
  };
}

/**
 * Extract the Content-Type header value (case-insensitive).
 */
function getContentType(
  headers: Record<string, string> | undefined,
): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "content-type") return value;
  }
  return undefined;
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

function escapeJsonPointer(path: string): string {
  return path.replace(/~/g, "~0").replace(/\//g, "~1");
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
 * Coerce a raw HTTP parameter string into the type expected by the schema.
 *
 * HTTP parameters are always strings. When the schema expects integer,
 * number, or boolean, the engine must parse the string before validation.
 * If parsing fails, the raw string is returned — the validator will
 * produce the type mismatch diagnostic.
 */
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
    specPointer: `#/paths/${escapeJsonPointer(pathPattern)}`,
    message:
      `Query parameter "${actualKey}" looks like a serialization of "${baseName}" - check the encoding format`,
    expected: baseName,
    actual: actualKey,
    suggestion:
      `The spec defines "${baseName}" but the SDK sent "${actualKey}". Check the SDK's query parameter serialization format`,
    attribution: {
      confidence: 0.7,
      reasoning: [
        `"${actualKey}" appears to be a serialized form of the known parameter "${baseName}"`,
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
    specPointer: `#/paths/${escapeJsonPointer(pathPattern)}`,
    message: `Query parameter "${key}" is not defined in the spec`,
    actual: key,
    attribution: {
      confidence: 0.5,
      reasoning: [
        `"${key}" does not match any declared query parameter for this operation`,
      ],
    },
  };
}

function coerceParameterValue(raw: string, schema: Schema): unknown {
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
