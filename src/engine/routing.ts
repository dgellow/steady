/**
 * Route matching with diagnostic enrichment.
 *
 * Matches an HTTP request against the OpenAPI spec's path templates.
 * When matching fails, produces E2001 (path not found) or E2002 (method
 * not allowed) diagnostics with enrichment patterns (e.g., double-?).
 *
 * This is step 1 of the DiagnosticEngine.analyze() flow.
 */

import type {
  OperationObject,
  PathItemObject,
  PathsObject,
} from "@steady/openapi";
import type { Diagnostic, DiagnosticDisplay } from "../diagnostic.ts";
import { getCode } from "../codes/registry.ts";
import { matchPathPattern } from "../path-matcher.ts";

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
type HttpMethod = (typeof HTTP_METHODS)[number];

/** Input to route matching. */
export interface RoutingRequest {
  /** URL pathname (e.g., "/users/123"). */
  path: string;
  /** HTTP method (case-insensitive). */
  method: string;
  /** Query parameters — used for double-? enrichment. */
  queryParams?: URLSearchParams;
}

/** Discriminated union: successful match or routing diagnostics. */
export type RouteResult =
  | {
    matched: true;
    operation: OperationObject;
    pathItem: PathItemObject;
    pathPattern: string;
    pathParams: Record<string, string>;
  }
  | {
    matched: false;
    diagnostics: Diagnostic[];
  };

/**
 * Match a request against the spec's path templates.
 *
 * Tries exact paths first, then parameterized paths. Returns the matched
 * operation or routing diagnostics (E2001/E2002) with enrichment.
 */
export function matchRoute(
  paths: PathsObject,
  request: RoutingRequest,
): RouteResult {
  const method = request.method.toLowerCase();

  // Separate exact and parameterized paths, try exact first
  const exactPaths: Array<[string, PathItemObject]> = [];
  const paramPaths: Array<[string, PathItemObject]> = [];

  for (const [pattern, pathItem] of Object.entries(paths)) {
    if (pattern.includes("{")) {
      paramPaths.push([pattern, pathItem]);
    } else {
      exactPaths.push([pattern, pathItem]);
    }
  }

  // Track first path match for E2002 (method not allowed)
  let firstPathMatch: { pathItem: PathItemObject; pattern: string } | null =
    null;

  // Try exact matches first
  for (const [pattern, pathItem] of exactPaths) {
    if (request.path === pattern) {
      const operation = getOperation(pathItem, method);
      if (operation) {
        return {
          matched: true,
          operation,
          pathItem,
          pathPattern: pattern,
          pathParams: {},
        };
      }
      if (!firstPathMatch) {
        firstPathMatch = { pathItem, pattern };
      }
    }
  }

  // Try parameterized matches
  for (const [pattern, pathItem] of paramPaths) {
    const params = matchPathPattern(request.path, pattern);
    if (params) {
      const operation = getOperation(pathItem, method);
      if (operation) {
        return {
          matched: true,
          operation,
          pathItem,
          pathPattern: pattern,
          pathParams: params,
        };
      }
      if (!firstPathMatch) {
        firstPathMatch = { pathItem, pattern };
      }
    }
  }

  // No match — produce routing diagnostic
  if (firstPathMatch) {
    return {
      matched: false,
      diagnostics: [
        createMethodNotAllowed(
          request,
          firstPathMatch.pattern,
          firstPathMatch.pathItem,
        ),
      ],
    };
  }

  return {
    matched: false,
    diagnostics: [createPathNotFound(request, paths)],
  };
}

/**
 * Get the operation for a method from a PathItemObject.
 * Type-safe without `as` casts — uses Pick to narrow.
 */
function getOperation(
  pathItem: PathItemObject,
  method: string,
): OperationObject | undefined {
  if (!isHttpMethod(method)) return undefined;
  const ops: Pick<PathItemObject, HttpMethod> = pathItem;
  return ops[method];
}

function isHttpMethod(method: string): method is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(method);
}

/**
 * Get available HTTP methods on a path item.
 */
function getAvailableMethods(pathItem: PathItemObject): HttpMethod[] {
  return HTTP_METHODS.filter((m) => {
    const ops: Pick<PathItemObject, HttpMethod> = pathItem;
    return ops[m] !== undefined;
  });
}

// ── Diagnostic creation ─────────────────────────────────────────────

function createPathNotFound(
  request: RoutingRequest,
  paths: PathsObject,
): Diagnostic {
  const e2001 = getCode("E2001");
  const availablePaths = Object.keys(paths);

  const suggestion = availablePaths.length > 0
    ? `Available paths: ${availablePaths.slice(0, 5).join(", ")}${
      availablePaths.length > 5 ? "..." : ""
    }`
    : "No paths defined in the OpenAPI spec";

  const { confidence, reasoning, display } = enrichWithDoubleQuestion(
    request,
    0.7,
    [`No path definition matches "${request.path}"`],
  );

  return {
    code: "E2001",
    severity: e2001.severity,
    category: e2001.category,
    requestPath: request.path,
    specPointer: "#/paths",
    message: `Path not found: ${request.path}`,
    attribution: { confidence, reasoning },
    suggestion,
    ...(display ? { display } : {}),
  };
}

function createMethodNotAllowed(
  request: RoutingRequest,
  matchedPattern: string,
  pathItem: PathItemObject,
): Diagnostic {
  const e2002 = getCode("E2002");
  const available = getAvailableMethods(pathItem);

  const suggestion = `Available methods for "${matchedPattern}": ${
    available.map((m) => m.toUpperCase()).join(", ")
  }`;

  const { confidence, reasoning, display } = enrichWithDoubleQuestion(
    request,
    0.7,
    [
      `Path "${matchedPattern}" matched, but method ${request.method.toUpperCase()} is not defined`,
    ],
  );

  return {
    code: "E2002",
    severity: e2002.severity,
    category: e2002.category,
    requestPath: request.path,
    specPointer: `#/paths/${escapeJsonPointer(matchedPattern)}`,
    message:
      `Method ${request.method.toUpperCase()} not allowed for ${matchedPattern}`,
    attribution: { confidence, reasoning },
    suggestion,
    ...(display ? { display } : {}),
  };
}

/** Result of double-? enrichment. */
interface EnrichmentResult {
  confidence: number;
  reasoning: string[];
  display?: DiagnosticDisplay;
}

/**
 * Detect double-? URL construction bug and boost confidence if found.
 *
 * When a query param value contains '?', it likely means the SDK appended
 * '?params' to a URL already containing '?'.
 */
function enrichWithDoubleQuestion(
  request: RoutingRequest,
  defaultConfidence: number,
  baseReasoning: string[],
): EnrichmentResult {
  if (!request.queryParams) {
    return { confidence: defaultConfidence, reasoning: baseReasoning };
  }

  for (const [key, value] of request.queryParams) {
    const qIdx = value.indexOf("?");
    if (qIdx >= 0) {
      const text = `${key}=${value}`;
      const highlightStart = key.length + 1 + qIdx; // skip "key="
      return {
        confidence: 0.95,
        reasoning: [
          ...baseReasoning,
          "Query parameter value contains '?' — likely URL construction bug",
          "SDK may be appending '?params' to a URL already containing '?'",
        ],
        display: {
          context: [{
            text,
            highlight: {
              start: highlightStart,
              end: highlightStart + 1,
              label: "'?' in value — likely double-? bug",
            },
          }],
        },
      };
    }
  }

  return { confidence: defaultConfidence, reasoning: baseReasoning };
}

function escapeJsonPointer(path: string): string {
  return path.replace(/~/g, "~0").replace(/\//g, "~1");
}
