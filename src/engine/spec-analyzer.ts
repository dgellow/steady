/**
 * Startup spec analyzer — detects spec issues before serving requests.
 *
 * Single-pass analysis of a parsed OpenAPI spec, producing E1xxx diagnostics.
 * Runs at startup (before the server accepts requests) to catch spec problems
 * like unresolved $refs, circular references, duplicate paths, etc.
 */

import type { ComponentsObject, OpenAPISpec } from "@steady/openapi";
import { resolve } from "@steady/json-pointer";
import type { Diagnostic } from "../diagnostic.ts";
import { type ECode, getCode, hasCode } from "../codes/registry.ts";

// ── Public interface ────────────────────────────────────────────────

export interface SpecAnalysisResult {
  diagnostics: Diagnostic[];
  /** True if any diagnostic has fatal: true in the registry. */
  fatal: boolean;
}

/**
 * Analyze a parsed OpenAPI spec for structural issues.
 * Returns diagnostics and whether any are fatal (spec cannot be served).
 */
export function analyzeSpec(spec: OpenAPISpec): SpecAnalysisResult {
  const diagnostics: Diagnostic[] = [];

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
  diagnostics.push(...checkCircularRefs(walkResult.refs));
  diagnostics.push(
    ...checkImpossibleConstraints(walkResult.schemas),
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
      for (const path of paths) {
        diagnostics.push(
          specDiagnostic(
            "E1008",
            `#/paths/${escapeJsonPointer(path)}`,
            `Path "${path}" conflicts with: ${
              paths.filter((p) => p !== path).join(", ")
            }`,
            {
              suggestion:
                "These paths are ambiguous — they match the same URL patterns",
            },
          ),
        );
      }
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
  // In 3.0.x, only $ref is processed — siblings are ignored.
  if (spec.openapi.startsWith("3.1")) return [];

  const diagnostics: Diagnostic[] = [];

  for (const info of refs) {
    if (info.siblingKeys.length === 0) continue;
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
          },
        ),
      );
    }
  }

  return diagnostics;
}

// ── E1005: Circular $ref ────────────────────────────────────────────

function checkCircularRefs(refs: RefInfo[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Collect all ref targets as graph nodes
  const targets = new Set<string>();
  for (const info of refs) {
    if (!info.ref.startsWith("#")) continue;
    targets.add(info.ref.slice(1));
  }

  // Build a sorted list of targets for efficient prefix matching
  const sortedTargets = [...targets].sort((a, b) => b.length - a.length);

  // Build adjacency list: for each ref target T, find all refs nested
  // under T and add edges T → (those refs' targets).
  const edges = new Map<string, Set<string>>();

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

    const existing = edges.get(container);
    if (existing) {
      existing.add(refTarget);
    } else {
      edges.set(container, new Set([refTarget]));
    }
  }

  // DFS cycle detection
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const reported = new Set<string>();

  function dfs(node: string): void {
    color.set(node, GRAY);

    const neighbors = edges.get(node);
    if (neighbors) {
      for (const next of neighbors) {
        const nextColor = color.get(next) ?? WHITE;
        if (nextColor === GRAY) {
          const cycleKey = [node, next].sort().join(" <-> ");
          if (!reported.has(cycleKey)) {
            reported.add(cycleKey);
            diagnostics.push(
              specDiagnostic(
                "E1005",
                `#${node}`,
                `Circular reference detected at ${node}`,
                {
                  suggestion:
                    "Break the cycle by removing one of the circular $ref references, or ensure there is a base case that terminates the recursion",
                },
              ),
            );
          }
        } else if (nextColor === WHITE) {
          dfs(next);
        }
      }
    }

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
