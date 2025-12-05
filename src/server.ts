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

import type { ServerConfig, ResponseObject } from "./types.ts";
import { isReference } from "./types.ts";
import type {
  OpenAPISpec,
  OperationObject,
  PathItemObject,
} from "@steady/parser";
import { MatchError, missingExampleError } from "./errors.ts";
import {
  OpenAPIDocument,
  RegistryResponseGenerator,
  formatStartupDiagnostics,
  formatSessionSummary,
} from "@steady/json-schema";
import {
  InkSimpleLogger,
  RequestLogger,
  startInkSimpleLogger,
} from "@steady/shared";
import { RequestValidator } from "./validator.ts";
import { DiagnosticCollector } from "./diagnostics/collector.ts";
import {
  compilePathPattern,
  matchCompiledPath,
  type PathSegment,
} from "./path-matcher.ts";

// ANSI colors for startup message
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

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
}

export class MockServer {
  /** Document-centric OpenAPI processing */
  private document: OpenAPIDocument;
  private abortController: AbortController;
  private logger: RequestLogger;
  private validator: RequestValidator;
  private diagnosticCollector: DiagnosticCollector;

  // Pre-compiled routes for O(1) exact matches and efficient pattern matching
  private exactRoutes = new Map<string, PathItemObject>();
  private patternRoutes: CompiledPath[] = [];

  constructor(
    private spec: OpenAPISpec,
    private config: ServerConfig,
  ) {
    // Create document-centric processor - all $refs will resolve correctly
    this.document = new OpenAPIDocument(spec);

    this.abortController = new AbortController();
    this.diagnosticCollector = new DiagnosticCollector();

    // Use interactive logger if requested
    if (config.interactive) {
      this.logger = new InkSimpleLogger(config.logLevel, config.logBodies);
    } else {
      this.logger = new RequestLogger(config.logLevel, config.logBodies);
    }

    this.validator = new RequestValidator();

    // Pre-compile all path patterns at construction time
    this.compileRoutes();

    // Collect static diagnostics
    this.diagnosticCollector.setStaticDiagnostics(this.document.getDiagnostics());
  }

  /**
   * Pre-compile all routes for efficient matching
   */
  private compileRoutes(): void {
    for (const [pattern, pathItem] of Object.entries(this.spec.paths)) {
      // Check if this is an exact path (no parameters)
      if (!pattern.includes("{")) {
        this.exactRoutes.set(pattern, pathItem);
      } else {
        // Compile the pattern using shared utility
        const compiled = compilePathPattern(pattern);
        this.patternRoutes.push({
          ...compiled,
          pathItem,
        });
      }
    }

    // Sort pattern routes by specificity (more literal segments first)
    this.patternRoutes.sort((a, b) => {
      const aLiterals = a.segments.filter((s) => s.type === "literal").length;
      const bLiterals = b.segments.filter((s) => s.type === "literal").length;
      return bLiterals - aLiterals;
    });
  }

  /**
   * Initialize the server
   * With the document-centric architecture, initialization is lightweight -
   * schemas are processed lazily on first access
   */
  async init(): Promise<void> {
    // Document is already created in constructor
    // Ref graph is built, schemas will be processed lazily
    // Optionally, we could warm up the cache here for all component schemas
  }

  start(): void {
    // Start interactive logger if enabled
    if (this.config.interactive && this.logger instanceof InkSimpleLogger) {
      startInkSimpleLogger(this.logger);
    }

    Deno.serve({
      port: this.config.port,
      hostname: this.config.host,
      signal: this.abortController.signal,
      onListen: () => {
        this.printStartupMessage();
      },
    }, (req) => this.handleRequest(req));

    // Handle graceful shutdown
    if (!this.config.interactive) {
      Deno.addSignalListener("SIGINT", () => {
        console.log("\n\nShutting down gracefully...");
        this.printSessionSummary();
        this.stop();
        Deno.exit(0);
      });
    }
  }

  stop(): void {
    this.abortController.abort();
    if (this.config.interactive && this.logger instanceof InkSimpleLogger) {
      this.logger.stop();
    }
  }

  private printSessionSummary(): void {
    const staticDiagnostics = this.diagnosticCollector.getStaticDiagnostics();
    const runtimeDiagnostics = this.diagnosticCollector.getRuntimeDiagnostics();
    const stats = this.diagnosticCollector.getStats();

    if (stats.requestCount > 0 || runtimeDiagnostics.length > 0) {
      console.log("\n" + formatSessionSummary(
        staticDiagnostics,
        runtimeDiagnostics,
        stats.requestCount,
        true,
      ));
    }
  }

  private printStartupMessage(): void {
    if (this.config.interactive) {
      return;
    }

    const stats = this.document.getStats();
    const diagnostics = this.diagnosticCollector.getStaticDiagnostics();

    console.log(`\n${BOLD}Steady Mock Server v1.0.0${RESET}`);
    console.log(
      `Loaded spec: ${this.spec.info.title} v${this.spec.info.version}`,
    );
    console.log(
      `Server running at http://${this.config.host}:${this.config.port}`,
    );

    console.log(`\n${BOLD}Configuration:${RESET}`);
    console.log(
      `  Mode: ${this.config.mode === "strict" ? "strict" : "relaxed"}`,
    );
    console.log(
      `  Logging: ${this.config.verbose ? this.config.logLevel : "disabled"}`,
    );
    if (this.config.logBodies) {
      console.log(`  Bodies: shown`);
    }
    if (this.config.interactive) {
      console.log(`  Interactive: enabled`);
    }

    // Show ref graph stats
    console.log(`\n${BOLD}Schema Analysis:${RESET}`);
    console.log(`  Total refs: ${stats.totalRefs}`);
    console.log(`  Cyclic refs: ${stats.cyclicRefs}`);
    if (stats.cycles > 0) {
      console.log(`  ${DIM}(cycles handled gracefully)${RESET}`);
    }

    // Show diagnostics
    if (diagnostics.length > 0) {
      console.log(`\n${BOLD}Diagnostics:${RESET}`);
      console.log(formatStartupDiagnostics(diagnostics, true));
    } else {
      console.log(`\n${DIM}✓ No diagnostic issues found${RESET}`);
    }

    // List available endpoints
    console.log(`\n${BOLD}Available endpoints:${RESET}`);
    const endpointCount = {
      exact: this.exactRoutes.size,
      pattern: this.patternRoutes.length,
    };

    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      const methods = this.getMethodsForPath(pathItem);
      for (const method of methods) {
        console.log(`  ${method.toUpperCase().padEnd(7)} ${path}`);
      }
    }

    console.log(`\n${DIM}Special endpoints:${RESET}`);
    console.log(`  ${DIM}GET     /_x-steady/health${RESET}`);
    console.log(`  ${DIM}GET     /_x-steady/spec${RESET}`);

    console.log(
      `\n${DIM}Routes compiled: ${endpointCount.exact} exact, ${endpointCount.pattern} patterns${RESET}`,
    );
    console.log(`${DIM}Press Ctrl+C to stop${RESET}\n`);
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

    // Determine effective mode: header override or server default
    const effectiveMode = this.getEffectiveMode(req);

    try {
      const { operation, statusCode, pathPattern, pathParams } = this
        .findOperation(path, method);

      // Validate request
      const validation = await this.validator.validateRequest(
        req,
        operation,
        pathPattern,
        pathParams,
      );

      // Log request
      this.logger.logRequest(req, path, method, validation);

      // If validation failed in strict mode, return error
      if (!validation.valid && effectiveMode === "strict") {
        const timing = Math.round(performance.now() - startTime);
        this.logger.logResponse(400, timing, validation);

        return new Response(
          JSON.stringify({
            error: "Validation failed",
            errors: validation.errors,
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "X-Steady-Mode": effectiveMode,
            },
          },
        );
      }

      const response = this.generateResponse(
        operation,
        statusCode,
        path,
        method,
        pathPattern,
      );

      const timing = Math.round(performance.now() - startTime);
      this.logger.logResponse(parseInt(statusCode), timing, validation);

      // Add mode header to response
      return this.addModeHeader(response, effectiveMode);
    } catch (error) {
      const timing = Math.round(performance.now() - startTime);

      if (error instanceof MatchError) {
        this.logger.logRequest(req, path, method);
        this.logger.logResponse(404, timing);
        if (this.config.logLevel !== "summary") {
          console.error(error.format());
        }
        return new Response(
          JSON.stringify({
            error: error.message,
            suggestion: error.context.suggestion,
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      this.logger.logRequest(req, path, method);
      this.logger.logResponse(500, timing);
      console.error(error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  private handleHealth(): Response {
    const stats = this.document.getStats();
    return new Response(
      JSON.stringify({
        status: "healthy",
        version: "1.0.0",
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
   * Find matching operation using pre-compiled routes
   */
  private findOperation(
    path: string,
    method: string,
  ): {
    operation: OperationObject;
    statusCode: string;
    pathPattern: string;
    pathParams: Record<string, string>;
  } {
    // Try exact match first (O(1) lookup)
    const exactMatch = this.exactRoutes.get(path);
    if (exactMatch) {
      const operation = this.getOperationForMethod(exactMatch, method, path);
      const statusCode = this.selectStatusCode(operation);
      return { operation, statusCode, pathPattern: path, pathParams: {} };
    }

    // Try pattern matching with pre-compiled routes using shared utility
    for (const compiled of this.patternRoutes) {
      const params = matchCompiledPath(path, compiled);
      if (params) {
        const operation = this.getOperationForMethod(
          compiled.pathItem,
          method,
          compiled.pattern,
        );
        const statusCode = this.selectStatusCode(operation);
        return {
          operation,
          statusCode,
          pathPattern: compiled.pattern,
          pathParams: params,
        };
      }
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
   */
  private selectStatusCode(operation: OperationObject): string {
    if (operation.responses["200"]) return "200";
    if (operation.responses["201"]) return "201";
    if (operation.responses["204"]) return "204";
    return Object.keys(operation.responses)[0] || "200";
  }

  /**
   * Generate response using the document-centric architecture
   */
  private generateResponse(
    operation: OperationObject,
    statusCode: string,
    path: string,
    method: string,
    pathPattern: string,
  ): Response {
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
          suggestion: "Check that the referenced response exists in components/responses",
        });
      }
      // Use resolved response
      return this.generateResponseFromObject(
        resolved.raw as ResponseObject,
        statusCode,
        path,
        method,
        pathPattern,
      );
    }

    return this.generateResponseFromObject(
      responseObjOrRef as ResponseObject,
      statusCode,
      path,
      method,
      pathPattern,
    );
  }

  /**
   * Generate response from a resolved ResponseObject
   */
  private generateResponseFromObject(
    responseObj: ResponseObject,
    statusCode: string,
    path: string,
    method: string,
    pathPattern: string,
  ): Response {
    let body: unknown = null;
    let contentType = "application/json";

    if (responseObj.content) {
      // Prefer JSON, then any other content type
      const mediaType = responseObj.content["application/json"] ||
        Object.values(responseObj.content)[0];

      if (mediaType) {
        contentType = responseObj.content["application/json"]
          ? "application/json"
          : Object.keys(responseObj.content)[0] || "application/json";

        // Priority 1: Explicit example
        if (mediaType.example !== undefined) {
          body = mediaType.example;
        }
        // Priority 2: First example from examples map
        else if (mediaType.examples && Object.keys(mediaType.examples).length > 0) {
          const firstExampleOrRef = Object.values(mediaType.examples)[0];
          if (firstExampleOrRef && !isReference(firstExampleOrRef)) {
            const example = firstExampleOrRef as { value?: unknown };
            if (example.value !== undefined) {
              body = example.value;
            }
          }
        }
        // Priority 3: Generate from schema using document-centric approach
        else if (mediaType.schema) {
          body = this.generateFromSchemaObject(mediaType.schema, pathPattern, method, statusCode);
        }

        if (body === null && mediaType.schema) {
          throw missingExampleError(path, method, statusCode);
        }
      }
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "X-Steady-Matched-Path": pathPattern,
      "X-Steady-Example-Source": body !== null ? "generated" : "none",
    });

    // Safely stringify body - handle circular references and non-serializable values
    let bodyString: string | null = null;
    if (body !== null) {
      try {
        bodyString = JSON.stringify(body, null, 2);
      } catch (error) {
        // Handle non-serializable values (circular refs, BigInt, etc.)
        const errorMessage = error instanceof Error ? error.message : "Unknown serialization error";
        console.error(`[Steady] Failed to serialize response body: ${errorMessage}`);
        bodyString = JSON.stringify({
          error: "Response serialization failed",
          reason: errorMessage,
          hint: "The generated response contains non-serializable values (circular references, BigInt, etc.)",
        }, null, 2);
        headers.set("X-Steady-Serialization-Error", "true");
      }
    }

    return new Response(
      bodyString,
      {
        status: parseInt(statusCode),
        headers,
      },
    );
  }

  /**
   * Generate data from a schema object using the document-centric approach
   */
  private generateFromSchemaObject(
    schema: unknown,
    pathPattern: string,
    method: string,
    statusCode: string,
  ): unknown {
    // If schema is a reference, use the document to resolve and generate
    if (typeof schema === "object" && schema !== null && "$ref" in schema) {
      const ref = (schema as { $ref: string }).$ref;
      return this.document.generateResponse(ref);
    }

    // For inline schemas, create a generator with document access
    const generator = new RegistryResponseGenerator(this.document.schemas);
    return generator.generateFromSchema(
      schema as Parameters<RegistryResponseGenerator["generateFromSchema"]>[0],
      `#/paths/${this.escapePointer(pathPattern)}/${method}/responses/${statusCode}/content/application~1json/schema`,
      0,
    );
  }

  /**
   * Escape a path segment for JSON Pointer
   */
  private escapePointer(path: string): string {
    return path.replace(/~/g, "~0").replace(/\//g, "~1");
  }

  /**
   * Get effective validation mode for a request.
   * X-Steady-Mode header overrides server default.
   */
  private getEffectiveMode(req: Request): "strict" | "relaxed" {
    const headerValue = req.headers.get("X-Steady-Mode");
    if (headerValue === "strict" || headerValue === "relaxed") {
      return headerValue;
    }
    return this.config.mode;
  }

  /**
   * Add X-Steady-Mode header to a response.
   * Creates a new Response since headers are immutable.
   */
  private addModeHeader(response: Response, mode: "strict" | "relaxed"): Response {
    const newHeaders = new Headers(response.headers);
    newHeaders.set("X-Steady-Mode", mode);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }
}
