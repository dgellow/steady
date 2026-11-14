/**
 * Startup spec analyzer. Detects spec issues before serving requests.
 *
 * Single-pass analysis of a parsed OpenAPI spec, producing E1xxx diagnostics.
 * Runs at startup (before the server accepts requests) to catch spec problems
 * like unresolved $refs, circular references, duplicate paths, etc.
 */

import type {
  ComponentsObject,
  OpenAPIRaw,
  ShapeProblem,
} from "@steady/openapi";
import { openapi31Metaschema } from "@steady/openapi";
import {
  formatFragmentPointer,
  type PointerPath,
  resolve,
} from "@steady/json-pointer";
import {
  CONDITIONAL_KEYWORDS,
  JsonSchemaProcessor,
  REGEX_KEYWORDS,
} from "@steady/json-schema";
import type { Diagnostic, DiagnosticDisplay } from "../diagnostic.ts";
import { type ECode, getCode, hasCode } from "../codes/registry.ts";
import { getMediaType } from "../media-type.ts";
import type { PipelineTimer } from "../timing.ts";
import { HTTP_METHODS } from "../types.ts";

// ── Public interface ────────────────────────────────────────────────

import type { DocIndex } from "@steady/json-schema";
import type { FragmentPointer } from "@steady/json-pointer";

export interface SpecAnalysisResult {
  diagnostics: Diagnostic[];
  /** True if any diagnostic has fatal: true in the registry. */
  fatal: boolean;
  /** Document index for SchemaRegistry (from a single walk). */
  docIndex: DocIndex;
}

export interface AnalyzeSpecOptions {
  /** Base URI for resolving references during metaschema validation. */
  baseUri?: string;
  /** Fields where the parser applied defaults (triggers E1003 diagnostics). */
  defaultedFields?: string[];
  /** Values the parser removed because they had the wrong type (E1023). */
  shapeProblems?: ShapeProblem[];
  /** Optional timer for startup instrumentation. */
  timer?: PipelineTimer;
}

/**
 * Analyze a parsed OpenAPI spec for structural issues.
 * Returns diagnostics and whether any are fatal (spec cannot be served).
 */
export function analyzeSpec(
  spec: OpenAPIRaw,
  options?: AnalyzeSpecOptions,
): SpecAnalysisResult {
  const diagnostics: Diagnostic[] = [];
  const timer = options?.timer;

  // E1003: Missing metadata fields (parser applied defaults)
  timer?.start("metadata");
  if (options?.defaultedFields && options.defaultedFields.length > 0) {
    diagnostics.push(...checkMissingMetadata(options.defaultedFields));
  }
  if (options?.shapeProblems) {
    diagnostics.push(...checkShapeProblems(options.shapeProblems));
  }
  timer?.stop("metadata");

  // Metaschema validation for OpenAPI 3.1.x
  timer?.start("metaschema");
  diagnostics.push(...checkMetaschema(spec, options?.baseUri));
  timer?.stop("metaschema");

  timer?.start("structural");
  diagnostics.push(...checkFragmentInPath(spec));
  diagnostics.push(...checkMultipleQuestionMarks(spec));
  diagnostics.push(...checkQuestionMarkInParams(spec));
  diagnostics.push(...checkDuplicatePathPatterns(spec));
  diagnostics.push(...checkDuplicatePathParamNames(spec));
  diagnostics.push(...checkMissingResponses(spec));
  diagnostics.push(...checkInvalidComponentNames(spec));
  diagnostics.push(...checkRedirectsWithoutLocation(spec));
  diagnostics.push(...checkNullBodyWithContent(spec));
  diagnostics.push(...checkNoSuccessResponse(spec));
  diagnostics.push(...checkUnconventionalRequestBody(spec));
  diagnostics.push(...checkInvalidContentTypeKeys(spec));
  timer?.stop("structural");

  // Single tree walk collects $ref info and schema pointers
  timer?.start("walk");
  const walkResult = walkSpec(spec);
  timer?.stop("walk");

  timer?.start("refs");
  diagnostics.push(...checkRefSiblings(spec, walkResult.refs));
  timer?.start("refs-unresolved");
  diagnostics.push(...checkUnresolvedRefs(spec, walkResult.refs));
  timer?.stop("refs-unresolved");
  timer?.start("refs-circular");
  diagnostics.push(...checkCircularRefs(walkResult.refs, spec));
  timer?.stop("refs-circular");
  timer?.stop("refs");

  timer?.start("constraints");
  diagnostics.push(
    ...checkImpossibleConstraints(walkResult.schemas),
  );
  diagnostics.push(
    ...checkRequiredNotInProperties(walkResult.schemas),
  );
  diagnostics.push(
    ...checkNonStandardUsage(walkResult.schemas, spec.openapi),
  );
  diagnostics.push(...checkKeywordsNotEvaluated(walkResult.schemas));
  timer?.stop("constraints");

  const fatal = diagnostics.some((d) => {
    if (!hasCode(d.code)) return false;
    return getCode(d.code).fatal === true;
  });

  const docIndex: DocIndex = {
    anchors: walkResult.anchors,
    ids: walkResult.ids,
    refs: walkResult.uniqueRefs,
    edges: walkResult.edges,
    pointerCount: walkResult.pointerCount,
  };

  return { diagnostics, fatal, docIndex };
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

// ── E1024: Keywords the validator does not evaluate ─────────────────

/**
 * One note per kind of keyword, with how often the spec uses it and where
 * it first does. A note per occurrence would bury everything else: some
 * published specs use `pattern` thousands of times.
 */
function checkKeywordsNotEvaluated(
  schemas: Array<{ schema: Record<string, unknown>; pointer: FragmentPointer }>,
): Diagnostic[] {
  const kinds = [
    {
      keywords: REGEX_KEYWORDS,
      what: "regular expressions",
      effect:
        "Strings are not checked against pattern, and an object with patternProperties gets no additional-property errors",
    },
    {
      keywords: CONDITIONAL_KEYWORDS,
      what: "conditional schemas",
      effect: "The schemas under these keywords are not applied to requests",
    },
  ];

  const diagnostics: Diagnostic[] = [];
  for (const kind of kinds) {
    let count = 0;
    let first: FragmentPointer | undefined;
    const used = new Set<string>();
    for (const { schema, pointer } of schemas) {
      for (const keyword of kind.keywords) {
        if (!Object.hasOwn(schema, keyword)) continue;
        count++;
        used.add(keyword);
        first ??= pointer;
      }
    }
    if (count === 0 || first === undefined) continue;

    const names = kind.keywords.filter((k) => used.has(k)).join(", ");
    diagnostics.push(
      specDiagnostic(
        "E1024",
        first,
        `The spec uses ${names} in ${count} ${
          count === 1 ? "place" : "places"
        }. Steady does not evaluate ${kind.what}`,
        {
          suggestion: `No action needed. ${kind.effect}`,
          expected: names,
          actual: count,
        },
      ),
    );
  }
  return diagnostics;
}

// ── E1023: Value of the wrong type ───────────────────────────────────

function checkShapeProblems(problems: ShapeProblem[]): Diagnostic[] {
  return problems.map((problem) =>
    specDiagnostic(
      "E1023",
      formatFragmentPointer(problem.path),
      problem.message ??
        `Expected ${problem.expected}, found ${problem.actual}. Steady ignores this value`,
      {
        suggestion: `Change the value to ${problem.expected}, or remove it`,
        expected: problem.expected,
        actual: problem.actual,
      },
    )
  );
}

// ── Metaschema validation (E1006 fatal / E1015 info) ────────────────

const metaschema = openapi31Metaschema;

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
function checkMetaschema(
  spec: OpenAPIRaw,
  baseUri?: string,
): Diagnostic[] {
  if (!spec.openapi.startsWith("3.1.")) return [];

  const processor = new JsonSchemaProcessor();
  const result = processor.process(spec, { metaschema, baseUri });

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

// ── E1021: URI fragment in path ──────────────────────────────────────

function checkFragmentInPath(spec: OpenAPIRaw): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const path of Object.keys(spec.paths)) {
    if (path.includes("#")) {
      diagnostics.push(
        specDiagnostic(
          "E1021",
          formatFragmentPointer(["paths", path]),
          `Path "${path}" contains a URI fragment (#). Fragments are stripped by HTTP clients and cannot be routed.`,
          {
            suggestion:
              "Steady will skip this path during validation and fuzzing",
          },
        ),
      );
    }
  }

  return diagnostics;
}

// ── E1013: Multiple question marks in path ──────────────────────────

function checkMultipleQuestionMarks(spec: OpenAPIRaw): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const path of Object.keys(spec.paths)) {
    const qCount = path.split("?").length - 1;
    if (qCount > 1) {
      diagnostics.push(
        specDiagnostic(
          "E1013",
          formatFragmentPointer(["paths", path]),
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
function resolveLocalRef(spec: OpenAPIRaw, ref: string): unknown {
  if (!ref.startsWith("#")) return null;
  try {
    return resolve(spec, ref);
  } catch {
    return null;
  }
}

function resolveParam(
  spec: OpenAPIRaw,
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

function checkQuestionMarkInParams(spec: OpenAPIRaw): Diagnostic[] {
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
  const basePath: PointerPath = method
    ? ["paths", path, method, "parameters"]
    : ["paths", path, "parameters"];
  const pointer = formatFragmentPointer(basePath);

  if (param.name.includes("?")) {
    diagnostics.push(
      specDiagnostic(
        "E1014",
        pointer,
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
            pointer,
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

function checkDuplicatePathPatterns(spec: OpenAPIRaw): Diagnostic[] {
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

function checkDuplicatePathParamNames(spec: OpenAPIRaw): Diagnostic[] {
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
            formatFragmentPointer(["paths", path]),
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

function checkMissingResponses(spec: OpenAPIRaw): Diagnostic[] {
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
            formatFragmentPointer(["paths", path, method, "responses"]),
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

// ── E1017: Redirect without Location header ─────────────────────────

function checkRedirectsWithoutLocation(spec: OpenAPIRaw): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation?.responses) continue;

      for (
        const [statusCode, responseOrRef] of Object.entries(
          operation.responses,
        )
      ) {
        // Only check 3xx status codes
        const code = parseInt(statusCode, 10);
        if (isNaN(code) || code < 300 || code >= 400) continue;

        // Resolve $ref if needed
        const responseObj = "$ref" in responseOrRef
          ? resolve(spec, (responseOrRef as { $ref: string }).$ref)
          : responseOrRef;
        if (!responseObj || typeof responseObj !== "object") continue;

        // Check if Location header is defined (case-insensitive)
        const headers = (responseObj as Record<string, unknown>).headers;
        const hasLocation = headers &&
          typeof headers === "object" &&
          Object.keys(headers as Record<string, unknown>).some(
            (h) => h.toLowerCase() === "location",
          );

        if (!hasLocation) {
          diagnostics.push(
            specDiagnostic(
              "E1017",
              formatFragmentPointer([
                "paths",
                path,
                method,
                "responses",
                statusCode,
              ]),
              `${statusCode} response on ${method.toUpperCase()} ${path} has no Location header. HTTP redirects require Location per RFC 9110`,
              {
                suggestion:
                  "Add a Location header with an example value, e.g. headers: { Location: { schema: { type: string }, example: '/resource/123' } }. Without one, Steady redirects to /_x-steady/redirected.",
              },
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}

// ── E1018: Null-body status code with response content ──────────────

/** Status codes that MUST NOT have a response body per HTTP semantics. */
const NULL_BODY_STATUSES = new Set(["101", "204", "205", "304"]);

function checkNullBodyWithContent(spec: OpenAPIRaw): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation?.responses) continue;

      for (
        const [statusCode, responseOrRef] of Object.entries(
          operation.responses,
        )
      ) {
        if (!NULL_BODY_STATUSES.has(statusCode)) continue;

        // Resolve $ref if needed
        const responseObj = isObject(responseOrRef) && "$ref" in responseOrRef
          ? resolveLocalRef(
            spec,
            (responseOrRef as { $ref: string }).$ref,
          )
          : responseOrRef;
        if (!isObject(responseObj)) continue;

        // Check if content is defined and non-empty
        const content = responseObj.content;
        if (!isObject(content) || Object.keys(content).length === 0) continue;

        diagnostics.push(
          specDiagnostic(
            "E1018",
            formatFragmentPointer([
              "paths",
              path,
              method,
              "responses",
              statusCode,
            ]),
            `${statusCode} response on ${method.toUpperCase()} ${path} defines body content, but HTTP ${statusCode} must not have a body`,
            {
              suggestion:
                `Remove the content field from the ${statusCode} response. Steady will strip the body at runtime to avoid crashes`,
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}

// ── E1019: No success response defined ──────────────────────────────

function checkNoSuccessResponse(spec: OpenAPIRaw): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation?.responses) continue;

      const statusCodes = Object.keys(operation.responses);
      const hasSuccess = statusCodes.some((code) => {
        if (code === "default") return false;
        const num = parseInt(code, 10);
        return num >= 200 && num < 300;
      });

      if (!hasSuccess) {
        diagnostics.push(
          specDiagnostic(
            "E1019",
            formatFragmentPointer(["paths", path, method, "responses"]),
            `${method.toUpperCase()} ${path} has no 2xx success response (only ${
              statusCodes.join(", ")
            }). Mock server will return an error status for valid requests`,
            {
              suggestion:
                "Add a 200 or 201 response to define the expected success behavior",
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}

// ── E1020: Request body on unconventional methods ───────────────────

// GET/HEAD bodies are stripped by the HTTP server before Steady can read them.
const BODY_STRIPPED_METHODS = new Set(["get", "head"]);

const UNCONVENTIONAL_BODY_METHODS = new Set([
  "get",
  "head",
  "delete",
  "options",
]);

function checkUnconventionalRequestBody(spec: OpenAPIRaw): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      if (!UNCONVENTIONAL_BODY_METHODS.has(method)) continue;
      const operation = pathItem[method];
      if (!operation?.requestBody) continue;

      const stripped = BODY_STRIPPED_METHODS.has(method);
      diagnostics.push(
        specDiagnostic(
          "E1020",
          formatFragmentPointer(["paths", path, method, "requestBody"]),
          `${method.toUpperCase()} ${path} defines a request body. HTTP ${method.toUpperCase()} requests conventionally do not carry a body`,
          {
            suggestion: stripped
              ? `${method.toUpperCase()} request bodies are stripped by the HTTP layer before Steady can read them. Body validation will be skipped. Consider using the QUERY method instead if a request body is required`
              : "Steady will validate the body if present. No action needed unless this is unintentional",
          },
        ),
      );
    }
  }

  return diagnostics;
}

// ── E1022: Invalid content type key ─────────────────────────────────

function checkInvalidContentTypeKeys(spec: OpenAPIRaw): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      // Check requestBody.content keys
      if (operation.requestBody) {
        const rb = isObject(operation.requestBody) &&
            "$ref" in operation.requestBody &&
            typeof operation.requestBody.$ref === "string"
          ? resolveLocalRef(spec, operation.requestBody.$ref)
          : operation.requestBody;

        if (isObject(rb) && isObject(rb.content)) {
          for (const key of Object.keys(rb.content)) {
            if (getMediaType(key) === null) {
              diagnostics.push(
                specDiagnostic(
                  "E1022",
                  formatFragmentPointer([
                    "paths",
                    path,
                    method,
                    "requestBody",
                    "content",
                    key,
                  ]),
                  `Invalid content type key ${
                    JSON.stringify(key)
                  } in request body for ${method.toUpperCase()} ${path}`,
                  {
                    suggestion:
                      'Replace with a valid media type like "application/json". The schema under this key is unreachable until fixed',
                  },
                ),
              );
            }
          }
        }
      }

      // Check responses.*.content keys
      if (operation.responses) {
        for (
          const [statusCode, responseOrRef] of Object.entries(
            operation.responses,
          )
        ) {
          const responseObj = isObject(responseOrRef) &&
              "$ref" in responseOrRef &&
              typeof responseOrRef.$ref === "string"
            ? resolveLocalRef(spec, responseOrRef.$ref)
            : responseOrRef;
          if (!isObject(responseObj)) continue;

          const content = responseObj.content;
          if (!isObject(content)) continue;

          for (const key of Object.keys(content)) {
            if (getMediaType(key) === null) {
              diagnostics.push(
                specDiagnostic(
                  "E1022",
                  formatFragmentPointer([
                    "paths",
                    path,
                    method,
                    "responses",
                    statusCode,
                    "content",
                    key,
                  ]),
                  `Invalid content type key ${
                    JSON.stringify(key)
                  } in ${statusCode} response for ${method.toUpperCase()} ${path}`,
                  {
                    suggestion:
                      'Replace with a valid media type like "application/json". The schema under this key is unreachable until fixed',
                  },
                ),
              );
            }
          }
        }
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

function checkInvalidComponentNames(spec: OpenAPIRaw): Diagnostic[] {
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
            formatFragmentPointer(["components", section, name]),
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
  /** Fragment pointer to the object containing this $ref. */
  pointer: FragmentPointer;
  /** The $ref value itself (e.g., "#/components/schemas/User"). */
  ref: string;
  /** Other keys on the same object alongside $ref. */
  siblingKeys: string[];
}

interface WalkResult {
  refs: RefInfo[];
  /** All schema objects found, with their fragment-pointer locations. */
  schemas: Array<{ schema: Record<string, unknown>; pointer: FragmentPointer }>;
  /** Map of $anchor value to FragmentPointer. */
  anchors: Map<string, FragmentPointer>;
  /** Map of $id value to FragmentPointer. */
  ids: Map<string, FragmentPointer>;
  /** All unique $ref values. */
  uniqueRefs: Set<string>;
  /** FragmentPointer -> set of $ref targets. Collected during walk. */
  edges: Map<FragmentPointer, Set<string>>;
  /** Number of object nodes visited. */
  pointerCount: number;
}

function walkSpec(spec: OpenAPIRaw): WalkResult {
  const refs: RefInfo[] = [];
  const schemas: WalkResult["schemas"] = [];
  const anchors = new Map<string, FragmentPointer>();
  const ids = new Map<string, FragmentPointer>();
  const uniqueRefs = new Set<string>();
  const edges = new Map<FragmentPointer, Set<string>>();
  let pointerCount = 0;

  // ── Generic tree walker for $ref, $anchor, $id, edge collection ─
  //
  // The walker threads a structured `PointerPath`; a `FragmentPointer`
  // is materialized only when a node is indexed (has $ref, $anchor, or
  // $id) so that the hot path of unrelated nodes stays allocation-light.
  function walkForRefs(obj: unknown, path: PointerPath): void {
    if (!isObject(obj)) {
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const item = obj[i];
          if (item !== null && typeof item === "object") {
            walkForRefs(item, [...path, String(i)]);
          }
        }
      }
      return;
    }

    pointerCount++;

    const hasRef = typeof obj.$ref === "string";
    const hasAnchor = typeof obj.$anchor === "string";
    const hasId = typeof obj.$id === "string";

    if (hasRef || hasAnchor || hasId) {
      const pointer = formatFragmentPointer(path);

      if (hasRef && typeof obj.$ref === "string") {
        const siblingKeys = Object.keys(obj).filter((k) => k !== "$ref");
        refs.push({ pointer, ref: obj.$ref, siblingKeys });
        uniqueRefs.add(obj.$ref);

        // Collect edge for DocIndex
        const existing = edges.get(pointer);
        if (existing) {
          existing.add(obj.$ref);
        } else {
          edges.set(pointer, new Set([obj.$ref]));
        }
      }

      // Collect $anchor and $id indexes for O(1) lookup
      if (hasAnchor && typeof obj.$anchor === "string") {
        anchors.set(obj.$anchor, pointer);
      }
      if (hasId && typeof obj.$id === "string") {
        ids.set(obj.$id, pointer);
      }
    }

    for (const key of Object.keys(obj)) {
      if (key === "$ref") continue;
      const value = obj[key];
      // Skip primitives - they can't contain $ref
      if (value === null || typeof value !== "object") continue;
      walkForRefs(value, [...path, key]);
    }
  }

  // Collect all $refs from the entire spec
  walkForRefs(spec, []);

  // ── Schema walker for constraint checking ─────────────────────
  //
  // Takes a structured `PointerPath`; children are appended via
  // `[...path, segment]`. The formatted `FragmentPointer` is
  // materialized only once per visited node, at the edge where the
  // schema is pushed into `schemas`.
  function visitSchema(obj: unknown, path: PointerPath): void {
    if (!isObject(obj)) return;
    if ("$ref" in obj) return;

    schemas.push({ schema: obj, pointer: formatFragmentPointer(path) });

    // Recurse into sub-schemas
    const properties = obj.properties;
    if (isObject(properties)) {
      for (const [name, sub] of Object.entries(properties)) {
        visitSchema(sub, [...path, "properties", name]);
      }
    }

    const items = obj.items;
    if (isObject(items) && !("$ref" in items)) {
      visitSchema(items, [...path, "items"]);
    }

    const additionalProperties = obj.additionalProperties;
    if (isObject(additionalProperties) && !("$ref" in additionalProperties)) {
      visitSchema(additionalProperties, [...path, "additionalProperties"]);
    }

    const patternProperties = obj.patternProperties;
    if (isObject(patternProperties)) {
      for (const [pattern, sub] of Object.entries(patternProperties)) {
        visitSchema(sub, [...path, "patternProperties", pattern]);
      }
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      const arr = obj[keyword];
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          visitSchema(arr[i], [...path, keyword, String(i)]);
        }
      }
    }

    const not = obj.not;
    if (isObject(not) && !("$ref" in not)) {
      visitSchema(not, [...path, "not"]);
    }

    // $defs
    const defs = obj.$defs;
    if (isObject(defs)) {
      for (const [name, sub] of Object.entries(defs)) {
        visitSchema(sub, [...path, "$defs", name]);
      }
    }

    // Conditional: if/then/else
    for (const keyword of ["if", "then", "else"] as const) {
      const sub = obj[keyword];
      if (isObject(sub) && !("$ref" in sub)) {
        visitSchema(sub, [...path, keyword]);
      }
    }
  }

  // Component schemas
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      visitSchema(schema, ["components", "schemas", name]);
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
          visitSchema(param.schema, [
            "paths",
            path,
            "parameters",
            String(i),
            "schema",
          ]);
        }
      }
    }

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const opPath: PointerPath = ["paths", path, method];

      // Operation parameter schemas
      if (operation.parameters) {
        for (let i = 0; i < operation.parameters.length; i++) {
          const param = operation.parameters[i];
          if (!param || "$ref" in param) continue;
          if (param.schema && !("$ref" in param.schema)) {
            visitSchema(param.schema, [
              ...opPath,
              "parameters",
              String(i),
              "schema",
            ]);
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
              visitSchema(mediaObj.schema, [
                ...opPath,
                "requestBody",
                "content",
                mediaType,
                "schema",
              ]);
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
          const responsePath: PointerPath = [
            ...opPath,
            "responses",
            statusCode,
          ];

          // Response content schemas
          const content = response.content;
          if (isObject(content)) {
            for (const [mediaType, mediaObj] of Object.entries(content)) {
              if (isObject(mediaObj) && mediaObj.schema) {
                visitSchema(mediaObj.schema, [
                  ...responsePath,
                  "content",
                  mediaType,
                  "schema",
                ]);
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
                visitSchema(headerObj.schema, [
                  ...responsePath,
                  "headers",
                  headerName,
                  "schema",
                ]);
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
            const cbBase: PointerPath = [
              ...opPath,
              "callbacks",
              cbName,
              cbPath,
            ];
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
                      visitSchema(mtObj.schema, [
                        ...cbBase,
                        cbMethod,
                        "requestBody",
                        "content",
                        mt,
                        "schema",
                      ]);
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
                        visitSchema(mtObj.schema, [
                          ...cbBase,
                          cbMethod,
                          "responses",
                          sc,
                          "content",
                          mt,
                          "schema",
                        ]);
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
        const opPath: PointerPath = ["webhooks", name, method];

        if (operation.parameters) {
          for (let i = 0; i < operation.parameters.length; i++) {
            const param = operation.parameters[i];
            if (!param || "$ref" in param) continue;
            if (param.schema && !("$ref" in param.schema)) {
              visitSchema(param.schema, [
                ...opPath,
                "parameters",
                String(i),
                "schema",
              ]);
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
                visitSchema(mtObj.schema, [
                  ...opPath,
                  "requestBody",
                  "content",
                  mt,
                  "schema",
                ]);
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
                  visitSchema(mtObj.schema, [
                    ...opPath,
                    "responses",
                    sc,
                    "content",
                    mt,
                    "schema",
                  ]);
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    refs,
    schemas,
    anchors,
    ids,
    uniqueRefs,
    edges,
    pointerCount,
  };
}

// ── E1007: Keywords alongside $ref (3.0.x only) ────────────────────

function checkRefSiblings(
  spec: OpenAPIRaw,
  refs: RefInfo[],
): Diagnostic[] {
  // In OpenAPI 3.1.x, siblings alongside $ref are valid (JSON Schema 2020-12).
  // In 3.0.x, only $ref is processed. Siblings are ignored.
  if (spec.openapi.startsWith("3.1")) return [];

  const diagnostics: Diagnostic[] = [];

  for (const info of refs) {
    if (info.siblingKeys.length === 0) continue;
    // Steady doesn't serve webhooks. Skip refs from webhook schemas
    if (info.pointer.startsWith("#/webhooks/")) continue;
    // summary/description alongside $ref are so commonly used that flagging
    // them would be noisy. Skip them.
    const meaningful = info.siblingKeys.filter(
      (k) => k !== "summary" && k !== "description",
    );
    if (meaningful.length === 0) continue;

    diagnostics.push(
      specDiagnostic(
        "E1007",
        info.pointer,
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
  spec: OpenAPIRaw,
  refs: RefInfo[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Cache: pointer -> resolves successfully?
  // 19K refs often share ~4K unique targets; resolve each only once.
  const resolveCache = new Map<string, boolean>();

  for (const info of refs) {
    if (!info.ref.startsWith("#")) continue;
    if (info.ref === "#") continue; // Root document always resolves

    const cached = resolveCache.get(info.ref);
    if (cached === true) continue;
    if (cached === false) {
      diagnostics.push(
        unresolvedRefDiagnostic(info),
      );
      continue;
    }

    try {
      resolve(spec, info.ref);
      resolveCache.set(info.ref, true);
    } catch {
      resolveCache.set(info.ref, false);
      diagnostics.push(
        unresolvedRefDiagnostic(info),
      );
    }
  }

  return diagnostics;
}

function unresolvedRefDiagnostic(info: RefInfo): Diagnostic {
  return specDiagnostic(
    "E1004",
    info.pointer,
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
  );
}

// ── E1005: Circular $ref ────────────────────────────────────────────

function checkCircularRefs(
  refs: RefInfo[],
  spec: OpenAPIRaw,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Collect all ref targets as graph nodes (already #-prefixed via $ref values)
  const targets = new Set<string>();
  for (const info of refs) {
    if (!info.ref.startsWith("#")) continue;
    targets.add(info.ref);
  }

  // Build adjacency list AND track which RefInfos create each edge.
  // All keys/values use #-prefixed pointers (FragmentPointer convention).
  const edges = new Map<string, Set<string>>();
  const edgeRefs = new Map<string, Map<string, RefInfo[]>>();

  for (const info of refs) {
    if (!info.ref.startsWith("#")) continue;

    // Find which target this ref is nested under (longest prefix match).
    // Walk up the pointer path checking each ancestor against the target set.
    let container: string | null = null;
    let path: string = info.pointer;
    while (path.length > 0) {
      if (targets.has(path)) {
        container = path;
        break;
      }
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash < 0) break;
      path = path.slice(0, lastSlash);
    }

    if (container === null) continue;

    // Add to adjacency list
    const existing = edges.get(container);
    if (existing) {
      existing.add(info.ref);
    } else {
      edges.set(container, new Set([info.ref]));
    }

    // Track RefInfo for this edge
    let containerMap = edgeRefs.get(container);
    if (!containerMap) {
      containerMap = new Map();
      edgeRefs.set(container, containerMap);
    }
    let targetList = containerMap.get(info.ref);
    if (!targetList) {
      targetList = [];
      containerMap.set(info.ref, targetList);
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
                next,
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
  spec: OpenAPIRaw,
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
  spec: OpenAPIRaw,
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
function getRequiredAt(spec: OpenAPIRaw, pointer: string): string[] {
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
  spec: OpenAPIRaw,
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

    // Const + enum conflict: const value must be in the enum
    const constVal = schema.const;
    if (
      constVal !== undefined && Array.isArray(enumVal) && enumVal.length > 0
    ) {
      if (!enumVal.includes(constVal)) {
        diagnostics.push(
          specDiagnostic(
            "E1012",
            pointer,
            `Impossible constraint: const value ${
              JSON.stringify(constVal)
            } is not in enum ${JSON.stringify(enumVal)}`,
            {
              suggestion:
                "The const value must be one of the enum values, or remove one of the constraints",
              actual: { const: constVal, enum: enumVal },
            },
          ),
        );
      }
    }

    // Conflicting type in allOf
    const allOf = schema.allOf;
    if (Array.isArray(allOf)) {
      // Collect types as Sets (handling both string and array forms)
      const typeSets: Set<string>[] = [];
      for (const sub of allOf) {
        if (!isObject(sub)) continue;
        if (typeof sub.type === "string") {
          typeSets.push(new Set([sub.type]));
        } else if (Array.isArray(sub.type)) {
          const types = sub.type.filter(
            (t: unknown): t is string => typeof t === "string",
          );
          if (types.length > 0) {
            typeSets.push(new Set(types));
          }
        }
      }

      if (typeSets.length > 1) {
        // Compute intersection across all type sets
        let intersection = typeSets[0];
        if (intersection) {
          for (let i = 1; i < typeSets.length; i++) {
            const next = typeSets[i];
            if (!next) continue;
            intersection = new Set(
              [...intersection].filter((t) => next.has(t)),
            );
          }

          if (intersection.size === 0) {
            const allTypes = typeSets.map((s) => [...s]);
            diagnostics.push(
              specDiagnostic(
                "E1012",
                pointer,
                `Impossible constraint: allOf members require conflicting types: ${
                  allTypes.map((t) =>
                    t.length === 1 ? t[0] : `[${t.join(", ")}]`
                  ).join(", ")
                }`,
                {
                  suggestion:
                    "An allOf with conflicting type requirements can never validate",
                  actual: allTypes.flat(),
                },
              ),
            );
          }
        }
      }

      // allOf bound merging: collect min/max across members
      diagnostics.push(...checkAllOfBounds(allOf, pointer));

      // allOf enum intersection: empty intersection is impossible
      diagnostics.push(...checkAllOfEnums(allOf, pointer));
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

/**
 * Check for empty enum intersection across allOf members.
 * e.g., allOf: [{enum: ["a","b"]}, {enum: ["c","d"]}] is impossible.
 * Only checks when 2+ members have enum constraints.
 */
function checkAllOfEnums(
  allOf: unknown[],
  pointer: string,
): Diagnostic[] {
  const enums: unknown[][] = [];
  for (const sub of allOf) {
    if (!isObject(sub)) continue;
    if (Array.isArray(sub.enum)) {
      enums.push(sub.enum);
    }
  }

  if (enums.length < 2) return [];

  // Progressive intersection
  let intersection = new Set(enums[0]);
  for (let i = 1; i < enums.length; i++) {
    const next = new Set(enums[i]);
    intersection = new Set(
      [...intersection].filter((v) => next.has(v)),
    );
  }

  if (intersection.size > 0) return [];

  return [
    specDiagnostic(
      "E1012",
      pointer,
      "Impossible constraint: allOf enum intersection is empty (no value satisfies all members)",
      {
        suggestion:
          "The enum arrays across allOf members share no common values",
        actual: enums,
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
