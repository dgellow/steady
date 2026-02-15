/**
 * Startup spec analyzer. Detects spec issues before serving requests.
 *
 * Single-pass analysis of a parsed OpenAPI spec, producing E1xxx diagnostics.
 * Runs at startup (before the server accepts requests) to catch spec problems
 * like unresolved $refs, circular references, duplicate paths, etc.
 */

import type { ComponentsObject, OpenAPISpec } from "@steady/openapi";
import { openapi31Metaschema } from "@steady/openapi";
import { resolve } from "@steady/json-pointer";
import { JsonSchemaProcessor, type Schema } from "@steady/json-schema";
import type { Diagnostic, DiagnosticDisplay } from "../diagnostic.ts";
import { type ECode, getCode, hasCode } from "../codes/registry.ts";

// ── Public interface ────────────────────────────────────────────────

export interface SpecAnalysisResult {
  diagnostics: Diagnostic[];
  /** True if any diagnostic has fatal: true in the registry. */
  fatal: boolean;
}

export interface AnalyzeSpecOptions {
  /** Base URI for resolving references during metaschema validation. */
  baseUri?: string;
  /** Fields where the parser applied defaults (triggers E1003 diagnostics). */
  defaultedFields?: string[];
}

/**
 * Analyze a parsed OpenAPI spec for structural issues.
 * Returns diagnostics and whether any are fatal (spec cannot be served).
 */
export async function analyzeSpec(
  spec: OpenAPISpec,
  options?: AnalyzeSpecOptions,
): Promise<SpecAnalysisResult> {
  const diagnostics: Diagnostic[] = [];

  // E1003: Missing metadata fields (parser applied defaults)
  if (options?.defaultedFields && options.defaultedFields.length > 0) {
    diagnostics.push(...checkMissingMetadata(options.defaultedFields));
  }

  // Metaschema validation for OpenAPI 3.1.x
  diagnostics.push(...await checkMetaschema(spec, options?.baseUri));

  diagnostics.push(...checkMultipleQuestionMarks(spec));
  diagnostics.push(...checkQuestionMarkInParams(spec));
  diagnostics.push(...checkDuplicatePathPatterns(spec));
  diagnostics.push(...checkDuplicatePathParamNames(spec));
  diagnostics.push(...checkMissingResponses(spec));
  diagnostics.push(...checkInvalidComponentNames(spec));

  // Single tree walk collects $ref info and schema pointers
  const walkResult = walkSpec(spec);
  diagnostics.push(...checkRefSiblings(spec, walkResult.refs));
  diagnostics.push(...checkUnresolvedRefs(spec, walkResult.refs));
  diagnostics.push(...checkCircularRefs(walkResult.refs, spec));
  diagnostics.push(
    ...checkImpossibleConstraints(walkResult.schemas),
  );
  diagnostics.push(
    ...checkRequiredNotInProperties(walkResult.schemas),
  );
  diagnostics.push(
    ...checkNonStandardUsage(walkResult.schemas, spec.openapi),
  );

  const fatal = diagnostics.some((d) => {
    if (!hasCode(d.code)) return false;
    return getCode(d.code).fatal === true;
  });

  return { diagnostics, fatal };
}

// ── Utilities ───────────────────────────────────────────────────────

/** Type guard: value is a plain object (not array, not null). */
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Safely read a numeric property from an unknown object. */
function numProp(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = obj[key];
  return typeof v === "number" ? v : undefined;
}

function escapeJsonPointer(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function specDiagnostic(
  code: ECode,
  specPointer: string,
  message: string,
  opts?: {
    suggestion?: string;
    expected?: unknown;
    actual?: unknown;
    confidence?: number;
    reasoning?: string[];
    display?: DiagnosticDisplay;
  },
): Diagnostic {
  const def = getCode(code);
  return {
    code,
    severity: def.severity,
    category: def.category,
    requestPath: "",
    specPointer,
    message,
    ...(opts?.expected !== undefined ? { expected: opts.expected } : {}),
    ...(opts?.actual !== undefined ? { actual: opts.actual } : {}),
    ...(opts?.suggestion ? { suggestion: opts.suggestion } : {}),
    ...(opts?.display ? { display: opts.display } : {}),
    attribution: {
      confidence: opts?.confidence ?? 1.0,
      reasoning: opts?.reasoning ?? [
        "Detected during spec analysis at startup",
      ],
    },
  };
}

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
] as const;

// ── E1003: Missing required metadata ─────────────────────────────────

function checkMissingMetadata(defaultedFields: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const field of defaultedFields) {
    diagnostics.push(
      specDiagnostic(
        "E1003",
        `#/${field.replace(/\./g, "/")}`,
        `Missing required field "${field}". Steady applied a default`,
        {
          suggestion: `Add the "${field}" field to your spec`,
          expected: field,
        },
      ),
    );
  }

  return diagnostics;
}

// ── Metaschema validation (E1006 fatal / E1015 info) ────────────────

const metaschema = openapi31Metaschema as unknown as Schema;

/**
 * Translate a metaschema keyword into a user-facing message.
 * Avoids "metaschema" jargon. Speaks in terms the spec author understands.
 */
function metaschemaMessage(keyword: string): string {
  switch (keyword) {
    case "unevaluatedProperties":
    case "unevaluatedItems":
      return `Keyword '${keyword}' is not recognized here`;
    case "additionalProperties":
      return "Unexpected property at this location in the spec";
    default:
      return `Keyword '${keyword}' is not recognized at this spec location`;
  }
}

/**
 * Run OpenAPI 3.1 metaschema validation, producing diagnostics.
 *
 * Fatal errors → E1006 (spec cannot be served).
 * Warnings → E1015 with user-centric messages pointing at the spec location.
 * Deduplicated by instancePath + keyword.
 */
async function checkMetaschema(
  spec: OpenAPISpec,
  baseUri?: string,
): Promise<Diagnostic[]> {
  if (!spec.openapi.startsWith("3.1.")) return [];

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(spec, { metaschema, baseUri });

  if (result.valid || result.errors.length === 0) return [];

  const diagnostics: Diagnostic[] = [];

  // Separate fatal errors from warnings
  const fatalErrors = result.errors.filter((e) => e.severity !== "warning");
  const warnings = result.errors.filter((e) => e.severity === "warning");

  // Fatal metaschema errors → E1006
  for (const error of fatalErrors) {
    const isRefError = error.type === "ref-not-found" ||
      error.keyword === "$ref" ||
      error.message.toLowerCase().includes("ref");

    diagnostics.push(
      specDiagnostic(
        "E1006",
        error.instancePath ? `#${error.instancePath}` : "#",
        isRefError
          ? `Invalid reference: ${error.message}`
          : `Invalid schema: ${error.message}`,
        {
          suggestion: error.suggestion,
        },
      ),
    );
  }

  // Warnings → E1015, deduplicated by instancePath + keyword
  const seen = new Set<string>();
  for (const warning of warnings) {
    const dedupeKey = `${warning.instancePath}|${warning.keyword}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const pointer = warning.instancePath ? `#${warning.instancePath}` : "#";

    diagnostics.push(
      specDiagnostic(
        "E1015",
        pointer,
        metaschemaMessage(warning.keyword),
        {
          suggestion:
            "Steady ignores unrecognized keywords, no impact on validation. Other OpenAPI tools may reject your spec",
        },
      ),
    );
  }

  return diagnostics;
}

// ── E1013: Multiple question marks in path ──────────────────────────

function checkMultipleQuestionMarks(spec: OpenAPISpec): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const path of Object.keys(spec.paths)) {
    const qCount = path.split("?").length - 1;
    if (qCount > 1) {
      diagnostics.push(
        specDiagnostic(
          "E1013",
          `#/paths/${escapeJsonPointer(path)}`,
          `Path "${path}" contains ${qCount} question marks`,
          {
            suggestion:
              "A path should have at most one '?' separating the path from query parameters",
          },
        ),
      );
    }
  }

  return diagnostics;
}

// ── E1014: Question mark in query parameter name/enum ───────────────

interface ResolvedParamInfo {
  name: string;
  in: string;
  schema?: { enum?: unknown[] };
}

function isResolvedParamInfo(v: unknown): v is ResolvedParamInfo {
  if (!isObject(v)) return false;
  return typeof v.name === "string" && typeof v.in === "string";
}

/**
 * Resolve a local $ref against the spec. Returns null on failure.
 */
function resolveLocalRef(spec: OpenAPISpec, ref: string): unknown {
  if (!ref.startsWith("#")) return null;
  const pointer = ref.slice(1); // Remove #
  if (pointer === "") return spec;
  try {
    return resolve(spec, pointer);
  } catch {
    return null;
  }
}

function resolveParam(
  spec: OpenAPISpec,
  param: unknown,
): ResolvedParamInfo | null {
  if (!isObject(param)) return null;
  if (typeof param.$ref === "string") {
    const resolved = resolveLocalRef(spec, param.$ref);
    if (isResolvedParamInfo(resolved)) return resolved;
    return null;
  }
  if (isResolvedParamInfo(param)) return param;
  return null;
}

function checkQuestionMarkInParams(spec: OpenAPISpec): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    // Path-level parameters
    if (pathItem.parameters) {
      for (const param of pathItem.parameters) {
        const resolved = resolveParam(spec, param);
        if (!resolved) continue;
        diagnostics.push(
          ...checkParamForQuestionMark(resolved, path, undefined),
        );
      }
    }

    // Operation-level parameters
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      if (operation.parameters) {
        for (const param of operation.parameters) {
          const resolved = resolveParam(spec, param);
          if (!resolved) continue;
          diagnostics.push(
            ...checkParamForQuestionMark(resolved, path, method),
          );
        }
      }
    }
  }

  return diagnostics;
}

function checkParamForQuestionMark(
  param: ResolvedParamInfo,
  path: string,
  method: string | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const base = method
    ? `#/paths/${escapeJsonPointer(path)}/${method}`
    : `#/paths/${escapeJsonPointer(path)}`;

  if (param.name.includes("?")) {
    diagnostics.push(
      specDiagnostic(
        "E1014",
        `${base}/parameters`,
        `Parameter name "${param.name}" contains a question mark`,
        {
          suggestion:
            "Question marks in parameter names likely indicate a URL encoding issue",
        },
      ),
    );
  }

  if (param.schema?.enum) {
    for (const value of param.schema.enum) {
      if (typeof value === "string" && value.includes("?")) {
        diagnostics.push(
          specDiagnostic(
            "E1014",
            `${base}/parameters`,
            `Enum value "${value}" in parameter "${param.name}" contains a question mark`,
            {
              suggestion:
                "Question marks in enum values likely indicate a URL encoding issue",
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}

// ── E1008: Duplicate path patterns ──────────────────────────────────

function checkDuplicatePathPatterns(spec: OpenAPISpec): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const normalized = new Map<string, string[]>();

  for (const path of Object.keys(spec.paths)) {
    const norm = path.replace(/\{[^}]+\}/g, "{*}");
    const existing = normalized.get(norm);
    if (existing) {
      existing.push(path);
    } else {
      normalized.set(norm, [path]);
    }
  }

  for (const [_norm, paths] of normalized) {
    if (paths.length > 1) {
      diagnostics.push(
        specDiagnostic(
          "E1008",
          "#/paths",
          `Conflicting path patterns: ${paths.join(", ")}`,
          {
            suggestion:
              "These paths match the same URL patterns. Routing will use first match",
            display: {
              context: paths.map((p) => ({ text: p })),
            },
          },
        ),
      );
    }
  }

  return diagnostics;
}

// ── E1009: Duplicate path parameter names in template ───────────────

function checkDuplicatePathParamNames(spec: OpenAPISpec): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const path of Object.keys(spec.paths)) {
    const paramNames: string[] = [];
    const re = /\{([^}]+)\}/g;
    let match;
    while ((match = re.exec(path)) !== null) {
      if (match[1] !== undefined) paramNames.push(match[1]);
    }

    const seen = new Set<string>();
    for (const name of paramNames) {
      if (seen.has(name)) {
        diagnostics.push(
          specDiagnostic(
            "E1009",
            `#/paths/${escapeJsonPointer(path)}`,
            `Path "${path}" has duplicate parameter name "{${name}}"`,
            {
              suggestion:
                "Each path parameter name must be unique within a path template",
            },
          ),
        );
      }
      seen.add(name);
    }
  }

  return diagnostics;
}

// ── E1010: Missing responses object ─────────────────────────────────

function checkMissingResponses(spec: OpenAPISpec): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      if (
        !operation.responses ||
        Object.keys(operation.responses).length === 0
      ) {
        diagnostics.push(
          specDiagnostic(
            "E1010",
            `#/paths/${escapeJsonPointer(path)}/${method}/responses`,
            `Operation ${method.toUpperCase()} ${path} has no response definitions`,
            {
              suggestion:
                "Every operation should define at least one response status code",
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}

// ── E1011: Invalid component names ──────────────────────────────────

const VALID_COMPONENT_NAME = /^[a-zA-Z0-9._-]+$/;

const COMPONENT_SECTIONS: (keyof ComponentsObject)[] = [
  "schemas",
  "responses",
  "parameters",
  "examples",
  "requestBodies",
  "headers",
  "securitySchemes",
  "links",
  "callbacks",
  "pathItems",
];

function checkInvalidComponentNames(spec: OpenAPISpec): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!spec.components) return diagnostics;

  for (const section of COMPONENT_SECTIONS) {
    const obj = spec.components[section];
    if (!obj) continue;

    for (const name of Object.keys(obj)) {
      if (!VALID_COMPONENT_NAME.test(name)) {
        diagnostics.push(
          specDiagnostic(
            "E1011",
            `#/components/${section}/${escapeJsonPointer(name)}`,
            `Component name "${name}" contains invalid characters`,
            {
              suggestion:
                "Component names must match the regex ^[a-zA-Z0-9._-]+$",
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}

// ── Single-pass spec walker ─────────────────────────────────────────
//
// Walks the entire spec tree once, collecting both $ref info (for E1004,
// E1005, E1007) and schema locations (for E1012).

interface RefInfo {
  /** JSON pointer to the object containing this $ref. */
  pointer: string;
  /** The $ref value itself (e.g., "#/components/schemas/User"). */
  ref: string;
  /** Other keys on the same object alongside $ref. */
  siblingKeys: string[];
}

interface WalkResult {
  refs: RefInfo[];
  /** All schema objects found, with their JSON pointers. */
  schemas: Array<{ schema: Record<string, unknown>; pointer: string }>;
}

function walkSpec(spec: OpenAPISpec): WalkResult {
  const refs: RefInfo[] = [];
  const schemas: WalkResult["schemas"] = [];

  // ── Generic tree walker for $ref collection ───────────────────
  function walkForRefs(obj: unknown, pointer: string): void {
    if (!isObject(obj)) {
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          walkForRefs(obj[i], `${pointer}/${i}`);
        }
      }
      return;
    }

    if (typeof obj.$ref === "string") {
      const siblingKeys = Object.keys(obj).filter((k) => k !== "$ref");
      refs.push({ pointer, ref: obj.$ref, siblingKeys });
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === "$ref") continue;
      walkForRefs(value, `${pointer}/${escapeJsonPointer(key)}`);
    }
  }

  // Collect all $refs from the entire spec
  walkForRefs(spec, "");

  // ── Schema walker for constraint checking ─────────────────────
  function visitSchema(obj: unknown, pointer: string): void {
    if (!isObject(obj)) return;
    if ("$ref" in obj) return;

    schemas.push({ schema: obj, pointer });

    // Recurse into sub-schemas
    const properties = obj.properties;
    if (isObject(properties)) {
      for (const [name, sub] of Object.entries(properties)) {
        visitSchema(sub, `${pointer}/properties/${escapeJsonPointer(name)}`);
      }
    }

    const items = obj.items;
    if (isObject(items) && !("$ref" in items)) {
      visitSchema(items, `${pointer}/items`);
    }

    const additionalProperties = obj.additionalProperties;
    if (isObject(additionalProperties) && !("$ref" in additionalProperties)) {
      visitSchema(additionalProperties, `${pointer}/additionalProperties`);
    }

    const patternProperties = obj.patternProperties;
    if (isObject(patternProperties)) {
      for (const [pattern, sub] of Object.entries(patternProperties)) {
        visitSchema(
          sub,
          `${pointer}/patternProperties/${escapeJsonPointer(pattern)}`,
        );
      }
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const arr = obj[keyword];
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          visitSchema(arr[i], `${pointer}/${keyword}/${i}`);
        }
      }
    }

    const not = obj.not;
    if (isObject(not) && !("$ref" in not)) {
      visitSchema(not, `${pointer}/not`);
    }

    // $defs
    const defs = obj.$defs;
    if (isObject(defs)) {
      for (const [name, sub] of Object.entries(defs)) {
        visitSchema(sub, `${pointer}/$defs/${escapeJsonPointer(name)}`);
      }
    }

    // Conditional: if/then/else
    for (const keyword of ["if", "then", "else"]) {
      const sub = obj[keyword];
      if (isObject(sub) && !("$ref" in sub)) {
        visitSchema(sub, `${pointer}/${keyword}`);
      }
    }
  }

  // Component schemas
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      visitSchema(
        schema,
        `#/components/schemas/${escapeJsonPointer(name)}`,
      );
    }
  }

  // Walk all paths for inline schemas
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    // Path-level parameter schemas
    if (pathItem.parameters) {
      for (let i = 0; i < pathItem.parameters.length; i++) {
        const param = pathItem.parameters[i];
        if (!param || "$ref" in param) continue;
        if (param.schema && !("$ref" in param.schema)) {
          visitSchema(
            param.schema,
            `#/paths/${escapeJsonPointer(path)}/parameters/${i}/schema`,
          );
        }
      }
    }

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const opPointer = `#/paths/${escapeJsonPointer(path)}/${method}`;

      // Operation parameter schemas
      if (operation.parameters) {
        for (let i = 0; i < operation.parameters.length; i++) {
          const param = operation.parameters[i];
          if (!param || "$ref" in param) continue;
          if (param.schema && !("$ref" in param.schema)) {
            visitSchema(param.schema, `${opPointer}/parameters/${i}/schema`);
          }
        }
      }

      // Request body schemas
      if (
        operation.requestBody && typeof operation.requestBody === "object" &&
        !("$ref" in operation.requestBody)
      ) {
        const rb = operation.requestBody;
        if (rb.content) {
          for (const [mediaType, mediaObj] of Object.entries(rb.content)) {
            if (mediaObj.schema) {
              visitSchema(
                mediaObj.schema,
                `${opPointer}/requestBody/content/${
                  escapeJsonPointer(mediaType)
                }/schema`,
              );
            }
          }
        }
      }

      // Response schemas and header schemas
      if (operation.responses) {
        for (
          const [statusCode, response] of Object.entries(operation.responses)
        ) {
          if (!isObject(response) || "$ref" in response) continue;
          const responsePointer = `${opPointer}/responses/${
            escapeJsonPointer(statusCode)
          }`;

          // Response content schemas
          const content = response.content;
          if (isObject(content)) {
            for (const [mediaType, mediaObj] of Object.entries(content)) {
              if (isObject(mediaObj) && mediaObj.schema) {
                visitSchema(
                  mediaObj.schema,
                  `${responsePointer}/content/${
                    escapeJsonPointer(mediaType)
                  }/schema`,
                );
              }
            }
          }

          // Response header schemas
          const headers = response.headers;
          if (isObject(headers)) {
            for (const [headerName, headerObj] of Object.entries(headers)) {
              if (
                isObject(headerObj) && !("$ref" in headerObj) &&
                headerObj.schema
              ) {
                visitSchema(
                  headerObj.schema,
                  `${responsePointer}/headers/${
                    escapeJsonPointer(headerName)
                  }/schema`,
                );
              }
            }
          }
        }
      }

      // Callback schemas
      if (operation.callbacks) {
        for (
          const [cbName, cbObj] of Object.entries(operation.callbacks)
        ) {
          if (!isObject(cbObj) || "$ref" in cbObj) continue;
          for (const [cbPath, cbPathItem] of Object.entries(cbObj)) {
            if (!isObject(cbPathItem)) continue;
            const cbPointer = `${opPointer}/callbacks/${
              escapeJsonPointer(cbName)
            }/${escapeJsonPointer(cbPath)}`;
            for (const cbMethod of HTTP_METHODS) {
              const cbOp = cbPathItem[cbMethod];
              if (!isObject(cbOp)) continue;

              // Callback request body
              const cbRequestBody = cbOp.requestBody;
              if (isObject(cbRequestBody) && !("$ref" in cbRequestBody)) {
                const cbContent = cbRequestBody.content;
                if (isObject(cbContent)) {
                  for (
                    const [mt, mtObj] of Object.entries(cbContent)
                  ) {
                    if (isObject(mtObj) && mtObj.schema) {
                      visitSchema(
                        mtObj.schema,
                        `${cbPointer}/${cbMethod}/requestBody/content/${
                          escapeJsonPointer(mt)
                        }/schema`,
                      );
                    }
                  }
                }
              }

              // Callback response content
              const cbResponses = cbOp.responses;
              if (isObject(cbResponses)) {
                for (
                  const [sc, resp] of Object.entries(cbResponses)
                ) {
                  if (!isObject(resp) || "$ref" in resp) continue;
                  const respContent = resp.content;
                  if (isObject(respContent)) {
                    for (
                      const [mt, mtObj] of Object.entries(respContent)
                    ) {
                      if (isObject(mtObj) && mtObj.schema) {
                        visitSchema(
                          mtObj.schema,
                          `${cbPointer}/${cbMethod}/responses/${
                            escapeJsonPointer(sc)
                          }/content/${escapeJsonPointer(mt)}/schema`,
                        );
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Webhook schemas (OpenAPI 3.1)
  if (spec.webhooks) {
    for (const [name, pathItem] of Object.entries(spec.webhooks)) {
      if (!pathItem) continue;
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation) continue;
        const opPointer = `#/webhooks/${escapeJsonPointer(name)}/${method}`;

        if (operation.parameters) {
          for (let i = 0; i < operation.parameters.length; i++) {
            const param = operation.parameters[i];
            if (!param || "$ref" in param) continue;
            if (param.schema && !("$ref" in param.schema)) {
              visitSchema(param.schema, `${opPointer}/parameters/${i}/schema`);
            }
          }
        }

        if (
          operation.requestBody && typeof operation.requestBody === "object" &&
          !("$ref" in operation.requestBody)
        ) {
          const rb = operation.requestBody;
          if (rb.content) {
            for (const [mt, mtObj] of Object.entries(rb.content)) {
              if (mtObj.schema) {
                visitSchema(
                  mtObj.schema,
                  `${opPointer}/requestBody/content/${
                    escapeJsonPointer(mt)
                  }/schema`,
                );
              }
            }
          }
        }

        if (operation.responses) {
          for (
            const [sc, response] of Object.entries(operation.responses)
          ) {
            if (!isObject(response) || "$ref" in response) continue;
            const content = response.content;
            if (isObject(content)) {
              for (const [mt, mtObj] of Object.entries(content)) {
                if (isObject(mtObj) && mtObj.schema) {
                  visitSchema(
                    mtObj.schema,
                    `${opPointer}/responses/${escapeJsonPointer(sc)}/content/${
                      escapeJsonPointer(mt)
                    }/schema`,
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  return { refs, schemas };
}

// ── E1007: Keywords alongside $ref (3.0.x only) ────────────────────

function checkRefSiblings(
  spec: OpenAPISpec,
  refs: RefInfo[],
): Diagnostic[] {
  // In OpenAPI 3.1.x, siblings alongside $ref are valid (JSON Schema 2020-12).
  // In 3.0.x, only $ref is processed. Siblings are ignored.
  if (spec.openapi.startsWith("3.1")) return [];

  const diagnostics: Diagnostic[] = [];

  for (const info of refs) {
    if (info.siblingKeys.length === 0) continue;
    // Steady doesn't serve webhooks. Skip refs from webhook schemas
    if (info.pointer.startsWith("/webhooks/")) continue;
    // summary/description alongside $ref are so commonly used that flagging
    // them would be noisy. Skip them.
    const meaningful = info.siblingKeys.filter(
      (k) => k !== "summary" && k !== "description",
    );
    if (meaningful.length === 0) continue;

    diagnostics.push(
      specDiagnostic(
        "E1007",
        `#${info.pointer}`,
        `Keywords [${
          meaningful.join(", ")
        }] alongside $ref are ignored in OpenAPI ${spec.openapi}`,
        {
          suggestion:
            "In OpenAPI 3.0.x, only $ref is processed. Move other keywords into the referenced schema or upgrade to 3.1",
          actual: meaningful,
          display: {
            context: meaningful.map((k) => ({ text: k })),
            notes: [
              `In OpenAPI ${spec.openapi}, these keywords are ignored when $ref is present`,
            ],
          },
        },
      ),
    );
  }

  return diagnostics;
}

// ── E1004: Unresolved $ref ──────────────────────────────────────────

function checkUnresolvedRefs(
  spec: OpenAPISpec,
  refs: RefInfo[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const info of refs) {
    if (!info.ref.startsWith("#")) continue;

    const pointer = info.ref.slice(1); // Remove #
    if (pointer === "") continue; // #  → root document, always resolves

    try {
      resolve(spec, pointer);
    } catch {
      diagnostics.push(
        specDiagnostic(
          "E1004",
          `#${info.pointer}`,
          `Unresolved reference: ${info.ref}`,
          {
            suggestion: "Check that the referenced path exists in the spec",
            actual: info.ref,
            display: {
              context: [{
                text: `$ref: '${info.ref}'`,
                highlight: {
                  start: 6,
                  end: 6 + info.ref.length + 2,
                  label: "Target does not exist",
                },
              }],
            },
          },
        ),
      );
    }
  }

  return diagnostics;
}

// ── E1005: Circular $ref ────────────────────────────────────────────

function checkCircularRefs(
  refs: RefInfo[],
  spec: OpenAPISpec,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Collect all ref targets as graph nodes
  const targets = new Set<string>();
  for (const info of refs) {
    if (!info.ref.startsWith("#")) continue;
    targets.add(info.ref.slice(1));
  }

  // Build a sorted list of targets for efficient prefix matching
  const sortedTargets = [...targets].sort((a, b) => b.length - a.length);

  // Build adjacency list AND track which RefInfos create each edge
  const edges = new Map<string, Set<string>>();
  const edgeRefs = new Map<string, Map<string, RefInfo[]>>();

  for (const info of refs) {
    if (!info.ref.startsWith("#")) continue;
    const refTarget = info.ref.slice(1);

    // Find which target this ref is nested under.
    // The longest target that is a prefix of the ref's pointer.
    let container: string | null = null;
    for (const t of sortedTargets) {
      if (
        info.pointer === t ||
        (t === "" && info.pointer.length > 0) ||
        info.pointer.startsWith(t + "/")
      ) {
        container = t;
        break; // sortedTargets is longest-first, so first match is longest
      }
    }

    if (container === null) continue;

    // Add to adjacency list
    const existing = edges.get(container);
    if (existing) {
      existing.add(refTarget);
    } else {
      edges.set(container, new Set([refTarget]));
    }

    // Track RefInfo for this edge
    let containerMap = edgeRefs.get(container);
    if (!containerMap) {
      containerMap = new Map();
      edgeRefs.set(container, containerMap);
    }
    let targetList = containerMap.get(refTarget);
    if (!targetList) {
      targetList = [];
      containerMap.set(refTarget, targetList);
    }
    targetList.push(info);
  }

  // DFS cycle detection with path tracking
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const reported = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    color.set(node, GRAY);
    stack.push(node);

    const neighbors = edges.get(node);
    if (neighbors) {
      for (const next of neighbors) {
        const nextColor = color.get(next) ?? WHITE;
        if (nextColor === GRAY) {
          // Back-edge found: cycle is stack[indexOf(next)..] → next
          const startIdx = stack.indexOf(next);
          if (startIdx < 0) continue;

          const cyclePath = stack.slice(startIdx);
          const cycleKey = [...cyclePath].sort().join(",");
          if (reported.has(cycleKey)) continue;

          // Only report forced cycles (no escape hatch on any edge)
          if (isCycleForced(cyclePath, edgeRefs, spec)) {
            reported.add(cycleKey);

            const displayContext: Array<{ text: string }> = [];
            for (let j = 0; j < cyclePath.length; j++) {
              const n = cyclePath[j];
              if (n === undefined) continue;
              displayContext.push({ text: j === 0 ? n : `-> ${n}` });
            }
            displayContext.push({ text: `-> ${next} (cycle)` });

            diagnostics.push(
              specDiagnostic(
                "E1005",
                `#${next}`,
                `Forced circular reference (no base case) at ${next}`,
                {
                  suggestion:
                    "All paths through this cycle use required properties with no non-recursive alternative. Response generation will truncate at depth limit.",
                  display: { context: displayContext },
                },
              ),
            );
          }
        } else if (nextColor === WHITE) {
          dfs(next);
        }
      }
    }

    stack.pop();
    color.set(node, BLACK);
  }

  const allNodes = new Set([...edges.keys(), ...targets]);
  for (const node of allNodes) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      dfs(node);
    }
  }

  return diagnostics;
}

/**
 * Check if every edge in a cycle is forced (no escape hatch).
 * A cycle is forced only if there is no way to break it.
 */
function isCycleForced(
  cyclePath: string[],
  edgeRefs: Map<string, Map<string, RefInfo[]>>,
  spec: OpenAPISpec,
): boolean {
  for (let i = 0; i < cyclePath.length; i++) {
    const from = cyclePath[i];
    const to = cyclePath[(i + 1) % cyclePath.length];
    if (from === undefined || to === undefined) return false;

    const refInfos = edgeRefs.get(from)?.get(to) ?? [];
    if (!isEdgeForced(spec, from, refInfos)) {
      return false; // This edge has an escape → cycle not forced
    }
  }
  return true;
}

/**
 * An edge is forced if at least one ref path has no escape hatch.
 * (If all ref paths from container to target have escape hatches,
 * you never HAVE to follow this edge.)
 */
function isEdgeForced(
  spec: OpenAPISpec,
  container: string,
  refInfos: RefInfo[],
): boolean {
  for (const info of refInfos) {
    if (!refPathHasEscapeHatch(spec, container, info.pointer)) {
      return true; // At least one forced path exists
    }
  }
  return false; // All paths have escape hatches → edge not forced
}

/** Get the `required` array from a schema at the given pointer, or empty. */
function getRequiredAt(spec: OpenAPISpec, pointer: string): string[] {
  const schema = resolve(spec, pointer);
  if (typeof schema !== "object" || schema === null) return [];
  if (!("required" in schema)) return [];
  const req = schema.required;
  return Array.isArray(req) ? req : [];
}

/**
 * Check if a ref path from container to refPointer has an escape hatch.
 *
 * Escape hatches:
 * - Optional property (not in parent's `required` array)
 * - Array `items` (default minItems is 0 → empty array is valid)
 * - `oneOf` / `anyOf` (at least one non-recursive alternative)
 * - `additionalProperties` (optional by nature)
 */
function refPathHasEscapeHatch(
  spec: OpenAPISpec,
  containerPointer: string,
  refPointer: string,
): boolean {
  const relativePath = refPointer.slice(containerPointer.length);
  if (!relativePath.startsWith("/")) return false;

  const segments = relativePath.slice(1).split("/");

  let currentPath = containerPointer;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined) continue;

    if (segment === "properties") {
      const propName = segments[i + 1];
      if (propName === undefined) {
        currentPath += "/properties";
        continue;
      }
      // Check if this property is required in the schema at currentPath
      const required = getRequiredAt(spec, currentPath);
      if (!required.includes(propName)) {
        return true; // Optional property → escape hatch
      }
      currentPath += `/properties/${propName}`;
      i++; // skip the property name segment
    } else if (segment === "items") {
      return true; // Array items → escape hatch (minItems defaults to 0)
    } else if (segment === "oneOf" || segment === "anyOf") {
      return true; // Variant type → escape hatch
    } else if (segment === "additionalProperties") {
      return true; // Additional properties are optional
    } else {
      currentPath += `/${segment}`;
    }
  }

  return false; // No escape hatch found → path is forced
}

// ── E1012: Impossible schema constraints ────────────────────────────

/**
 * Compute effective numeric bounds from a schema.
 *
 * Handles both forms by inspecting the actual value type:
 * - Number → standalone exclusive bound (3.1.x style)
 * - Boolean true → makes minimum/maximum exclusive (3.0.x style)
 *
 * Real specs mix both styles regardless of declared version.
 */
function getEffectiveBounds(
  schema: Record<string, unknown>,
): {
  lower?: number;
  upper?: number;
  lowerExclusive: boolean;
  upperExclusive: boolean;
} {
  const minimum = numProp(schema, "minimum");
  const maximum = numProp(schema, "maximum");
  const exMin = schema.exclusiveMinimum;
  const exMax = schema.exclusiveMaximum;

  let lower: number | undefined;
  let upper: number | undefined;
  let lowerExclusive = false;
  let upperExclusive = false;

  // Lower bound
  if (typeof exMin === "number") {
    if (minimum !== undefined && minimum > exMin) {
      lower = minimum; // minimum is tighter
    } else {
      lower = exMin;
      lowerExclusive = true;
    }
  } else if (exMin === true && minimum !== undefined) {
    lower = minimum;
    lowerExclusive = true;
  } else {
    lower = minimum;
  }

  // Upper bound
  if (typeof exMax === "number") {
    if (maximum !== undefined && maximum < exMax) {
      upper = maximum; // maximum is tighter
    } else {
      upper = exMax;
      upperExclusive = true;
    }
  } else if (exMax === true && maximum !== undefined) {
    upper = maximum;
    upperExclusive = true;
  } else {
    upper = maximum;
  }

  return { lower, upper, lowerExclusive, upperExclusive };
}

function checkImpossibleConstraints(
  schemas: WalkResult["schemas"],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const { schema, pointer } of schemas) {
    // Numeric range inversions
    const bounds = getEffectiveBounds(schema);

    if (bounds.lower !== undefined && bounds.upper !== undefined) {
      const impossible = bounds.lowerExclusive || bounds.upperExclusive
        ? bounds.lower >= bounds.upper
        : bounds.lower > bounds.upper;

      if (impossible) {
        const lowerLabel = bounds.lowerExclusive
          ? `exclusiveMinimum (${bounds.lower})`
          : `minimum (${bounds.lower})`;
        const upperLabel = bounds.upperExclusive
          ? `exclusiveMaximum (${bounds.upper})`
          : `maximum (${bounds.upper})`;
        const op = bounds.lowerExclusive || bounds.upperExclusive ? ">=" : ">";

        diagnostics.push(
          specDiagnostic(
            "E1012",
            pointer,
            `Impossible constraint: ${lowerLabel} ${op} ${upperLabel}`,
            {
              expected: bounds.lowerExclusive || bounds.upperExclusive
                ? "lower bound < upper bound (exclusive)"
                : "minimum <= maximum",
              actual: { lower: bounds.lower, upper: bounds.upper },
            },
          ),
        );
      }
    }

    // String length
    const minLength = numProp(schema, "minLength");
    const maxLength = numProp(schema, "maxLength");
    if (
      minLength !== undefined && maxLength !== undefined &&
      minLength > maxLength
    ) {
      diagnostics.push(
        specDiagnostic(
          "E1012",
          pointer,
          `Impossible constraint: minLength (${minLength}) > maxLength (${maxLength})`,
          {
            expected: "minLength <= maxLength",
            actual: { minLength, maxLength },
          },
        ),
      );
    }

    // Array size
    const minItems = numProp(schema, "minItems");
    const maxItems = numProp(schema, "maxItems");
    if (
      minItems !== undefined && maxItems !== undefined &&
      minItems > maxItems
    ) {
      diagnostics.push(
        specDiagnostic(
          "E1012",
          pointer,
          `Impossible constraint: minItems (${minItems}) > maxItems (${maxItems})`,
          { expected: "minItems <= maxItems", actual: { minItems, maxItems } },
        ),
      );
    }

    // Object property count
    const minProperties = numProp(schema, "minProperties");
    const maxProperties = numProp(schema, "maxProperties");
    if (
      minProperties !== undefined && maxProperties !== undefined &&
      minProperties > maxProperties
    ) {
      diagnostics.push(
        specDiagnostic(
          "E1012",
          pointer,
          `Impossible constraint: minProperties (${minProperties}) > maxProperties (${maxProperties})`,
          {
            expected: "minProperties <= maxProperties",
            actual: { minProperties, maxProperties },
          },
        ),
      );
    }

    // required.length > maxProperties
    const required = schema.required;
    if (
      Array.isArray(required) && maxProperties !== undefined &&
      required.length > maxProperties
    ) {
      diagnostics.push(
        specDiagnostic(
          "E1012",
          pointer,
          `Impossible constraint: ${required.length} required properties but maxProperties is ${maxProperties}`,
          {
            expected: "required.length <= maxProperties",
            actual: { required: required.length, maxProperties },
          },
        ),
      );
    }

    // Empty enum
    const enumVal = schema.enum;
    if (Array.isArray(enumVal) && enumVal.length === 0) {
      diagnostics.push(
        specDiagnostic(
          "E1012",
          pointer,
          "Impossible constraint: enum is empty (no value can ever match)",
          { suggestion: "Add at least one value to the enum, or remove it" },
        ),
      );
    }

    // Conflicting type in allOf
    const allOf = schema.allOf;
    if (Array.isArray(allOf)) {
      const singleTypes: string[] = [];
      for (const sub of allOf) {
        if (isObject(sub) && typeof sub.type === "string") {
          singleTypes.push(sub.type);
        }
      }
      const uniqueSingle = new Set(singleTypes);
      if (uniqueSingle.size > 1) {
        diagnostics.push(
          specDiagnostic(
            "E1012",
            pointer,
            `Impossible constraint: allOf members require conflicting types: ${
              [...uniqueSingle].join(", ")
            }`,
            {
              suggestion:
                "An allOf with conflicting type requirements can never validate",
              actual: [...uniqueSingle],
            },
          ),
        );
      }

      // allOf bound merging: collect min/max across members
      diagnostics.push(...checkAllOfBounds(allOf, pointer));
    }

    // Type+format conflicts
    const schemaType = schema.type;
    const format = schema.format;
    if (typeof schemaType === "string" && typeof format === "string") {
      if (isTypeFormatConflict(schemaType, format)) {
        diagnostics.push(
          specDiagnostic(
            "E1012",
            pointer,
            `Impossible constraint: type "${schemaType}" with format "${format}"`,
            {
              suggestion:
                `Format "${format}" does not apply to type "${schemaType}"`,
              actual: { type: schemaType, format },
            },
          ),
        );
      }
    }

    // Pattern on non-string type
    if (
      typeof schemaType === "string" && schemaType !== "string" &&
      typeof schema.pattern === "string"
    ) {
      diagnostics.push(
        specDiagnostic(
          "E1012",
          pointer,
          `Impossible constraint: pattern on type "${schemaType}" (pattern only applies to strings)`,
          {
            suggestion:
              `Change the type to "string" or remove the pattern constraint`,
            actual: { type: schemaType, pattern: schema.pattern },
          },
        ),
      );
    }
  }

  return diagnostics;
}

/**
 * Check for impossible merged numeric bounds across allOf members.
 * e.g., allOf: [{minimum: 10}, {maximum: 5}] is impossible.
 */
function checkAllOfBounds(
  allOf: unknown[],
  pointer: string,
): Diagnostic[] {
  let mergedMin: number | undefined;
  let mergedMax: number | undefined;
  let mergedMinExclusive = false;
  let mergedMaxExclusive = false;

  for (const sub of allOf) {
    if (!isObject(sub)) continue;
    const bounds = getEffectiveBounds(sub);
    if (bounds.lower !== undefined) {
      if (mergedMin === undefined || bounds.lower > mergedMin) {
        mergedMin = bounds.lower;
        mergedMinExclusive = bounds.lowerExclusive;
      } else if (bounds.lower === mergedMin && bounds.lowerExclusive) {
        mergedMinExclusive = true;
      }
    }
    if (bounds.upper !== undefined) {
      if (mergedMax === undefined || bounds.upper < mergedMax) {
        mergedMax = bounds.upper;
        mergedMaxExclusive = bounds.upperExclusive;
      } else if (bounds.upper === mergedMax && bounds.upperExclusive) {
        mergedMaxExclusive = true;
      }
    }
  }

  if (mergedMin === undefined || mergedMax === undefined) return [];

  const impossible = mergedMinExclusive || mergedMaxExclusive
    ? mergedMin >= mergedMax
    : mergedMin > mergedMax;

  if (!impossible) return [];

  return [
    specDiagnostic(
      "E1012",
      pointer,
      `Impossible constraint: allOf members merge to minimum (${mergedMin}) > maximum (${mergedMax})`,
      {
        suggestion:
          "The combined min/max bounds across allOf members form an empty range",
        actual: { mergedMin, mergedMax },
      },
    ),
  ];
}

/** Map of string formats that conflict with non-string types. */
const STRING_ONLY_FORMATS = new Set([
  "email",
  "uri",
  "uri-reference",
  "hostname",
  "ipv4",
  "ipv6",
  "date",
  "date-time",
  "time",
  "duration",
  "uuid",
  "regex",
  "idn-email",
  "idn-hostname",
  "iri",
  "iri-reference",
  "json-pointer",
  "relative-json-pointer",
  "uri-template",
  "binary",
  "byte",
  "password",
]);

/** Map of numeric formats that conflict with non-numeric types. */
const NUMERIC_ONLY_FORMATS = new Set([
  "int32",
  "float",
  "double",
]);

/**
 * Check if a type+format combination is unambiguously wrong.
 * Conservative: only flags clear conflicts, not edge cases.
 */
function isTypeFormatConflict(type: string, format: string): boolean {
  // String formats on non-string types
  if (type !== "string" && STRING_ONLY_FORMATS.has(format)) {
    return true;
  }
  // Numeric formats on non-numeric types
  if (
    type !== "number" && type !== "integer" &&
    NUMERIC_ONLY_FORMATS.has(format)
  ) {
    return true;
  }
  return false;
}

// ── E1016: Required property not in properties ──────────────────────

function checkRequiredNotInProperties(
  schemas: WalkResult["schemas"],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const { schema, pointer } of schemas) {
    const required = schema.required;
    const properties = schema.properties;
    if (!Array.isArray(required) || !isObject(properties)) continue;

    const propertyNames = new Set(Object.keys(properties));
    for (const field of required) {
      if (typeof field !== "string") continue;
      if (!propertyNames.has(field)) {
        diagnostics.push(
          specDiagnostic(
            "E1016",
            pointer,
            `Required field "${field}" is not defined in properties`,
            {
              suggestion:
                `Add "${field}" to the properties object, or remove it from the required array`,
              expected: field,
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}

// ── E1015: Non-standard usage ────────────────────────────────────────

function checkNonStandardUsage(
  schemas: WalkResult["schemas"],
  openapi: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const is30 = openapi.startsWith("3.0");
  const is31 = openapi.startsWith("3.1");

  for (const { schema, pointer } of schemas) {
    const exMin = schema.exclusiveMinimum;
    const exMax = schema.exclusiveMaximum;

    // 3.0.x expects boolean, 3.1.x expects number
    if (is30) {
      if (typeof exMin === "number") {
        diagnostics.push(
          specDiagnostic(
            "E1015",
            pointer,
            `exclusiveMinimum is a number but OpenAPI ${openapi} expects a boolean`,
            {
              suggestion:
                "Steady handles this, but other tools may not. In 3.0.x, use exclusiveMinimum: true alongside minimum",
            },
          ),
        );
      }
      if (typeof exMax === "number") {
        diagnostics.push(
          specDiagnostic(
            "E1015",
            pointer,
            `exclusiveMaximum is a number but OpenAPI ${openapi} expects a boolean`,
            {
              suggestion:
                "Steady handles this, but other tools may not. In 3.0.x, use exclusiveMaximum: true alongside maximum",
            },
          ),
        );
      }
    }

    if (is31) {
      if (typeof exMin === "boolean") {
        diagnostics.push(
          specDiagnostic(
            "E1015",
            pointer,
            `exclusiveMinimum is a boolean but OpenAPI ${openapi} expects a number`,
            {
              suggestion:
                "Steady handles this, but other tools may not. In 3.1.x, use exclusiveMinimum: <number> as a standalone bound",
            },
          ),
        );
      }
      if (typeof exMax === "boolean") {
        diagnostics.push(
          specDiagnostic(
            "E1015",
            pointer,
            `exclusiveMaximum is a boolean but OpenAPI ${openapi} expects a number`,
            {
              suggestion:
                "Steady handles this, but other tools may not. In 3.1.x, use exclusiveMaximum: <number> as a standalone bound",
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}
