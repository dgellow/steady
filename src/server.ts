import { ServerConfig } from "./types.ts";
import type {
  OpenAPISpec,
  OperationObject,
  PathItemObject,
} from "@steady/parser";
import { MatchError, missingExampleError } from "./errors.ts";
import { ServerSchemaProcessor } from "./schema-processor.ts";
import {
  InkSimpleLogger,
  RequestLogger,
  startInkSimpleLogger,
} from "@steady/shared";
import { RequestValidator } from "./validator.ts";

// ANSI colors for startup message
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export class MockServer {
  private schemaProcessor: ServerSchemaProcessor;
  private abortController: AbortController;
  private logger: RequestLogger;
  private validator: RequestValidator;
  private initialized = false;

  constructor(
    private spec: OpenAPISpec,
    private config: ServerConfig,
  ) {
    this.schemaProcessor = new ServerSchemaProcessor(spec);
    this.abortController = new AbortController();

    // Use interactive logger if requested
    if (config.interactive) {
      this.logger = new InkSimpleLogger(config.logLevel, config.logBodies);
    } else {
      this.logger = new RequestLogger(config.logLevel, config.logBodies);
    }

    this.validator = new RequestValidator(spec, config.mode);
  }

  /**
   * Initialize the server by processing all schemas
   * Must be called before start()
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Process all component schemas upfront for performance
    await this.schemaProcessor.processComponentSchemas();
    this.initialized = true;
  }

  start() {
    if (!this.initialized) {
      throw new Error(
        "Server must be initialized before starting. Call await server.init() first.",
      );
    }
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
        this.stop();
        Deno.exit(0);
      });
    }
  }

  stop() {
    this.abortController.abort();
    if (this.config.interactive && this.logger instanceof InkSimpleLogger) {
      this.logger.stop();
    }
  }

  private printStartupMessage() {
    // In interactive mode, don't print to console (it will be cleared)
    if (this.config.interactive) {
      return;
    }

    console.log(`\n🚀 ${BOLD}Steady Mock Server v1.0.0${RESET}`);
    console.log(
      `📄 Loaded spec: ${this.spec.info.title} v${this.spec.info.version}`,
    );
    console.log(
      `🔗 Server running at http://${this.config.host}:${this.config.port}`,
    );

    // Show configuration
    console.log(`\n${BOLD}Configuration:${RESET}`);
    console.log(
      `  Mode: ${this.config.mode === "strict" ? "🔒 strict" : "🌊 relaxed"}`,
    );
    console.log(
      `  Logging: ${
        this.config.verbose ? `📊 ${this.config.logLevel}` : "🔇 disabled"
      }`,
    );
    if (this.config.logBodies) {
      console.log(`  Bodies: 👁️  shown`);
    }
    if (this.config.interactive) {
      console.log(`  Interactive: 🎮 enabled`);
    }

    // List available endpoints
    console.log(`\n${BOLD}Available endpoints:${RESET}`);
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      const methods = this.getMethodsForPath(pathItem);
      for (const method of methods) {
        console.log(`  ${method.toUpperCase()} ${path}`);
      }
    }

    // Add special endpoints
    console.log(`\n${DIM}Special endpoints:${RESET}`);
    console.log(`  ${DIM}GET /_x-steady/health${RESET}`);
    console.log(`  ${DIM}GET /_x-steady/spec${RESET}`);

    console.log(`\n${DIM}Press Ctrl+C to stop${RESET}\n`);
  }

  private getMethodsForPath(pathItem: PathItemObject): string[] {
    const methods: string[] = [];
    if (pathItem.get) methods.push("get");
    if (pathItem.post) methods.push("post");
    if (pathItem.put) methods.push("put");
    if (pathItem.delete) methods.push("delete");
    if (pathItem.patch) methods.push("patch");
    if (pathItem.head) methods.push("head");
    if (pathItem.options) methods.push("options");
    return methods;
  }

  private async handleRequest(req: Request): Promise<Response> {
    const startTime = performance.now();
    const url = new URL(req.url);
    const method = req.method.toLowerCase();
    const path = url.pathname;

    // Handle special endpoints (no logging for these)
    if (path === "/_x-steady/health") {
      return this.handleHealth();
    }

    if (path === "/_x-steady/spec") {
      return this.handleSpec();
    }

    // Find matching path and operation
    try {
      const { operation, statusCode, pathPattern, pathParams } = this
        .findOperation(path, method);

      // Validate request (now async)
      const validation = await this.validator.validateRequest(
        req,
        operation,
        pathPattern,
        pathParams,
      );

      // Log request (with validation if in details mode)
      this.logger.logRequest(req, path, method, validation);

      // If validation failed in strict mode, return error
      if (!validation.valid && this.config.mode === "strict") {
        const timing = Math.round(performance.now() - startTime);
        this.logger.logResponse(400, timing, validation);

        return new Response(
          JSON.stringify({
            error: "Validation failed",
            errors: validation.errors,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const response = await this.generateResponse(
        operation,
        statusCode,
        path,
        method,
      );

      // Log response
      const timing = Math.round(performance.now() - startTime);
      this.logger.logResponse(parseInt(statusCode), timing, validation);

      return response;
    } catch (error) {
      const timing = Math.round(performance.now() - startTime);

      if (error instanceof MatchError) {
        // Log the request first (no validation for 404s)
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

      // Log other errors
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
    return new Response(
      JSON.stringify({
        status: "healthy",
        version: "1.0.0",
        spec: {
          title: this.spec.info.title,
          version: this.spec.info.version,
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

  private findOperation(
    path: string,
    method: string,
  ): {
    operation: OperationObject;
    statusCode: string;
    pathPattern: string;
    pathParams: Record<string, string>;
  } {
    // Try exact match first (fast path)
    let pathItem = this.spec.paths[path];
    let pathPattern = path;
    let pathParams: Record<string, string> = {};

    if (!pathItem) {
      // Try pattern matching with path parameters
      for (const [pattern, item] of Object.entries(this.spec.paths)) {
        const match = this.matchPath(path, pattern);
        if (match) {
          pathItem = item;
          pathPattern = pattern;
          pathParams = match;
          break;
        }
      }
    }

    if (!pathItem) {
      // List available paths for helpful error
      const availablePaths = Object.keys(this.spec.paths);
      throw new MatchError("Path not found", {
        httpPath: path,
        httpMethod: method.toUpperCase(),
        errorType: "match",
        reason: `No path definition found for "${path}"`,
        suggestion: availablePaths.length > 0
          ? `Available paths: ${availablePaths.join(", ")}`
          : "No paths defined in the OpenAPI spec",
      });
    }

    // Get operation for method
    const operation = pathItem[method as keyof PathItemObject] as
      | OperationObject
      | undefined;

    if (!operation) {
      const availableMethods = this.getMethodsForPath(pathItem);
      throw new MatchError("Method not allowed", {
        httpPath: path,
        httpMethod: method.toUpperCase(),
        errorType: "match",
        reason: `Method ${method.toUpperCase()} not defined for path "${path}"`,
        suggestion: `Available methods: ${
          availableMethods.map((m) => m.toUpperCase()).join(", ")
        }`,
      });
    }

    // Always return 200 if it exists, otherwise first response
    const statusCode = operation.responses["200"]
      ? "200"
      : Object.keys(operation.responses)[0] || "200";

    return { operation, statusCode, pathPattern, pathParams };
  }

  /**
   * Match a request path against an OpenAPI path pattern
   * Supports path parameters like /users/{id}
   * Returns the extracted parameters if match, null otherwise
   */
  private matchPath(
    requestPath: string,
    pattern: string,
  ): Record<string, string> | null {
    // Split paths into segments
    const requestSegments = requestPath.split("/").filter((s) => s.length > 0);
    const patternSegments = pattern.split("/").filter((s) => s.length > 0);

    // Must have same number of segments
    if (requestSegments.length !== patternSegments.length) {
      return null;
    }

    const params: Record<string, string> = {};

    // Match each segment
    for (let i = 0; i < patternSegments.length; i++) {
      const patternSeg = patternSegments[i];
      const requestSeg = requestSegments[i];

      if (!patternSeg || !requestSeg) {
        return null;
      }

      // Check if this is a parameter (e.g., {id})
      if (patternSeg.startsWith("{") && patternSeg.endsWith("}")) {
        // Extract parameter name
        const paramName = patternSeg.slice(1, -1);
        params[paramName] = requestSeg;
      } else if (patternSeg !== requestSeg) {
        // Literal segment must match exactly
        return null;
      }
    }

    return params;
  }

  private async generateResponse(
    operation: OperationObject,
    statusCode: string,
    path: string,
    method: string,
  ): Promise<Response> {
    const responseObj = operation.responses[statusCode];
    if (!responseObj) {
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

    // Generate response body
    let body: unknown = null;
    let contentType = "application/json";

    if (responseObj.content) {
      // For MVP, prefer JSON
      const mediaType = responseObj.content["application/json"] ||
        Object.values(responseObj.content)[0];

      if (mediaType) {
        contentType = responseObj.content["application/json"]
          ? "application/json"
          : Object.keys(responseObj.content)[0] || "application/json";

        try {
          body = await this.schemaProcessor.generateFromMediaType(mediaType);
        } catch (_error) {
          // If generation fails, throw a helpful error
          throw missingExampleError(path, method, statusCode);
        }
      }
    }

    // Build response
    const headers = new Headers({
      "Content-Type": contentType,
      "X-Steady-Matched-Path": path,
      "X-Steady-Example-Source": "generated", // or "provided" if from example
    });

    return new Response(
      body !== null ? JSON.stringify(body, null, 2) : null,
      {
        status: parseInt(statusCode),
        headers,
      },
    );
  }
}
