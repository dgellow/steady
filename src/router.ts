/**
 * Unified router for Steady.
 *
 * Matches HTTP requests against OpenAPI path patterns with:
 * - Pre-compiled routes for O(1) exact matches and efficient pattern matching
 * - Query disambiguation (e.g., /templates?desc=cached_upload)
 * - E2001/E2002 diagnostic creation on failure with double-? enrichment
 *
 * Used by both MockServer (for response generation) and DiagnosticEngine
 * (for validation). Single router instance, single code path.
 */

import type {
  OperationObject,
  PathItemObject,
  PathsObject,
} from "@steady/openapi";
import type { Diagnostic, DiagnosticDisplay } from "./diagnostic.ts";
import { getCode } from "./codes/registry.ts";
import {
  compilePathPattern,
  matchCompiledPath,
  type PathSegment,
} from "./path-matcher.ts";
import { HTTP_METHODS, type HttpMethod, isHttpMethod } from "./types.ts";

// ── Types ───────────────────────────────────────────────────────────

/** Input to route matching. */
export interface RoutingRequest {
  /** URL pathname (e.g., "/users/123"). */
  path: string;
  /** HTTP method (case-insensitive). */
  method: string;
  /** Query parameters from the URL. Used for disambiguation and double-? enrichment. */
  queryParams?: URLSearchParams;
}

/** Successful match result with all info needed by server and engine. */
export interface RouteMatch {
  pathPattern: string;
  pathParams: Record<string, string>;
  operation: OperationObject;
  pathItem: PathItemObject;
  statusCode: string;
  /** Query keys consumed during route disambiguation (e.g., ["desc"] for /templates?desc=cached_upload). */
  consumedQueryParams?: string[];
}

/** No path template matches the request path (E2001, HTTP 404). */
export interface PathNotFound {
  matched: false;
  reason: "path-not-found";
  diagnostics: Diagnostic[];
}

/** A path template matches, but not for this method (E2002, HTTP 405). */
export interface MethodNotAllowed {
  matched: false;
  reason: "method-not-allowed";
  /**
   * Methods defined by every path template that matches the request path, in
   * canonical order. This is the content of the Allow header.
   */
  allowedMethods: HttpMethod[];
  diagnostics: Diagnostic[];
}

/** Discriminated union: successful match or the reason routing failed. */
export type RouteResult =
  | { matched: true } & RouteMatch
  | PathNotFound
  | MethodNotAllowed;

/** Pre-compiled path pattern with associated path item. */
interface CompiledPath {
  pattern: string;
  pathItem: PathItemObject;
  segments: PathSegment[];
  segmentCount: number;
  requiredQuery?: Record<string, string>;
}

// ── Router ──────────────────────────────────────────────────────────

export class Router {
  private readonly exactRoutes: Map<string, CompiledPath[]>;
  private readonly patternRoutes: CompiledPath[];
  private readonly paths: PathsObject;

  constructor(paths: PathsObject) {
    this.paths = paths;

    const exactRoutes = new Map<string, CompiledPath[]>();
    const patternRoutes: CompiledPath[] = [];

    for (const [pattern, pathItem] of Object.entries(paths)) {
      // Parse query string from path if present (e.g., /files?beta=true)
      const queryIndex = pattern.indexOf("?");
      const basePath = queryIndex >= 0 ? pattern.slice(0, queryIndex) : pattern;
      const requiredQuery = queryIndex >= 0
        ? Object.fromEntries(
          new URLSearchParams(pattern.slice(queryIndex + 1)),
        )
        : undefined;

      if (!basePath.includes("{")) {
        const entry: CompiledPath = {
          pattern,
          pathItem,
          segments: [],
          segmentCount: 0,
          requiredQuery,
        };
        const existing = exactRoutes.get(basePath) ?? [];
        existing.push(entry);
        exactRoutes.set(basePath, existing);
      } else {
        const compiled = compilePathPattern(basePath);
        patternRoutes.push({
          ...compiled,
          pattern,
          pathItem,
          requiredQuery,
        });
      }
    }

    // Sort exact route entries: routes with requiredQuery first (more specific)
    for (const entries of exactRoutes.values()) {
      entries.sort((a, b) => {
        if (a.requiredQuery && !b.requiredQuery) return -1;
        if (!a.requiredQuery && b.requiredQuery) return 1;
        return 0;
      });
    }

    // Sort pattern routes by specificity:
    // 1. More literal segments first
    // 2. More mixed segments (have literal prefix/suffix constraints) before pure params
    // 3. Routes with requiredQuery before those without
    patternRoutes.sort((a, b) => {
      const aLiterals = a.segments.filter((s) => s.type === "literal").length;
      const bLiterals = b.segments.filter((s) => s.type === "literal").length;
      if (bLiterals !== aLiterals) return bLiterals - aLiterals;
      const aMixed = a.segments.filter((s) => s.type === "mixed").length;
      const bMixed = b.segments.filter((s) => s.type === "mixed").length;
      if (bMixed !== aMixed) return bMixed - aMixed;
      if (a.requiredQuery && !b.requiredQuery) return -1;
      if (!a.requiredQuery && b.requiredQuery) return 1;
      return 0;
    });

    this.exactRoutes = exactRoutes;
    this.patternRoutes = patternRoutes;
  }

  /**
   * Match a request against the spec's path templates.
   *
   * Tries exact paths first (O(1)), then parameterized paths (sorted by specificity).
   * Handles query disambiguation. On failure, returns E2001/E2002 diagnostics
   * with double-? enrichment.
   */
  match(request: RoutingRequest): RouteResult {
    const method = request.method.toLowerCase();
    const query = request.queryParams ?? new URLSearchParams();

    // Path templates that match the path but do not define the method.
    // More than one is possible when the spec has conflicting templates.
    const pathMatches: { pathItem: PathItemObject; pattern: string }[] = [];

    // Try exact match first (O(1) lookup)
    const exactMatches = this.exactRoutes.get(request.path);
    if (exactMatches) {
      for (const entry of exactMatches) {
        if (matchesQueryRequirements(query, entry.requiredQuery)) {
          const operation = getOperation(entry.pathItem, method);
          if (operation) {
            return {
              matched: true,
              pathPattern: entry.pattern,
              pathParams: {},
              operation,
              pathItem: entry.pathItem,
              statusCode: selectStatusCode(operation),
              consumedQueryParams: entry.requiredQuery
                ? Object.keys(entry.requiredQuery)
                : undefined,
            };
          }
          pathMatches.push({
            pathItem: entry.pathItem,
            pattern: entry.pattern,
          });
        }
      }
    }

    // Try pattern matching with pre-compiled routes
    for (const compiled of this.patternRoutes) {
      const params = matchCompiledPath(request.path, compiled);
      if (params && matchesQueryRequirements(query, compiled.requiredQuery)) {
        const operation = getOperation(compiled.pathItem, method);
        if (operation) {
          return {
            matched: true,
            pathPattern: compiled.pattern,
            pathParams: params,
            operation,
            pathItem: compiled.pathItem,
            statusCode: selectStatusCode(operation),
            consumedQueryParams: compiled.requiredQuery
              ? Object.keys(compiled.requiredQuery)
              : undefined,
          };
        }
        // Path matches but method doesn't. Keep searching; another path
        // with the same pattern might have the method (e.g., /secrets/{secret_id}
        // DELETE vs /secrets/{secret_key} POST).
        pathMatches.push({
          pathItem: compiled.pathItem,
          pattern: compiled.pattern,
        });
      }
    }

    // No match. Produce routing diagnostic.
    if (pathMatches.length > 0) {
      const defined = new Set(
        pathMatches.flatMap((m) => getMethodsForPath(m.pathItem)),
      );
      const allowedMethods = HTTP_METHODS.filter((m) => defined.has(m));
      return {
        matched: false,
        reason: "method-not-allowed",
        allowedMethods,
        diagnostics: [
          createMethodNotAllowed(
            request,
            pathMatches.map((m) => m.pattern),
            allowedMethods,
          ),
        ],
      };
    }

    return {
      matched: false,
      reason: "path-not-found",
      diagnostics: [createPathNotFound(request, this.paths)],
    };
  }
}

// ── Utilities (exported for use by lifecycle.ts, etc.) ───────────────

/**
 * Select the best status code to return (prefer 200, then first available).
 *
 * OpenAPI allows "default" and "1XX", "2XX", etc. as response keys.
 * We only select numeric status codes; fallback to 200 if none found.
 */
export function selectStatusCode(operation: OperationObject): string {
  if (operation.responses["200"]) return "200";
  if (operation.responses["201"]) return "201";
  if (operation.responses["204"]) return "204";

  const numericCode = Object.keys(operation.responses).find(
    (code) => /^\d{3}$/.test(code),
  );
  return numericCode || "200";
}

/**
 * Get available HTTP methods for a path item.
 */
export function getMethodsForPath(pathItem: PathItemObject): HttpMethod[] {
  return HTTP_METHODS.filter((method) => pathItem[method] !== undefined);
}

// ── Private helpers ─────────────────────────────────────────────────

/**
 * Check if request query params satisfy route's required query params.
 */
function matchesQueryRequirements(
  requestQuery: URLSearchParams,
  requiredQuery?: Record<string, string>,
): boolean {
  if (!requiredQuery) return true;
  for (const [key, value] of Object.entries(requiredQuery)) {
    if (requestQuery.get(key) !== value) return false;
  }
  return true;
}

/**
 * Get the operation for a method from a PathItemObject.
 * Type-safe without `as` casts. Uses Pick to narrow.
 */
function getOperation(
  pathItem: PathItemObject,
  method: string,
): OperationObject | undefined {
  if (!isHttpMethod(method)) return undefined;
  const ops: Pick<PathItemObject, HttpMethod> = pathItem;
  return ops[method];
}

// ── Diagnostic creation ─────────────────────────────────────────────

function createPathNotFound(
  request: RoutingRequest,
  paths: PathsObject,
): Diagnostic {
  const e2001 = getCode("E2001");
  const availablePaths = Object.keys(paths);

  const defaultSuggestion = availablePaths.length > 0
    ? `Available paths: ${availablePaths.slice(0, 5).join(", ")}${
      availablePaths.length > 5 ? "..." : ""
    }`
    : "No paths defined in the OpenAPI spec";

  const { confidence, reasoning, display } = enrichWithDoubleQuestion(
    request,
    0.7,
    [`No path definition matches "${request.path}"`],
  );

  // When double-? detected, use a targeted suggestion instead of generic paths list
  const suggestion = display
    ? "Use '&' to separate additional query parameters"
    : defaultSuggestion;

  return {
    code: "E2001",
    severity: e2001.severity,
    category: e2001.category,
    requestPath: request.path,
    specPointer: `${request.method.toUpperCase()} ${request.path}`,
    message: `Path not found: ${request.path}`,
    attribution: { confidence, reasoning },
    suggestion,
    ...(display ? { display } : {}),
  };
}

function createMethodNotAllowed(
  request: RoutingRequest,
  matchedPatterns: string[],
  allowedMethods: HttpMethod[],
): Diagnostic {
  const e2002 = getCode("E2002");
  // The first match is the most specific template; it names the endpoint.
  const matchedPattern = matchedPatterns[0] ?? request.path;

  const suggestion = `Available methods for ${
    matchedPatterns.map((p) => `"${p}"`).join(", ")
  }: ${allowedMethods.map((m) => m.toUpperCase()).join(", ")}`;

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
    specPointer: `${request.method.toUpperCase()} ${request.path}`,
    message:
      `Method ${request.method.toUpperCase()} not allowed for ${matchedPattern}`,
    attribution: { confidence, reasoning },
    suggestion,
    ...(display ? { display } : {}),
  };
}

// ── Double-? enrichment ─────────────────────────────────────────────

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
          "Query parameter value contains '?'. Likely URL construction bug",
          "SDK may be appending '?params' to a URL already containing '?'",
        ],
        display: {
          context: [{
            text,
            highlight: {
              start: highlightStart,
              end: highlightStart + 1,
              label: "'?' in value, likely double-? bug",
            },
          }],
          notes: [
            "SDK may be appending '?params' to a URL that already has '?'",
            "Use '&' to separate additional query parameters",
          ],
        },
      };
    }
  }

  return { confidence: defaultConfidence, reasoning: baseReasoning };
}
