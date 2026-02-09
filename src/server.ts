/**
 * Steady Mock Server - Enterprise-grade OpenAPI mock server
 *
 * Features:
 * - Document-centric architecture for proper $ref resolution
 * - Pre-compiled path patterns for O(1) route matching
 * - Lazy schema processing with caching
 * - Graceful shutdown handling
 * - Interactive and standard logging modes
 */

import type { ResponseObject, ServerConfig } from "./types.ts";
import { HEADERS, isReference, VERSION } from "./types.ts";
import type {
  OpenAPISpec,
  OperationObject,
  PathItemObject,
} from "@steady/openapi";
import { MatchError, missingExampleError } from "./errors.ts";
import {
  OpenAPIDocument,
  RegistryResponseGenerator,
} from "@steady/json-schema";
import type { Diagnostic, GenerateOptions } from "@steady/json-schema";
import { getAttribution } from "@steady/json-schema";
import type { Logger } from "./logging/logger.ts";
import type {
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
  ValidationError,
} from "./logging/types.ts";
import { TextLogger } from "./logging/text-logger.ts";
import { JsonLogger } from "./logging/json-logger.ts";
import { TuiLogger } from "./logging/tui-logger.ts";
import { RequestValidator } from "./validator.ts";
import { DiagnosticCollector } from "./diagnostics/collector.ts";
import { OpenAPISpecDocument } from "../packages/openapi/document.ts";
import { TreeValidator } from "../packages/json-schema/tree-validator.ts";
import {
  DiagnosticEngine,
  type AnalyzeRequest,
} from "./engine/diagnostic-engine.ts";
import type { Diagnostic as EngineDiagnostic } from "./diagnostic.ts";
import { SessionStore } from "./session/store.ts";
import { handleSessionRequest } from "./session/endpoints.ts";
import {
  compilePathPattern,
  matchCompiledPath,
  type PathSegment,
} from "./path-matcher.ts";
import {
  createStreamingResponse,
  getStreamFormat,
  isStreamingContentType,
  parseStreamingOptions,
  type StreamingOptions,
} from "./streaming.ts";

/**
 * Parse Accept header into array of media types, sorted by quality value (q).
 * Returns types in preference order (highest q first).
 */
function parseAcceptHeader(header: string | null): string[] {
  if (!header) return [];

  const entries: { type: string; q: number }[] = [];
  for (const part of header.split(",")) {
    const segments = part.split(";");
    const type = segments[0]?.trim();
    if (!type) continue;

    let q = 1.0;
    for (let i = 1; i < segments.length; i++) {
      const param = segments[i]?.trim();
      if (param?.startsWith("q=")) {
        q = parseFloat(param.slice(2)) || 1.0;
        break;
      }
    }
    entries.push({ type, q });
  }

  entries.sort((a, b) => b.q - a.q);

  const result: string[] = [];
  for (const entry of entries) {
    result.push(entry.type);
  }
  return result;
}

/**
 * Check if Accept header types include JSON (application/json or wildcard).
 */
function acceptsJson(acceptTypes: string[]): boolean {
  for (const t of acceptTypes) {
    if (t === "application/json" || t === "*/*") {
      return true;
    }
  }
  return false;
}

/** HTTP methods supported by OpenAPI */
const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
] as const;
type HttpMethod = typeof HTTP_METHODS[number];

/** Pre-compiled path pattern with associated path item */
interface CompiledPath {
  pattern: string;
  pathItem: PathItemObject;
  segments: PathSegment[];
  segmentCount: number;
  requiredQuery?: Record<string, string>;
}

export class MockServer {
  /** Document-centric OpenAPI processing */
  private document: OpenAPIDocument;
  private abortController: AbortController;
  private logger: Logger;
  private validator: RequestValidator;
  private diagnosticCollector: DiagnosticCollector;
  private diagnosticEngine: DiagnosticEngine;
  private sessionStore: SessionStore;
  private serverFinished: Promise<void> | null = null;
  private startTime: Date = new Date();
  private requestCount = 0;
  private failedCount = 0;

  // Pre-compiled routes for O(1) exact matches and efficient pattern matching
  // exactRoutes: basePath -> array of routes (to handle /files and /files?beta=true)
  private exactRoutes = new Map<string, CompiledPath[]>();
  private patternRoutes: CompiledPath[] = [];

  constructor(
    private spec: OpenAPISpec,
    private config: ServerConfig,
  ) {
    // Create document-centric processor - all $refs will resolve correctly
    this.document = new OpenAPIDocument(spec);

    this.abortController = new AbortController();
    this.diagnosticCollector = new DiagnosticCollector();
    this.sessionStore = new SessionStore();

    // Create logger based on mode and format
    if (config.interactive) {
      this.logger = new TuiLogger({
        level: config.logLevel,
        color: true,
        logBodies: config.logBodies,
      });
    } else if (config.logFormat === "json") {
      this.logger = new JsonLogger({
        level: config.logLevel,
        logBodies: config.logBodies,
      });
    } else {
      this.logger = new TextLogger({
        level: config.logLevel,
        color: true,
        logBodies: config.logBodies,
      });
    }

    this.validator = new RequestValidator(
      this.document.schemas,
      config.validator,
    );

    // New diagnostics engine
    const specDoc = new OpenAPISpecDocument(spec);
    const treeValidator = new TreeValidator({
      resolveRef: (ref) => specDoc.resolveSchema(ref),
    });
    this.diagnosticEngine = new DiagnosticEngine(specDoc, treeValidator);

    // Pre-compile all path patterns at construction time
    this.compileRoutes();

    // Collect static diagnostics
    this.diagnosticCollector.setStaticDiagnostics(
      this.document.getDiagnostics(),
    );
  }

  /**
   * Pre-compile all routes for efficient matching
   */
  private compileRoutes(): void {
    for (const [pattern, pathItem] of Object.entries(this.spec.paths)) {
      // Parse query string from path if present (e.g., /files?beta=true)
      const queryIndex = pattern.indexOf("?");
      const basePath = queryIndex >= 0 ? pattern.slice(0, queryIndex) : pattern;
      const requiredQuery = queryIndex >= 0
        ? Object.fromEntries(new URLSearchParams(pattern.slice(queryIndex + 1)))
        : undefined;

      if (!basePath.includes("{")) {
        // Exact path - store in map by base path
        const entry: CompiledPath = {
          pattern,
          pathItem,
          segments: [],
          segmentCount: 0,
          requiredQuery,
        };
        const existing = this.exactRoutes.get(basePath) ?? [];
        existing.push(entry);
        this.exactRoutes.set(basePath, existing);
      } else {
        // Parameterized path
        const compiled = compilePathPattern(basePath);
        this.patternRoutes.push({
          ...compiled,
          pattern,
          pathItem,
          requiredQuery,
        });
      }
    }

    // Sort exact route entries: routes with requiredQuery first (more specific)
    for (const entries of this.exactRoutes.values()) {
      entries.sort((a, b) => {
        if (a.requiredQuery && !b.requiredQuery) return -1;
        if (!a.requiredQuery && b.requiredQuery) return 1;
        return 0;
      });
    }

    // Sort pattern routes by specificity (more literal segments first)
    // Then by requiredQuery presence (more specific first)
    this.patternRoutes.sort((a, b) => {
      const aLiterals = a.segments.filter((s) => s.type === "literal").length;
      const bLiterals = b.segments.filter((s) => s.type === "literal").length;
      if (bLiterals !== aLiterals) return bLiterals - aLiterals;
      if (a.requiredQuery && !b.requiredQuery) return -1;
      if (!a.requiredQuery && b.requiredQuery) return 1;
      return 0;
    });
  }

  start(): void {
    this.startTime = new Date();

    // Start interactive logger if enabled
    if (this.config.interactive && this.logger instanceof TuiLogger) {
      this.logger.start();
    }

    const server = Deno.serve({
      port: this.config.port,
      hostname: this.config.host,
      signal: this.abortController.signal,
      onListen: () => {
        this.logStartup();
      },
    }, (req) => this.handleRequest(req));

    // Store the finished promise for proper shutdown
    this.serverFinished = server.finished;

    // Handle graceful shutdown
    const handleShutdown = () => {
      // Stop TUI if running
      if (this.config.interactive && this.logger instanceof TuiLogger) {
        this.logger.stop();
      }
      this.logShutdown();
      this.stop();
      Deno.exit(0);
    };
    // Handle common shutdown signals
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const) {
      try {
        Deno.addSignalListener(signal, handleShutdown);
      } catch {
        // Signal not supported on this platform
      }
    }
  }

  /**
   * Stop the server and wait for it to fully shut down.
   * Returns a Promise that resolves when the server has stopped.
   */
  async stop(): Promise<void> {
    this.abortController.abort();
    // Wait for the server to fully stop
    if (this.serverFinished) {
      await this.serverFinished;
    }
  }

  /**
   * Log startup event
   */
  private logStartup(): void {
    const diagnostics = this.diagnosticCollector.getStaticDiagnostics();

    // Count endpoints
    let endpointCount = 0;
    for (const pathItem of Object.values(this.spec.paths)) {
      endpointCount += this.getMethodsForPath(pathItem).length;
    }

    const event: StartupEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: "startup",
      spec: {
        title: this.spec.info.title,
        version: this.spec.info.version,
        endpointCount,
      },
      server: {
        url: `http://${this.config.host}:${this.config.port}`,
        rejectOnSdkError: this.config.rejectOnSdkError ?? false,
      },
      diagnostics: diagnostics.map((d) => ({
        severity: d.severity,
        code: d.code,
        pointer: d.pointer,
        message: d.message,
        // Convert related diagnostics to chain format
        chain: d.related?.map((r) => `${r.pointer}: ${r.message}`),
        suggestion: d.suggestion,
      })),
    };

    this.logger.startup(event);
  }

  /**
   * Log shutdown event with session summary
   */
  private logShutdown(): void {
    const duration = Date.now() - this.startTime.getTime();

    // TODO: Build top issues from diagnostic collector
    const topIssues: ShutdownEvent["topIssues"] = [];

    const event: ShutdownEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: "shutdown",
      session: {
        duration,
        requestCount: this.requestCount,
        failedCount: this.failedCount,
      },
      topIssues,
    };

    this.logger.shutdown(event);
  }

  private getMethodsForPath(pathItem: PathItemObject): HttpMethod[] {
    return HTTP_METHODS.filter((method) => pathItem[method] !== undefined);
  }

  private async handleRequest(req: Request): Promise<Response> {
    const startTime = performance.now();
    const url = new URL(req.url);
    const method = req.method.toLowerCase() as HttpMethod;
    const path = url.pathname;

    // Handle special endpoints (no logging for these)
    if (path === "/_x-steady/health") {
      return this.handleHealth();
    }

    if (path === "/_x-steady/spec") {
      return this.handleSpec();
    }

    if (path.startsWith("/_x-steady/sessions/") && method === "get") {
      const sessionId = path.slice("/_x-steady/sessions/".length);
      return handleSessionRequest(sessionId, this.sessionStore);
    }

    // Check if request should reject on SDK errors
    const rejectOnSdkError = this.getRejectOnSdkError(req);

    try {
      const {
        operation,
        statusCode,
        pathPattern,
        pathParams,
        consumedQueryParams,
      } = this.findOperation(path, method, url.searchParams);

      // Validate request
      const validation = await this.validator.validateRequest(
        req,
        operation,
        pathParams,
        consumedQueryParams,
      );

      // Track request count
      this.requestCount++;

      // Run new diagnostics engine
      const engineDiagnostics = this.runDiagnosticEngine(
        path,
        method,
        url.searchParams,
        req.headers,
        validation.requestBody,
      );

      // Track session if X-Steady-Session header present
      const sessionId = req.headers.get("X-Steady-Session");
      if (sessionId) {
        this.sessionStore.addRequest(
          sessionId,
          method,
          path,
          engineDiagnostics,
        );
      }

      // If --reject-on-sdk-error is active and engine found SDK issues, return 400
      const hasSdkIssues = engineDiagnostics.some(
        (d) => d.category === "sdk-issue",
      );
      if (hasSdkIssues && rejectOnSdkError) {
        this.failedCount++;
        const timing = Math.round(performance.now() - startTime);

        // Log the request event
        this.logRequestEvent(
          req,
          path,
          pathPattern,
          method,
          400,
          "Bad Request",
          timing,
          validation,
        );

        const errorResponse = new Response(
          JSON.stringify({
            error: "Validation failed",
            errors: validation.errors,
            diagnostics: engineDiagnostics.map((d) => ({
              code: d.code,
              severity: d.severity,
              category: d.category,
              path: d.requestPath,
              message: d.message,
              expected: d.expected,
              actual: d.actual,
              attribution: d.attribution,
              suggestion: d.suggestion,
            })),
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
        return this.addDiagnosticHeaders(errorResponse, engineDiagnostics);
      }

      const generatorOptions = this.getEffectiveGeneratorOptions(req);
      const streamingOptions = this.getEffectiveStreamingOptions(req);
      streamingOptions.generatorOptions = generatorOptions;

      const { response, body: responseBody } = this.generateResponse(
        req.headers.get("Accept"),
        operation,
        statusCode,
        path,
        method,
        pathPattern,
        generatorOptions,
        streamingOptions,
      );

      const timing = Math.round(performance.now() - startTime);
      const status = parseInt(statusCode, 10);

      // Track failed responses
      if (status >= 400) {
        this.failedCount++;
      }

      // Log the request event
      this.logRequestEvent(
        req,
        path,
        pathPattern,
        method,
        status,
        response.statusText || this.getStatusText(status),
        timing,
        validation,
        response.headers,
        responseBody,
      );

      // Add diagnostic headers to response
      return this.addDiagnosticHeaders(response, engineDiagnostics);
    } catch (error) {
      const timing = Math.round(performance.now() - startTime);
      this.requestCount++;
      this.failedCount++;

      if (error instanceof MatchError) {
        // Log 404 error
        this.logRequestEvent(req, path, path, method, 404, "Not Found", timing);

        // Run the diagnostics engine — produces E2001/E2002 with enrichment
        const engineDiagnostics = this.runDiagnosticEngine(
          path,
          method,
          url.searchParams,
          req.headers,
          undefined,
        );

        // Track session if X-Steady-Session header present
        const sessionId = req.headers.get("X-Steady-Session");
        if (sessionId) {
          this.sessionStore.addRequest(
            sessionId,
            method,
            path,
            engineDiagnostics,
          );
        }

        // Check for double-? URL construction bug (old diagnostics for collector)
        const diagnostics = this.detectDoubleQuestionMark(url, path, method);
        if (diagnostics.length > 0) {
          this.diagnosticCollector.addRuntimeDiagnostics(diagnostics, false);
        }

        const responseBody: Record<string, unknown> = {
          error: error.message,
          suggestion: error.context.suggestion,
        };
        if (diagnostics.length > 0) {
          responseBody.diagnostics = diagnostics.map((d) => ({
            code: d.code,
            message: d.message,
            suggestion: d.suggestion,
            attribution: d.attribution,
          }));
        }

        const notFoundResponse = new Response(
          JSON.stringify(responseBody),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
        return this.addDiagnosticHeaders(notFoundResponse, engineDiagnostics);
      }

      // Log 500 error
      this.logRequestEvent(
        req,
        path,
        path,
        method,
        500,
        "Internal Server Error",
        timing,
      );
      console.error(error);

      const serverError = new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
      return this.addDiagnosticHeaders(serverError, []);
    }
  }

  /**
   * Convert ValidationIssue to ValidationError with defaults for missing fields
   */
  private toValidationError(
    issue: import("./types.ts").ValidationIssue,
  ): ValidationError {
    return {
      path: issue.path,
      specPointer: issue.specPointer || "",
      keyword: issue.keyword || "unknown",
      message: issue.message,
      expected: issue.expected || "",
      actual: issue.actual,
      attribution: issue.attribution || {
        type: "ambiguous",
        confidence: 0.5,
        reasoning: "Attribution not determined",
      },
      suggestion: issue.suggestion,
    };
  }

  /**
   * Build and log a RequestEvent
   */
  private logRequestEvent(
    req: Request,
    path: string,
    pathPattern: string,
    method: string,
    status: number,
    statusText: string,
    timing: number,
    validation?: {
      valid: boolean;
      errors: import("./types.ts").ValidationIssue[];
      warnings: import("./types.ts").ValidationIssue[];
      requestBody?: unknown;
    },
    responseHeaders?: Headers,
    responseBody?: unknown,
  ): void {
    const url = new URL(req.url);

    const event: RequestEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: "request",
      request: {
        method: method.toUpperCase(),
        path,
        pathPattern,
        query: url.search,
        headers: req.headers,
        body: validation?.requestBody,
      },
      response: {
        status,
        statusText,
        timing,
        headers: responseHeaders || new Headers(),
        body: responseBody,
      },
      validation: validation
        ? {
          valid: validation.valid,
          errors: validation.errors.map((e) => this.toValidationError(e)),
          warnings: validation.warnings.map((w) => this.toValidationError(w)),
        }
        : { valid: true, errors: [], warnings: [] },
    };

    this.logger.request(event);
  }

  /**
   * Get HTTP status text for a status code
   */
  private getStatusText(status: number): string {
    const statusTexts: Record<number, string> = {
      200: "OK",
      201: "Created",
      204: "No Content",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      500: "Internal Server Error",
    };
    return statusTexts[status] || "Unknown";
  }

  private handleHealth(): Response {
    const stats = this.document.getStats();
    return new Response(
      JSON.stringify({
        status: "healthy",
        version: VERSION,
        spec: {
          title: this.spec.info.title,
          version: this.spec.info.version,
        },
        schemas: {
          totalRefs: stats.totalRefs,
          cached: stats.cachedSchemas,
          cyclicRefs: stats.cyclicRefs,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  private handleSpec(): Response {
    return new Response(
      JSON.stringify(this.spec, null, 2),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Check if request query params satisfy route's required query params
   */
  private matchesQueryRequirements(
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
   * Find matching operation using pre-compiled routes
   */
  private findOperation(
    path: string,
    method: string,
    query: URLSearchParams,
  ): {
    operation: OperationObject;
    statusCode: string;
    pathPattern: string;
    pathParams: Record<string, string>;
    consumedQueryParams?: string[];
  } {
    // Try exact match first (O(1) lookup)
    const exactMatches = this.exactRoutes.get(path);
    if (exactMatches) {
      // Routes are sorted: requiredQuery first, then no requiredQuery
      for (const entry of exactMatches) {
        if (this.matchesQueryRequirements(query, entry.requiredQuery)) {
          const operation = this.getOperationForMethod(
            entry.pathItem,
            method,
            entry.pattern,
          );
          const statusCode = this.selectStatusCode(operation);
          return {
            operation,
            statusCode,
            pathPattern: entry.pattern,
            pathParams: {},
            consumedQueryParams: entry.requiredQuery
              ? Object.keys(entry.requiredQuery)
              : undefined,
          };
        }
      }
    }

    // Try pattern matching with pre-compiled routes using shared utility
    // Track first path match for better error reporting when method not found
    let firstPathMatch: {
      pathItem: PathItemObject;
      pattern: string;
    } | null = null;

    for (const compiled of this.patternRoutes) {
      const params = matchCompiledPath(path, compiled);
      if (
        params && this.matchesQueryRequirements(query, compiled.requiredQuery)
      ) {
        // Path matches - check if method exists
        const operation = compiled.pathItem[method as keyof PathItemObject] as
          | OperationObject
          | undefined;

        if (operation) {
          // Found a matching path AND method
          const statusCode = this.selectStatusCode(operation);
          return {
            operation,
            statusCode,
            pathPattern: compiled.pattern,
            pathParams: params,
            consumedQueryParams: compiled.requiredQuery
              ? Object.keys(compiled.requiredQuery)
              : undefined,
          };
        }

        // Path matches but method doesn't exist on this path item
        // Keep searching - another path with the same pattern might have the method
        // (e.g., /secrets/{secret_id} DELETE vs /secrets/{secret_key} POST)
        if (!firstPathMatch) {
          firstPathMatch = {
            pathItem: compiled.pathItem,
            pattern: compiled.pattern,
          };
        }
      }
    }

    // If we found at least one path match but no method match, report "method not allowed"
    if (firstPathMatch) {
      const availableMethods = this.getMethodsForPath(firstPathMatch.pathItem);
      throw new MatchError("Method not allowed", {
        httpPath: firstPathMatch.pattern,
        httpMethod: method.toUpperCase(),
        errorType: "match",
        reason:
          `Method ${method.toUpperCase()} not defined for path "${firstPathMatch.pattern}"`,
        suggestion: `Available methods: ${
          availableMethods.map((m) => m.toUpperCase()).join(", ")
        }`,
      });
    }

    // No match found
    const availablePaths = Object.keys(this.spec.paths);
    throw new MatchError("Path not found", {
      httpPath: path,
      httpMethod: method.toUpperCase(),
      errorType: "match",
      reason: `No path definition found for "${path}"`,
      suggestion: availablePaths.length > 0
        ? `Available paths: ${availablePaths.slice(0, 5).join(", ")}${
          availablePaths.length > 5 ? "..." : ""
        }`
        : "No paths defined in the OpenAPI spec",
    });
  }

  /**
   * Get operation for HTTP method with helpful error if not found
   */
  private getOperationForMethod(
    pathItem: PathItemObject,
    method: string,
    pathPattern: string,
  ): OperationObject {
    const operation = pathItem[method as keyof PathItemObject] as
      | OperationObject
      | undefined;

    if (!operation) {
      const availableMethods = this.getMethodsForPath(pathItem);
      throw new MatchError("Method not allowed", {
        httpPath: pathPattern,
        httpMethod: method.toUpperCase(),
        errorType: "match",
        reason:
          `Method ${method.toUpperCase()} not defined for path "${pathPattern}"`,
        suggestion: `Available methods: ${
          availableMethods.map((m) => m.toUpperCase()).join(", ")
        }`,
      });
    }

    return operation;
  }

  /**
   * Select the best status code to return (prefer 200, then first available)
   *
   * OpenAPI allows "default" and "1XX", "2XX", etc. as response keys.
   * We only select numeric status codes; fallback to 200 if none found.
   */
  private selectStatusCode(operation: OperationObject): string {
    if (operation.responses["200"]) return "200";
    if (operation.responses["201"]) return "201";
    if (operation.responses["204"]) return "204";

    // Find first numeric status code, skip "default", "1XX", etc.
    const numericCode = Object.keys(operation.responses).find(
      (code) => /^\d{3}$/.test(code),
    );
    return numericCode || "200";
  }

  /**
   * Generate response using the document-centric architecture
   */
  private generateResponse(
    requestAcceptHeader: string | null,
    operation: OperationObject,
    statusCode: string,
    path: string,
    method: string,
    pathPattern: string,
    generatorOptions: GenerateOptions,
    streamingOptions: StreamingOptions,
  ): { response: Response; body?: unknown } {
    const responseObjOrRef = operation.responses[statusCode];
    if (!responseObjOrRef) {
      throw new MatchError("Response not defined", {
        httpPath: path,
        httpMethod: method.toUpperCase(),
        errorType: "match",
        reason: `No response defined for status code ${statusCode}`,
        suggestion: `Available response codes: ${
          Object.keys(operation.responses).join(", ")
        }`,
      });
    }

    // Handle $ref in response - resolve via document
    if (isReference(responseObjOrRef)) {
      const resolved = this.document.resolveRef(responseObjOrRef.$ref);
      if (!resolved) {
        throw new MatchError("Unresolved response reference", {
          httpPath: path,
          httpMethod: method.toUpperCase(),
          errorType: "match",
          reason: `Response reference not found: ${responseObjOrRef.$ref}`,
          suggestion:
            "Check that the referenced response exists in components/responses",
        });
      }
      // Use resolved response
      return this.generateResponseFromObject(
        requestAcceptHeader,
        resolved.raw as ResponseObject,
        statusCode,
        path,
        method,
        pathPattern,
        generatorOptions,
        streamingOptions,
      );
    }

    return this.generateResponseFromObject(
      requestAcceptHeader,
      responseObjOrRef as ResponseObject,
      statusCode,
      path,
      method,
      pathPattern,
      generatorOptions,
      streamingOptions,
    );
  }

  /**
   * Generate response from a resolved ResponseObject
   */
  private generateResponseFromObject(
    requestAcceptHeader: string | null,
    responseObj: ResponseObject,
    statusCode: string,
    path: string,
    method: string,
    pathPattern: string,
    generatorOptions: GenerateOptions,
    streamingOptions: StreamingOptions,
  ): { response: Response; body?: unknown } {
    let body: unknown = null;
    let contentType: string | null = null;

    const acceptTypes = parseAcceptHeader(requestAcceptHeader);

    if (responseObj.content) {
      const contentKeys = Object.keys(responseObj.content);
      if (contentKeys.length === 0) {
        // Content object exists but is empty - this is unusual and likely a spec issue
        console.warn(
          `[Steady] Warning: Response for ${method.toUpperCase()} ${path} has empty content object. ` +
            `Using default application/json with no body.`,
        );
      }

      // Select content type based on Accept header
      // Priority: Accept header match > first content type in spec
      let selectedContentType: string | undefined;
      for (const acceptType of acceptTypes) {
        if (contentKeys.includes(acceptType)) {
          selectedContentType = acceptType;
          break;
        }
        // Handle wildcards like "*/*"
        if (acceptType === "*/*") {
          selectedContentType = contentKeys[0];
          break;
        }
      }
      // Default to first content type in spec
      if (!selectedContentType) {
        selectedContentType = contentKeys[0];
      }

      // Check if selected content type is streaming
      if (selectedContentType && isStreamingContentType(selectedContentType)) {
        const mediaType = responseObj.content[selectedContentType];
        if (mediaType?.schema || mediaType?.example) {
          // Pass example to streaming options for SSE event sequences
          if (mediaType.example !== undefined) {
            streamingOptions.example = mediaType.example;
          }
          // Streaming responses don't capture body for logging
          return {
            response: this.generateStreamingResponse(
              mediaType.schema,
              pathPattern,
              method,
              statusCode,
              selectedContentType,
              streamingOptions,
            ),
            body: "[streaming]",
          };
        }
      }

      // Use selected content type or fall back to JSON
      const mediaType = selectedContentType
        ? responseObj.content[selectedContentType]
        : responseObj.content["application/json"] ||
          Object.values(responseObj.content)[0];

      if (mediaType) {
        contentType = selectedContentType ?? "application/json";

        // Priority 1: Explicit example
        if (mediaType.example !== undefined) {
          body = mediaType.example;
        } // Priority 2: First example from examples map
        else if (
          mediaType.examples && Object.keys(mediaType.examples).length > 0
        ) {
          const firstExampleOrRef = Object.values(mediaType.examples)[0];
          if (firstExampleOrRef && !isReference(firstExampleOrRef)) {
            const example = firstExampleOrRef as { value?: unknown };
            if (example.value !== undefined) {
              body = example.value;
            }
          }
        } // Priority 3: Generate from schema using document-centric approach
        else if (mediaType.schema) {
          body = this.generateFromSchemaObject(
            mediaType.schema,
            pathPattern,
            method,
            statusCode,
            generatorOptions,
          );
        }

        if (body === null && mediaType.schema) {
          throw missingExampleError(path, method, statusCode);
        }
      }
    } else if (
      acceptsJson(acceptTypes) && statusCode !== "204" && statusCode !== "304"
    ) {
      // No content defined in spec, but client accepts JSON - return empty object
      // (except for 204/304 which must not have a body)
      contentType = "application/json";
      body = {};
    }

    const headers = new Headers({
      [HEADERS.MATCHED_PATH]: pathPattern,
      [HEADERS.EXAMPLE_SOURCE]: body !== null ? "generated" : "none",
    });
    if (contentType) {
      headers.set("Content-Type", contentType);
    }

    // Safely stringify body - handle circular references and non-serializable values
    let bodyString: string | null = null;
    if (body !== null) {
      try {
        bodyString = JSON.stringify(body, null, 2);
      } catch (error) {
        // Handle non-serializable values (circular refs, BigInt, etc.)
        const errorMessage = error instanceof Error
          ? error.message
          : "Unknown serialization error";
        console.error(
          `[Steady] Failed to serialize response body: ${errorMessage}`,
        );
        bodyString = JSON.stringify(
          {
            error: "Response serialization failed",
            reason: errorMessage,
            hint:
              "The generated response contains non-serializable values (circular references, BigInt, etc.)",
          },
          null,
          2,
        );
        headers.set(HEADERS.SERIALIZATION_ERROR, "true");
      }
    }

    return {
      response: new Response(
        bodyString,
        {
          status: parseInt(statusCode, 10),
          headers,
        },
      ),
      body,
    };
  }

  /**
   * Generate a streaming response (NDJSON or SSE)
   */
  private generateStreamingResponse(
    schema: unknown,
    pathPattern: string,
    method: string,
    statusCode: string,
    contentType: string,
    streamingOptions: StreamingOptions,
  ): Response {
    const format = getStreamFormat(contentType);
    if (!format) {
      // Fallback to JSON if format detection fails
      throw new Error(`Unknown streaming format: ${contentType}`);
    }

    const schemaPointer = `#/paths/${
      this.escapePointer(pathPattern)
    }/${method}/responses/${statusCode}/content/${
      this.escapePointer(contentType)
    }/schema`;

    const stream = createStreamingResponse(
      this.document.schemas,
      schema,
      schemaPointer,
      format,
      streamingOptions,
    );

    const headers = new Headers({
      "Content-Type": contentType,
      [HEADERS.MATCHED_PATH]: pathPattern,
      [HEADERS.EXAMPLE_SOURCE]: "generated",
      [HEADERS.STREAMING]: "true",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // For SSE, add specific headers
    if (format === "sse") {
      headers.set("X-Accel-Buffering", "no"); // Disable nginx buffering
    }

    return new Response(stream, {
      status: parseInt(statusCode, 10),
      headers,
    });
  }

  /**
   * Generate data from a schema object using the document-centric approach
   */
  private generateFromSchemaObject(
    schema: unknown,
    pathPattern: string,
    method: string,
    statusCode: string,
    generatorOptions: GenerateOptions,
  ): unknown {
    // If schema is a reference, use the document to resolve and generate
    if (typeof schema === "object" && schema !== null && "$ref" in schema) {
      const ref = (schema as { $ref: string }).$ref;
      return this.document.generateResponse(ref, generatorOptions);
    }

    // For inline schemas, create a generator with document access
    const generator = new RegistryResponseGenerator(
      this.document.schemas,
      generatorOptions,
    );
    return generator.generateFromSchema(
      schema as Parameters<RegistryResponseGenerator["generateFromSchema"]>[0],
      `#/paths/${
        this.escapePointer(pathPattern)
      }/${method}/responses/${statusCode}/content/application~1json/schema`,
    );
  }

  /**
   * Detect double-? URL construction bug in query parameters.
   * When a request gets a 404 and any query param value contains '?',
   * it likely means the SDK appended '?params' to a URL that already had '?'.
   */
  private detectDoubleQuestionMark(
    url: URL,
    path: string,
    method: string,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const [key, value] of url.searchParams) {
      if (value.includes("?")) {
        diagnostics.push({
          code: "request-double-question-mark",
          severity: "warning",
          pointer: path,
          message:
            `Query parameter "${key}" has value "${value}" which contains '?' — this looks like a double-? URL construction bug`,
          context: {
            phase: "request",
            request: { method: method.toUpperCase(), path },
            actualValue: `${key}=${value}`,
          },
          attribution: getAttribution("request-double-question-mark"),
          suggestion:
            `The SDK may be appending '?${
              value.split("?")[1]
            }' to a URL that already contains '?'. ` +
            `Use '&' instead of '?' to separate additional query parameters.`,
        });
        break; // One diagnostic is enough — the root cause is the same
      }
    }
    return diagnostics;
  }

  /**
   * Escape a path segment for JSON Pointer
   */
  private escapePointer(path: string): string {
    return path.replace(/~/g, "~0").replace(/\//g, "~1");
  }

  /**
   * Whether to reject requests that have SDK issues (E3xxx diagnostics).
   * X-Steady-Reject-On-Error header overrides the server default.
   */
  private getRejectOnSdkError(req: Request): boolean {
    const headerValue = req.headers.get(HEADERS.REJECT_ON_ERROR);
    if (headerValue === "true") return true;
    if (headerValue === "false") return false;
    return this.config.rejectOnSdkError ?? false;
  }

  /**
   * Default seed for deterministic generation.
   * Uses a simple hash of "steady" to get a stable number.
   */
  private static readonly DEFAULT_SEED = 123456789;

  /**
   * Get effective generator options for a request.
   * Headers override config defaults.
   */
  private getEffectiveGeneratorOptions(req: Request): GenerateOptions {
    const config = this.config.generator ?? {};

    // Parse headers (headers override config)
    const headerArraySize = req.headers.get(HEADERS.ARRAY_SIZE);
    const headerArrayMin = req.headers.get(HEADERS.ARRAY_MIN);
    const headerArrayMax = req.headers.get(HEADERS.ARRAY_MAX);
    const headerSeed = req.headers.get(HEADERS.SEED);

    // If array-size header is set, it overrides both min and max
    let arrayMin: number | undefined;
    let arrayMax: number | undefined;

    if (headerArraySize) {
      const size = parseInt(headerArraySize, 10);
      if (!isNaN(size)) {
        arrayMin = size;
        arrayMax = size;
      }
    } else {
      if (headerArrayMin) {
        const min = parseInt(headerArrayMin, 10);
        if (!isNaN(min)) arrayMin = min;
      }
      if (headerArrayMax) {
        const max = parseInt(headerArrayMax, 10);
        if (!isNaN(max)) arrayMax = max;
      }
    }

    // Merge: header > config > default
    const finalArrayMin = arrayMin ?? config.arrayMin;
    const finalArrayMax = arrayMax ?? config.arrayMax;

    // Seed: header > config > default (deterministic)
    // Special value -1 means "use random seed"
    let seed: number;
    if (headerSeed) {
      const parsedSeed = parseInt(headerSeed, 10);
      if (isNaN(parsedSeed)) {
        seed = MockServer.DEFAULT_SEED;
      } else if (parsedSeed === -1) {
        seed = Math.random() * 1000000;
      } else {
        seed = parsedSeed;
      }
    } else {
      const configSeed = config.seed ?? MockServer.DEFAULT_SEED;
      seed = configSeed === -1 ? Math.random() * 1000000 : configSeed;
    }

    return {
      arrayMin: finalArrayMin,
      arrayMax: finalArrayMax,
      seed,
    };
  }

  /**
   * Get effective streaming options by merging header overrides with config defaults.
   * Priority: header > config > default
   */
  private getEffectiveStreamingOptions(req: Request): StreamingOptions {
    const config = this.config.streaming ?? {};

    // Parse headers (headers override config)
    const headerOptions = parseStreamingOptions(req);

    // Merge: header > config > default
    return {
      count: headerOptions.count ?? config.count,
      interval: headerOptions.interval ?? config.interval,
    };
  }

  /**
   * Add X-Steady-* diagnostic headers to a response.
   * X-Steady-Valid is false when any sdk-issue diagnostic is present.
   */
  private addDiagnosticHeaders(
    response: Response,
    diagnostics: EngineDiagnostic[],
  ): Response {
    const newHeaders = new Headers(response.headers);
    const hasSdkIssues = diagnostics.some((d) => d.category === "sdk-issue");

    newHeaders.set("X-Steady-Valid", hasSdkIssues ? "false" : "true");
    newHeaders.set("X-Steady-Error-Count", String(diagnostics.length));

    diagnostics.forEach((d, i) => {
      const n = i + 1;
      newHeaders.set(`X-Steady-Error-${n}-Code`, d.code);
      newHeaders.set(`X-Steady-Error-${n}-Path`, d.requestPath);
      newHeaders.set(`X-Steady-Error-${n}-Message`, d.message);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  /**
   * Run the new diagnostics engine on a request.
   * Returns engine diagnostics without affecting the existing validation flow.
   */
  private runDiagnosticEngine(
    path: string,
    method: string,
    queryParams: URLSearchParams,
    reqHeaders: Headers,
    body: unknown,
  ): EngineDiagnostic[] {
    const headers: Record<string, string> = {};
    reqHeaders.forEach((value, key) => {
      headers[key] = value;
    });

    const request: AnalyzeRequest = {
      path,
      method,
      queryParams,
      headers,
      body,
    };

    return this.diagnosticEngine.analyze(request);
  }
}
