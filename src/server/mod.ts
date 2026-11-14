/**
 * Steady Mock Server
 *
 * Features:
 * - Document-centric architecture for proper $ref resolution
 * - Pre-compiled path patterns for O(1) route matching
 * - Lazy schema processing with caching
 * - Graceful shutdown handling
 * - Text and JSON logging modes
 */

import type { ServerConfig } from "../types.ts";
import type { PipelineTimer } from "../timing.ts";
import {
  HEADERS,
  isHttpMethod,
  isValidArrayFormat,
  isValidFormArrayFormat,
  isValidFormObjectFormat,
  isValidObjectFormat,
  VERSION,
} from "../types.ts";
import { isReference } from "@steady/openapi";
import type { OpenAPIRaw } from "@steady/openapi";
import { GenerationError } from "../errors.ts";
import { SchemaRegistry } from "@steady/json-schema";
import type { DocIndex } from "@steady/json-schema";
import type { Logger } from "../logging/logger.ts";
import { TextLogger } from "../logging/text-logger.ts";
import { JsonLogger } from "../logging/json-logger.ts";
import { CILogger } from "../logging/ci-logger.ts";
import { getStatusText } from "../logging/colors.ts";
import { isParseError, parseRequestBody } from "../body-parser.ts";
import type { FormParserOptions } from "../form-parser.ts";
import { OpenAPISpec } from "@steady/openapi";
import { isSchema, TreeValidator } from "@steady/json-schema";
import { getMediaType, isFormMediaType } from "../media-type.ts";
import {
  type AnalyzeRequest,
  DiagnosticEngine,
} from "../engine/diagnostic-engine.ts";
import type { Diagnostic } from "../diagnostic.ts";
import { SessionStore } from "../session/store.ts";
import { handleSessionRequest } from "../session/endpoints.ts";
import { DiagnosticCollector } from "../diagnostics/collector.ts";

import { getMethodsForPath, Router } from "../router.ts";
import {
  addDiagnosticHeaders,
  generateResponseFromObject,
} from "./response-generator.ts";
import {
  getEffectiveGeneratorOptions,
  getEffectiveStreamingOptions,
  getRejectOnSdkError,
} from "./options.ts";
import {
  computeExitCode,
  logRequestEvent,
  logShutdown,
  logStartup,
} from "./lifecycle.ts";

export class MockServer {
  /** Structured spec access with universal $ref resolution */
  private specDoc: OpenAPISpec;
  private abortController: AbortController;
  private logger: Logger;
  private diagnosticEngine: DiagnosticEngine;
  private collector: DiagnosticCollector;
  private sessionStore: SessionStore;
  private serverFinished: Promise<void> | null = null;
  private startTime: Date = new Date();
  private requestCount = 0;
  private failedCount = 0;

  // Unified router: pre-compiled routes with query disambiguation
  private router: Router;

  constructor(
    spec: OpenAPIRaw,
    private config: ServerConfig,
    docIndex?: DocIndex,
    private timer?: PipelineTimer,
  ) {
    // Build schema registry (indexes all schemas for O(1) $ref resolution)
    timer?.start("document");
    const registry = docIndex
      ? new SchemaRegistry(spec, docIndex)
      : SchemaRegistry.fromSpec(spec);
    timer?.stop("document");

    // Single document facade: all $ref resolution flows through here
    timer?.start("diagnostics-engine");
    this.specDoc = new OpenAPISpec(registry);
    this.router = new Router(spec.paths);
    const treeValidator = new TreeValidator({ registry, direction: "request" });
    this.diagnosticEngine = new DiagnosticEngine(
      this.specDoc,
      treeValidator,
      this.router,
    );
    timer?.stop("diagnostics-engine");

    this.abortController = new AbortController();
    this.sessionStore = new SessionStore();

    // Create logger based on format
    if (config.logFormat === "ci") {
      this.logger = new CILogger({
        level: config.logLevel,
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
        color: config.color ?? true,
        logBodies: config.logBodies,
      });
    }

    // Diagnostic collector for session-level aggregation
    this.collector = new DiagnosticCollector();
    this.collector.setStaticDiagnostics(config.startupDiagnostics ?? []);

    // Note: route compilation happens in Router constructor above
  }

  /** The port the server is actually listening on (set after start()). */
  get port(): number {
    return this._port;
  }
  private _port = 0;

  start(): Promise<number> {
    this.startTime = new Date();

    const { promise: listening, resolve: onReady } = Promise.withResolvers<
      number
    >();

    const handler = (req: Request) => this.handleRequest(req);

    const onListen = (port: number) => {
      this._port = port;
      logStartup(
        this.specDoc.rawSpec,
        this.config,
        this.logger,
        this.collector,
        this.sessionStore,
        getMethodsForPath,
        this.timer,
      );
      onReady(port);
    };

    const serveOptions = this.config.socketPath
      ? {
        path: this.config.socketPath,
        signal: this.abortController.signal,
        onListen: () => onListen(0),
      }
      : {
        port: this.config.port,
        hostname: this.config.host,
        signal: this.abortController.signal,
        onListen: ({ port }: { port: number }) => onListen(port),
      };

    const server = Deno.serve(serveOptions, handler);

    // Store the finished promise for proper shutdown
    this.serverFinished = server.finished;

    // Handle graceful shutdown
    const handleShutdownSignal = () => {
      logShutdown(
        this.logger,
        this.collector,
        this.startTime,
        this.requestCount,
        this.failedCount,
      );
      this.stop();
      Deno.exit(computeExitCode(this.failedCount, this.config, this.collector));
    };
    // Handle common shutdown signals
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const) {
      try {
        Deno.addSignalListener(signal, handleShutdownSignal);
      } catch {
        // Signal not supported on this platform
      }
    }

    return listening;
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

  private async handleRequest(req: Request): Promise<Response> {
    const startTime = performance.now();
    const url = new URL(req.url);
    const rawMethod = req.method.toLowerCase();
    const path = url.pathname;

    // Handle special endpoints (no logging for these)
    if (path === "/_x-steady/health") {
      return this.handleHealth();
    }

    if (path === "/_x-steady/spec") {
      return this.handleSpec();
    }

    if (path === "/_x-steady/redirected") {
      return new Response(
        JSON.stringify({ status: "redirected" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (path.startsWith("/_x-steady/sessions/") && rawMethod === "get") {
      const sessionId = path.slice("/_x-steady/sessions/".length);
      return handleSessionRequest(sessionId, this.sessionStore);
    }

    // Validate HTTP method before any processing. A method OpenAPI cannot
    // describe is "not recognized" (501, RFC 9110 section 9.1), not "known
    // but not allowed for this path" (405, which needs an Allow header).
    if (!isHttpMethod(rawMethod)) {
      return new Response(`Method ${req.method} is not supported`, {
        status: 501,
        headers: { "Content-Type": "text/plain" },
      });
    }
    const method = rawMethod;

    // Check if request should reject on SDK errors
    const rejectOnSdkError = getRejectOnSdkError(req, this.config);

    // Route matching (unified router handles query disambiguation + diagnostics)
    const routeResult = this.router.match({
      path,
      method,
      queryParams: url.searchParams,
    });

    if (!routeResult.matched) {
      // Route not found or method not allowed
      const timing = Math.round(performance.now() - startTime);
      this.requestCount++;
      this.failedCount++;

      const routeDiags = routeResult.diagnostics;

      // Collect runtime diagnostics
      this.collector.addRuntimeDiagnostics(routeDiags, method, path, false);

      // Track session if X-Steady-Session header present
      const sessionId = req.headers.get("X-Steady-Session");
      if (sessionId) {
        this.sessionStore.addRequest(sessionId, method, path, routeDiags);
      }

      // Method not allowed (E2002) -> 405, path not found (E2001) -> 404
      const isMethodNotAllowed = routeResult.reason === "method-not-allowed";
      const status = isMethodNotAllowed ? 405 : 404;
      const statusText = isMethodNotAllowed
        ? "Method Not Allowed"
        : "Not Found";

      const errorHeaders = new Headers({ "Content-Type": "application/json" });
      if (routeResult.reason === "method-not-allowed") {
        // RFC 9110 section 15.5.6: a 405 response MUST carry Allow.
        errorHeaders.set(
          "Allow",
          routeResult.allowedMethods.map((m) => m.toUpperCase()).join(", "),
        );
      }

      logRequestEvent(this.config, this.logger, {
        req,
        path,
        pathPattern: path,
        method,
        status,
        statusText,
        timing,
        diagnostics: routeDiags,
      });

      const firstDiag = routeDiags[0];
      const errorResponse = new Response(
        JSON.stringify({
          error: firstDiag?.message ?? "Route not found",
          suggestion: firstDiag?.suggestion,
        }),
        { status, headers: errorHeaders },
      );
      return addDiagnosticHeaders(errorResponse, routeDiags);
    }

    const {
      operation,
      statusCode,
      pathPattern,
      pathParams,
      consumedQueryParams,
    } = routeResult;

    try {
      // Build form parsing options only for form content types
      const rawContentType = req.headers.get("content-type");
      const essence = rawContentType ? getMediaType(rawContentType) : null;
      let formOptions: FormParserOptions | undefined;

      if (essence && isFormMediaType(essence)) {
        // Merge form format: per-request header > config
        const headerFormArrayFmt = req.headers.get(HEADERS.FORM_ARRAY_FORMAT);
        const headerFormObjectFmt = req.headers.get(HEADERS.FORM_OBJECT_FORMAT);

        const configFormArrayFmt = this.config.validator?.formArrayFormat ??
          null;
        const configFormObjectFmt = this.config.validator?.formObjectFormat ??
          null;
        const formArrayFormat = isValidFormArrayFormat(headerFormArrayFmt)
          ? headerFormArrayFmt
          : isValidFormArrayFormat(configFormArrayFmt)
          ? configFormArrayFmt
          : undefined;
        const formObjectFormat = isValidFormObjectFormat(headerFormObjectFmt)
          ? headerFormObjectFmt
          : isValidFormObjectFormat(configFormObjectFmt)
          ? configFormObjectFmt
          : undefined;

        // Resolve body schema for type coercion
        const bodyInfo = this.specDoc.getBodySchema(
          pathPattern,
          method,
          essence,
        );

        formOptions = {
          formArrayFormat,
          formObjectFormat,
          schema: bodyInfo?.schema,
          partContentTypes: bodyInfo?.partContentTypes,
          resolveSchema: (schema) => {
            if (isReference(schema)) {
              const resolved = this.specDoc.resolveRef(schema.$ref);
              if (isSchema(resolved)) return resolved;
              return undefined;
            }
            return schema;
          },
        };
      }

      // Parse request body
      const parseResult = await parseRequestBody(req, null, formOptions);
      let parseDiags: Diagnostic[] = [];
      let body: unknown;
      let rawFormKeys: string[] | undefined;
      if (isParseError(parseResult)) {
        parseDiags = parseResult.diagnostics;
        body = undefined;
      } else {
        body = parseResult.body;
        rawFormKeys = parseResult.rawFormKeys;
      }

      // Track request count and endpoint coverage
      this.requestCount++;
      this.collector.trackEndpoint(method, pathPattern);

      // Run diagnostics engine
      const engineDiags = this.runDiagnosticEngine(
        path,
        method,
        url.searchParams,
        req.headers,
        body,
        pathParams,
        consumedQueryParams,
        rawFormKeys,
        formOptions,
      );

      const allDiagnostics = [...parseDiags, ...engineDiags];

      // Track session if X-Steady-Session header present
      const sessionId = req.headers.get("X-Steady-Session");
      if (sessionId) {
        this.sessionStore.addRequest(
          sessionId,
          method,
          path,
          allDiagnostics,
          pathPattern,
        );
      }

      // Collect runtime diagnostics
      const hasSdkIssues = allDiagnostics.some(
        (d) => d.category === "sdk-issue",
      );
      this.collector.addRuntimeDiagnostics(
        allDiagnostics,
        method,
        path,
        !hasSdkIssues,
      );

      // If --reject-on-sdk-error is active and diagnostics found SDK issues, return 400
      if (hasSdkIssues && rejectOnSdkError) {
        this.failedCount++;
        const timing = Math.round(performance.now() - startTime);

        logRequestEvent(this.config, this.logger, {
          req,
          path,
          pathPattern,
          method,
          status: 400,
          statusText: "Bad Request",
          timing,
          diagnostics: allDiagnostics,
          requestBody: body,
        });

        const errorResponse = new Response(
          JSON.stringify({
            error: "Validation failed",
            steady: {
              valid: false,
              errors: allDiagnostics.map((d) => ({
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
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
        return addDiagnosticHeaders(errorResponse, allDiagnostics);
      }

      const generatorOptions = getEffectiveGeneratorOptions(req, this.config);
      const streamingOptions = getEffectiveStreamingOptions(req, this.config);
      streamingOptions.generatorOptions = generatorOptions;

      const responseObj = this.specDoc.getResponseObject(
        pathPattern,
        method,
        statusCode,
      );
      if (!responseObj) {
        throw new GenerationError("Response not defined", {
          httpPath: path,
          httpMethod: method.toUpperCase(),
          errorType: "generate",
          reason: `No response defined for status code ${statusCode}`,
          suggestion: `Available response codes: ${
            Object.keys(operation.responses).join(", ")
          }`,
        });
      }

      const { response, body: responseBody, minimal, nullBodyStripped } =
        generateResponseFromObject(
          this.specDoc,
          this.logger,
          this.collector,
          req.headers.get("Accept"),
          responseObj,
          statusCode,
          path,
          method,
          pathPattern,
          generatorOptions,
          streamingOptions,
        );

      // Add response warning header for minimal responses
      if (minimal) {
        response.headers.set("X-Steady-Response-Warning", "minimal");
      }

      const timing = Math.round(performance.now() - startTime);
      const status = parseInt(statusCode, 10);

      // Track failed responses
      if (status >= 400) {
        this.failedCount++;
      }

      const responseWarning = nullBodyStripped
        ? "null-body-stripped"
        : minimal
        ? "minimal"
        : undefined;

      logRequestEvent(this.config, this.logger, {
        req,
        path,
        pathPattern,
        method,
        status,
        statusText: response.statusText || getStatusText(status),
        timing,
        diagnostics: allDiagnostics,
        requestBody: body,
        responseHeaders: response.headers,
        responseBody,
        responseWarning,
      });

      return addDiagnosticHeaders(response, allDiagnostics);
    } catch (error) {
      const timing = Math.round(performance.now() - startTime);
      this.requestCount++;
      this.failedCount++;

      // 500 - internal error
      logRequestEvent(this.config, this.logger, {
        req,
        path,
        pathPattern: path,
        method,
        status: 500,
        statusText: "Internal Server Error",
        timing,
        diagnostics: [],
      });
      this.logger.error(
        `Internal server error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error && error.stack
          ? { stack: error.stack }
          : undefined,
      );

      const serverError = new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
      return addDiagnosticHeaders(serverError, []);
    }
  }

  private handleHealth(): Response {
    const stats = this.specDoc.registry.getStats();
    return new Response(
      JSON.stringify({
        status: "healthy",
        version: VERSION,
        spec: {
          title: this.specDoc.rawSpec.info.title,
          version: this.specDoc.rawSpec.info.version,
        },
        schemas: {
          totalRefs: stats.totalRefs,
          cached: stats.cachedSchemas,
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
      JSON.stringify(this.specDoc.rawSpec, null, 2),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Run the diagnostics engine on a request.
   * Returns engine diagnostics without affecting the existing validation flow.
   */
  private runDiagnosticEngine(
    path: string,
    method: string,
    queryParams: URLSearchParams,
    reqHeaders: Headers,
    body: unknown,
    pathParams?: Record<string, string>,
    consumedQueryParams?: string[],
    rawFormKeys?: string[],
    formOptions?: FormParserOptions,
  ): Diagnostic[] {
    const headers: Record<string, string> = {};
    reqHeaders.forEach((value, key) => {
      headers[key] = value;
    });

    // Merge query format: per-request header > config > "auto"
    const headerArrayFmt = reqHeaders.get(HEADERS.QUERY_ARRAY_FORMAT);
    const headerObjectFmt = reqHeaders.get(HEADERS.QUERY_OBJECT_FORMAT);

    const queryArrayFormat = isValidArrayFormat(headerArrayFmt)
      ? headerArrayFmt
      : this.config.validator?.queryArrayFormat;
    const queryObjectFormat = isValidObjectFormat(headerObjectFmt)
      ? headerObjectFmt
      : this.config.validator?.queryObjectFormat;

    const request: AnalyzeRequest = {
      path,
      method,
      queryParams,
      headers,
      pathParams,
      body,
      queryArrayFormat,
      queryObjectFormat,
      consumedQueryParams,
      formArrayFormat: formOptions?.formArrayFormat,
      formObjectFormat: formOptions?.formObjectFormat,
      rawFormKeys,
    };

    return this.diagnosticEngine.analyze(request);
  }
}
