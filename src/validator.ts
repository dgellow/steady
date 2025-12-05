/**
 * Request Validator - Document-aware validation using SchemaRegistry
 *
 * Uses the document-centric architecture for proper $ref resolution:
 * - All $refs resolve against the full OpenAPI document
 * - No isolated schema processing
 * - Request body validation with size limits
 * - Path parameter extraction and validation
 */

import type { ValidationIssue } from "./types.ts";
import { isReference } from "./types.ts";
import { BodyTooLargeError } from "./errors.ts";
import type { ValidationResult } from "@steady/shared";
import type {
  OperationObject,
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  SchemaObject,
} from "@steady/parser";
import {
  RegistryValidator,
  type Schema,
  type SchemaRegistry,
} from "@steady/json-schema";

/**
 * Filter parameters to only include resolved ParameterObject (not $refs)
 * In the future, we should resolve $refs before validation
 */
function filterResolvedParams(
  params: (ParameterObject | ReferenceObject)[] | undefined,
  location: "query" | "path" | "header" | "cookie",
): ParameterObject[] {
  if (!params) return [];
  return params.filter(
    (p): p is ParameterObject => !isReference(p) && p.in === location,
  );
}

/**
 * Get resolved request body (not $ref)
 */
function getResolvedRequestBody(
  body: RequestBodyObject | ReferenceObject | undefined,
): RequestBodyObject | null {
  if (!body || isReference(body)) return null;
  return body;
}

/**
 * Safely get the type from a schema that might be a reference
 */
function getSchemaType(
  schema: SchemaObject | ReferenceObject | undefined,
): SchemaObject["type"] | undefined {
  if (!schema || isReference(schema)) return undefined;
  return schema.type;
}

/** Maximum request body size (10MB) to prevent DoS attacks */
const MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Validates incoming requests against OpenAPI operation specifications.
 *
 * Uses the document-centric SchemaRegistry for proper $ref resolution.
 * The validator always reports all issues found as errors. The server decides
 * whether to reject requests based on the effective mode (strict/relaxed),
 * which can be overridden per-request via the X-Steady-Mode header.
 */
export class RequestValidator {
  private validator: RegistryValidator;

  constructor(registry: SchemaRegistry) {
    this.validator = new RegistryValidator(registry);
  }

  async validateRequest(
    req: Request,
    operation: OperationObject,
    _pathPattern: string,
    pathParams: Record<string, string>,
  ): Promise<ValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const url = new URL(req.url);

    // Validate query parameters
    const queryParams = filterResolvedParams(operation.parameters, "query");
    if (queryParams.length > 0) {
      const queryValidation = await this.validateQueryParams(
        url.searchParams,
        queryParams,
      );
      errors.push(...queryValidation.errors);
      warnings.push(...queryValidation.warnings);
    }

    // Validate path parameters
    const pathParamSpecs = filterResolvedParams(operation.parameters, "path");
    if (pathParamSpecs.length > 0) {
      const pathValidation = await this.validatePathParams(
        pathParams,
        pathParamSpecs,
      );
      errors.push(...pathValidation.errors);
      warnings.push(...pathValidation.warnings);
    }

    // Validate headers
    const headerParams = filterResolvedParams(operation.parameters, "header");
    if (headerParams.length > 0) {
      const headerValidation = await this.validateHeaders(
        req.headers,
        headerParams,
      );
      errors.push(...headerValidation.errors);
      warnings.push(...headerValidation.warnings);
    }

    // Validate request body (if spec defines one, validate it regardless of HTTP method)
    const requestBody = getResolvedRequestBody(operation.requestBody);
    if (requestBody) {
      const bodyValidation = await this.validateRequestBodyFromRequest(
        req,
        requestBody,
      );
      errors.push(...bodyValidation.errors);
      warnings.push(...bodyValidation.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate query parameters using JSON Schema processor
   */
  private async validateQueryParams(
    params: URLSearchParams,
    paramSpecs: ParameterObject[],
  ): Promise<ValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    for (const spec of paramSpecs) {
      const isArrayType = this.isArraySchema(spec.schema);
      const values = isArrayType
        ? params.getAll(spec.name)
        : [params.get(spec.name)];
      const hasValue = values.length > 0 && values[0] !== null;

      if (spec.required && !hasValue) {
        errors.push({
          path: `query.${spec.name}`,
          message: "Required parameter missing",
          expected: getSchemaType(spec.schema) || "string",
          actual: undefined,
        });
      } else if (hasValue && spec.schema) {
        const parsedValue = isArrayType
          ? values.map((v) => this.parseParamValue(v!, spec.schema!))
          : this.parseParamValue(values[0]!, spec.schema);

        const validation = this.validateValue(
          parsedValue,
          spec.schema as Schema,
          `query.${spec.name}`,
        );
        this.collectErrors(validation, errors, warnings);
      }
    }

    // Check for unknown parameters - reported as errors, server decides based on effective mode
    const knownParams = new Set(paramSpecs.map((p) => p.name));
    for (const [key] of params) {
      if (!knownParams.has(key)) {
        errors.push({
          path: `query.${key}`,
          message: "Unknown parameter",
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate path parameters using JSON Schema processor
   */
  private async validatePathParams(
    pathParams: Record<string, string>,
    paramSpecs: ParameterObject[],
  ): Promise<ValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    for (const spec of paramSpecs) {
      const value = pathParams[spec.name];

      if (spec.required && value === undefined) {
        errors.push({
          path: `path.${spec.name}`,
          message: "Required path parameter missing",
          expected: getSchemaType(spec.schema) || "string",
          actual: undefined,
        });
      } else if (value !== undefined && spec.schema) {
        const validation = this.validateValue(
          this.parseParamValue(value, spec.schema),
          spec.schema as Schema,
          `path.${spec.name}`,
        );
        this.collectErrors(validation, errors, warnings);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate headers using JSON Schema processor
   */
  private async validateHeaders(
    headers: Headers,
    headerSpecs: ParameterObject[],
  ): Promise<ValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    for (const spec of headerSpecs) {
      const value = headers.get(spec.name);

      if (spec.required && value === null) {
        errors.push({
          path: `header.${spec.name}`,
          message: "Required header missing",
          expected: getSchemaType(spec.schema) || "string",
          actual: undefined,
        });
      } else if (value !== null && spec.schema) {
        const validation = this.validateValue(
          this.parseParamValue(value, spec.schema),
          spec.schema as Schema,
          `header.${spec.name}`,
        );
        this.collectErrors(validation, errors, warnings);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Read and validate request body with size limits
   */
  private async validateRequestBodyFromRequest(
    req: Request,
    requestBody: {
      required?: boolean;
      content?: Record<string, { schema?: SchemaObject }>;
    },
  ): Promise<ValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // Check content length header for early rejection
    const contentLength = req.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      // Check for NaN (malformed header), negative values, and exceeding limit
      if (isNaN(size) || size < 0) {
        errors.push({
          path: "body",
          message: `Invalid Content-Length header: "${contentLength}" is not a valid non-negative integer`,
        });
        return { valid: false, errors, warnings };
      }
      if (size > MAX_BODY_SIZE) {
        errors.push({
          path: "body",
          message:
            `Request body too large: ${size} bytes exceeds limit of ${MAX_BODY_SIZE} bytes`,
        });
        return { valid: false, errors, warnings };
      }
    }

    try {
      // Clone and read with streaming to enforce size limit
      const body = await this.readBodyWithLimit(req.clone());
      const contentType = req.headers.get("content-type") || "application/json";

      return this.validateRequestBody(body, requestBody, contentType);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        errors.push({
          path: "body",
          message: error.message,
        });
      } else {
        errors.push({
          path: "body",
          message: `Failed to read request body: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
      return { valid: false, errors, warnings };
    }
  }

  /**
   * Read request body with size limit enforcement
   */
  private async readBodyWithLimit(req: Request): Promise<string> {
    const reader = req.body?.getReader();
    if (!reader) {
      return "";
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > MAX_BODY_SIZE) {
          throw new BodyTooLargeError(
            `Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes`,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const allChunks = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(allChunks);
  }

  /**
   * Validate request body content
   */
  private async validateRequestBody(
    body: string,
    requestBody: {
      required?: boolean;
      content?: Record<string, { schema?: SchemaObject }>;
    },
    contentType: string,
  ): Promise<ValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const mediaType = contentType.split(";")[0]?.trim() || "application/json";

    if (!requestBody.content || !requestBody.content[mediaType]) {
      if (requestBody.required) {
        errors.push({
          path: "body",
          message: `Unsupported content type: ${mediaType}`,
          expected: Object.keys(requestBody.content || {}).join(", "),
          actual: mediaType,
        });
      }
      return { valid: errors.length === 0, errors, warnings };
    }

    const mediaTypeSpec = requestBody.content[mediaType];
    if (!mediaTypeSpec?.schema) {
      return { valid: true, errors, warnings };
    }

    let parsedBody: unknown;
    try {
      if (mediaType === "application/json" || mediaType.endsWith("+json")) {
        parsedBody = JSON.parse(body);
      } else {
        parsedBody = body;
      }
    } catch (error) {
      errors.push({
        path: "body",
        message: `Invalid ${mediaType} format: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return { valid: false, errors, warnings };
    }

    const validation = this.validateValue(
      parsedBody,
      mediaTypeSpec.schema as Schema,
      "body",
    );
    this.collectErrors(validation, errors, warnings);

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate a value against a JSON Schema using the document-aware validator
   */
  private validateValue(
    value: unknown,
    schema: Schema,
    path: string,
  ): ValidationResult {
    // validateData will use path as the base instancePath
    const result = this.validator.validateData(schema, value, path);

    const errors: ValidationIssue[] = result.errors.map((err) => ({
      // instancePath already includes the base path, use it directly
      path: err.instancePath || path,
      message: err.message,
      expected: err.schemaPath,
      actual: value,
    }));

    return {
      valid: result.valid,
      errors,
      warnings: [],
    };
  }

  /**
   * Collect validation errors - always as errors, not warnings.
   * The server decides whether to reject based on effective mode (including per-request override).
   */
  private collectErrors(
    validation: ValidationResult,
    errors: ValidationIssue[],
    _warnings: ValidationIssue[],
  ): void {
    if (!validation.valid) {
      errors.push(...validation.errors);
    }
  }

  /**
   * Check if a schema represents an array type
   */
  private isArraySchema(schema?: SchemaObject): boolean {
    if (!schema) return false;
    if (Array.isArray(schema.type)) {
      return schema.type.includes("array");
    }
    return schema.type === "array";
  }

  /**
   * Parse parameter value based on schema type
   */
  private parseParamValue(value: string, schema: SchemaObject): unknown {
    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type
      ? [schema.type]
      : ["string"];

    const type = types.find((t) => t !== "null") || "string";

    switch (type) {
      case "integer":
        return parseInt(value, 10);
      case "number":
        return parseFloat(value);
      case "boolean":
        return value === "true" || value === "1";
      case "object":
      case "array":
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  }
}
