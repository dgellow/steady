/**
 * Request Validator - Document-aware validation using SchemaRegistry
 *
 * Uses the document-centric architecture for proper $ref resolution:
 * - All $refs resolve against the full OpenAPI document
 * - No isolated schema processing
 * - Request body validation with size limits
 * - Path parameter extraction and validation
 */

import type {
  QueryArrayFormat,
  QueryNestedFormat,
  ValidationIssue,
} from "./types.ts";
import { isReference } from "./types.ts";
import { BodyTooLargeError } from "./errors.ts";
import type { ValidationResult } from "./logging/mod.ts";
import type {
  OperationObject,
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  SchemaObject,
} from "@steady/openapi";
import {
  RegistryValidator,
  type RegistryValidatorOptions,
  type Schema,
  type SchemaRegistry,
} from "@steady/json-schema";

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
export interface RequestValidatorOptions extends RegistryValidatorOptions {
  queryArrayFormat?: QueryArrayFormat;
  queryNestedFormat?: QueryNestedFormat;
}

export class RequestValidator {
  private validator: RegistryValidator;
  private registry: SchemaRegistry;
  private queryArrayFormat: QueryArrayFormat;
  private queryNestedFormat: QueryNestedFormat;

  constructor(registry: SchemaRegistry, options?: RequestValidatorOptions) {
    this.registry = registry;
    this.validator = new RegistryValidator(registry, options);
    this.queryArrayFormat = options?.queryArrayFormat ?? "repeat";
    this.queryNestedFormat = options?.queryNestedFormat ?? "none";
  }

  /**
   * Resolve parameters from an operation, including $ref resolution.
   * Returns only ParameterObject for the specified location.
   */
  private resolveParams(
    params: (ParameterObject | ReferenceObject)[] | undefined,
    location: "query" | "path" | "header" | "cookie",
  ): ParameterObject[] {
    if (!params) return [];

    const resolved: ParameterObject[] = [];
    for (const param of params) {
      if (isReference(param)) {
        // Resolve $ref using registry
        const refResult = this.registry.resolveRef(param.$ref);
        if (refResult === null || refResult === undefined) {
          // Log warning for unresolved parameter reference
          // This indicates a spec issue - the reference points to a non-existent parameter
          console.warn(
            `[Steady] Warning: Could not resolve parameter reference "${param.$ref}". ` +
              `The referenced parameter will be skipped during validation.`,
          );
          continue;
        }
        const resolvedParam = refResult.raw as ParameterObject;
        if (resolvedParam.in === location) {
          resolved.push(resolvedParam);
        }
      } else if (param.in === location) {
        resolved.push(param);
      }
    }
    return resolved;
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
    const queryParams = this.resolveParams(operation.parameters, "query");
    if (queryParams.length > 0) {
      const queryValidation = await this.validateQueryParams(
        url.searchParams,
        queryParams,
      );
      errors.push(...queryValidation.errors);
      warnings.push(...queryValidation.warnings);
    }

    // Validate path parameters
    const pathParamSpecs = this.resolveParams(operation.parameters, "path");
    if (pathParamSpecs.length > 0) {
      const pathValidation = await this.validatePathParams(
        pathParams,
        pathParamSpecs,
      );
      errors.push(...pathValidation.errors);
      warnings.push(...pathValidation.warnings);
    }

    // Validate headers
    const headerParams = this.resolveParams(operation.parameters, "header");
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
   * Get array values from query params based on configured format
   */
  private getArrayValues(params: URLSearchParams, name: string): string[] {
    switch (this.queryArrayFormat) {
      case "repeat":
        // colors=red&colors=green
        return params.getAll(name);
      case "comma": {
        // colors=red,green,blue
        const value = params.get(name);
        return value ? value.split(",") : [];
      }
      case "brackets": {
        // colors[]=red&colors[]=green
        return params.getAll(`${name}[]`);
      }
    }
  }

  /**
   * Check if a parameter has a value based on configured format
   */
  private hasParamValue(
    params: URLSearchParams,
    name: string,
    isArray: boolean,
    isObject: boolean,
  ): boolean {
    if (isObject && this.queryNestedFormat === "brackets") {
      // Check for any key starting with name[
      const prefix = `${name}[`;
      for (const [key] of params) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    }

    if (isArray) {
      return this.getArrayValues(params, name).length > 0;
    }

    return params.get(name) !== null;
  }

  /**
   * Parse nested object from brackets notation: user[name]=sam&user[age]=123 -> { name: "sam", age: "123" }
   * Handles schema references by resolving them first.
   */
  private parseNestedObject(
    params: URLSearchParams,
    name: string,
    schema: SchemaObject | ReferenceObject,
  ): unknown {
    const resolved = this.resolveSchema(schema);
    const result: Record<string, unknown> = {};
    const prefix = `${name}[`;

    for (const [key, value] of params) {
      if (key.startsWith(prefix) && key.endsWith("]")) {
        const propName = key.slice(prefix.length, -1);
        // Get the property schema for type coercion (only if we have resolved schema)
        const propSchema = resolved?.properties?.[propName];
        result[propName] = propSchema
          ? this.parseParamValue(value, propSchema)
          : value;
      }
    }

    return result;
  }

  /**
   * Get the set of known parameter keys based on format.
   * Returns { known: Set of known keys, dynamicPrefixes: Set of prefixes that allow any suffix }
   */
  private getKnownParamKeys(paramSpecs: ParameterObject[]): {
    known: Set<string>;
    dynamicPrefixes: Set<string>;
  } {
    const known = new Set<string>();
    const dynamicPrefixes = new Set<string>();

    for (const spec of paramSpecs) {
      const isArray = this.isArraySchema(spec.schema);
      const isObject = this.isObjectSchema(spec.schema);
      const resolved = this.resolveSchema(spec.schema);

      // Add the base name
      known.add(spec.name);

      // Add format-specific variants
      if (isArray && this.queryArrayFormat === "brackets") {
        known.add(`${spec.name}[]`);
      }

      if (isObject && this.queryNestedFormat === "brackets" && resolved) {
        // If schema has additionalProperties or patternProperties, allow any nested key
        if (
          resolved.additionalProperties !== undefined ||
          resolved.patternProperties !== undefined
        ) {
          dynamicPrefixes.add(`${spec.name}[`);
        }

        // Add all bracket-notation keys for explicitly known properties
        if (resolved.properties) {
          for (const propName of Object.keys(resolved.properties)) {
            known.add(`${spec.name}[${propName}]`);
          }
        }
      }
    }

    return { known, dynamicPrefixes };
  }

  /**
   * Resolve a schema that might be a reference.
   * Returns the resolved SchemaObject or undefined if resolution fails.
   */
  private resolveSchema(
    schema: SchemaObject | ReferenceObject | undefined,
  ): SchemaObject | undefined {
    if (!schema) return undefined;
    if (isReference(schema)) {
      const resolved = this.registry.resolveRef(schema.$ref);
      if (!resolved) return undefined;
      return resolved.raw as SchemaObject;
    }
    return schema;
  }

  /**
   * Check if schema is an object type
   * Checks for type: "object" or object-specific keywords (properties, additionalProperties, patternProperties)
   * Handles schema references by resolving them first.
   */
  private isObjectSchema(
    schema: SchemaObject | ReferenceObject | undefined,
  ): boolean {
    const resolved = this.resolveSchema(schema);
    if (!resolved) return false;
    return (
      resolved.type === "object" ||
      resolved.properties !== undefined ||
      resolved.additionalProperties !== undefined ||
      resolved.patternProperties !== undefined
    );
  }

  /**
   * Validate query parameters using JSON Schema processor
   */
  private validateQueryParams(
    params: URLSearchParams,
    paramSpecs: ParameterObject[],
  ): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    for (const spec of paramSpecs) {
      const isArrayType = this.isArraySchema(spec.schema);
      const isObjectType = this.isObjectSchema(spec.schema);
      const hasValue = this.hasParamValue(
        params,
        spec.name,
        isArrayType,
        isObjectType,
      );

      if (spec.required && !hasValue) {
        errors.push({
          path: `query.${spec.name}`,
          message: "Required parameter missing",
          expected: getSchemaType(spec.schema) || "string",
          actual: undefined,
        });
      } else if (hasValue && spec.schema) {
        // Store schema reference to avoid repeated checks
        const schema = spec.schema;
        let parsedValue: unknown;

        if (isObjectType && this.queryNestedFormat === "brackets") {
          // Parse nested object from brackets notation
          parsedValue = this.parseNestedObject(params, spec.name, schema);
        } else if (isArrayType) {
          // Parse array values
          const values = this.getArrayValues(params, spec.name);
          parsedValue = values.map((v) => this.parseParamValue(v, schema));
        } else {
          // Parse single value - hasValue guarantees the param exists
          const value = params.get(spec.name);
          if (value === null) {
            // This should not happen given hasValue check, but handle gracefully
            continue;
          }
          parsedValue = this.parseParamValue(value, schema);
        }

        const validation = this.validateValue(
          parsedValue,
          schema as Schema,
          `query.${spec.name}`,
        );
        this.collectErrors(validation, errors, warnings);
      }
    }

    // Check for unknown parameters - reported as errors, server decides based on effective mode
    const { known: knownParams, dynamicPrefixes } =
      this.getKnownParamKeys(paramSpecs);
    for (const [key] of params) {
      // Check if key is known directly
      if (knownParams.has(key)) continue;

      // Check if key matches any dynamic prefix (for additionalProperties/patternProperties)
      let isDynamic = false;
      for (const prefix of dynamicPrefixes) {
        if (key.startsWith(prefix) && key.endsWith("]")) {
          isDynamic = true;
          break;
        }
      }
      if (isDynamic) continue;

      // Unknown parameter
      const baseName = key.includes("[") ? key.split("[")[0] : key;
      errors.push({
        path: `query.${baseName}`,
        message: key.includes("[")
          ? `Unknown parameter: ${key}`
          : "Unknown parameter",
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate path parameters using JSON Schema processor
   */
  private validatePathParams(
    pathParams: Record<string, string>,
    paramSpecs: ParameterObject[],
  ): ValidationResult {
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
  private validateHeaders(
    headers: Headers,
    headerSpecs: ParameterObject[],
  ): ValidationResult {
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
          message:
            `Invalid Content-Length header: "${contentLength}" is not a valid non-negative integer`,
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
  private validateRequestBody(
    body: string,
    requestBody: {
      required?: boolean;
      content?: Record<string, { schema?: SchemaObject }>;
    },
    contentType: string,
  ): ValidationResult {
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
   * Handles schema references by resolving them first.
   */
  private isArraySchema(schema?: SchemaObject | ReferenceObject): boolean {
    const resolved = this.resolveSchema(schema);
    if (!resolved) return false;
    if (Array.isArray(resolved.type)) {
      return resolved.type.includes("array");
    }
    return resolved.type === "array";
  }

  /**
   * Parse parameter value based on schema type
   * Handles schema references by resolving them first.
   */
  private parseParamValue(
    value: string,
    schema: SchemaObject | ReferenceObject,
  ): unknown {
    const resolved = this.resolveSchema(schema);
    // If we can't resolve the schema, treat as string
    if (!resolved) return value;

    const types = Array.isArray(resolved.type)
      ? resolved.type
      : resolved.type
      ? [resolved.type]
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
