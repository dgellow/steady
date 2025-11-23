/**
 * Request Validator - Enterprise-scale validation using JSON Schema processor
 *
 * Integrates the @steady/json-schema processor to provide:
 * - Complete JSON Schema 2020-12 validation
 * - Error attribution (SDK vs spec issues)
 * - Request body validation
 * - Path parameter extraction and validation
 * - Enterprise-scale performance
 */

import { ValidationError } from "./types.ts";
import type { ValidationResult } from "@steady/shared";
import type {
  OpenAPISpec,
  OperationObject,
  ParameterObject,
  SchemaObject,
} from "@steady/parser";
import {
  JsonSchemaProcessor,
  SchemaValidator,
  type ProcessedSchema,
  type Schema,
} from "../packages/json-schema/mod.ts";

export class RequestValidator {
  private schemaProcessors: Map<string, SchemaValidator> = new Map();
  private processingCache: Map<SchemaObject, Promise<ProcessedSchema>> = new Map();

  constructor(
    private spec: OpenAPISpec,
    private mode: "strict" | "relaxed",
  ) {}

  async validateRequest(
    req: Request,
    operation: OperationObject,
    pathPattern: string,
    pathParams: Record<string, string>,
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const url = new URL(req.url);

    // Validate query parameters
    if (operation.parameters) {
      const queryParams = operation.parameters.filter((p) => p.in === "query");
      const queryValidation = await this.validateQueryParams(
        url.searchParams,
        queryParams,
      );
      errors.push(...queryValidation.errors);
      warnings.push(...queryValidation.warnings);
    }

    // Validate path parameters
    if (operation.parameters) {
      const pathParamSpecs = operation.parameters.filter((p) => p.in === "path");
      const pathValidation = await this.validatePathParams(
        pathParams,
        pathParamSpecs,
      );
      errors.push(...pathValidation.errors);
      warnings.push(...pathValidation.warnings);
    }

    // Validate headers
    if (operation.parameters) {
      const headerParams = operation.parameters.filter((p) =>
        p.in === "header"
      );
      const headerValidation = await this.validateHeaders(
        req.headers,
        headerParams,
      );
      errors.push(...headerValidation.errors);
      warnings.push(...headerValidation.warnings);
    }

    // Validate request body
    if (
      operation.requestBody && req.method !== "GET" && req.method !== "HEAD"
    ) {
      try {
        const body = await req.clone().text();
        const bodyValidation = await this.validateRequestBody(
          body,
          operation.requestBody,
          req.headers.get("content-type") || "application/json",
        );
        errors.push(...bodyValidation.errors);
        warnings.push(...bodyValidation.warnings);
      } catch (error) {
        errors.push({
          path: "body",
          message: `Failed to read request body: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
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
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Check required parameters
    for (const spec of paramSpecs) {
      const value = params.get(spec.name);

      if (spec.required && value === null) {
        errors.push({
          path: `query.${spec.name}`,
          message: "Required parameter missing",
          expected: spec.schema?.type || "string",
          actual: undefined,
        });
      } else if (value !== null && spec.schema) {
        // Validate parameter using JSON Schema processor
        const validation = await this.validateValue(
          this.parseQueryValue(value, spec.schema),
          spec.schema as Schema,
          `query.${spec.name}`,
        );
        if (!validation.valid) {
          if (this.mode === "strict") {
            errors.push(...validation.errors);
          } else {
            warnings.push(...validation.errors);
          }
        }
      }
    }

    // Check for unknown parameters
    const knownParams = new Set(paramSpecs.map((p) => p.name));
    for (const [key] of params) {
      if (!knownParams.has(key)) {
        const warning: ValidationError = {
          path: `query.${key}`,
          message: "Unknown parameter",
        };
        if (this.mode === "strict") {
          errors.push(warning);
        } else {
          warnings.push(warning);
        }
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
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    for (const spec of paramSpecs) {
      const value = pathParams[spec.name];

      if (spec.required && value === undefined) {
        errors.push({
          path: `path.${spec.name}`,
          message: "Required path parameter missing",
          expected: spec.schema?.type || "string",
          actual: undefined,
        });
      } else if (value !== undefined && spec.schema) {
        // Validate parameter using JSON Schema processor
        const validation = await this.validateValue(
          this.parseQueryValue(value, spec.schema),
          spec.schema as Schema,
          `path.${spec.name}`,
        );
        if (!validation.valid) {
          if (this.mode === "strict") {
            errors.push(...validation.errors);
          } else {
            warnings.push(...validation.errors);
          }
        }
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
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    for (const spec of headerSpecs) {
      const value = headers.get(spec.name);

      if (spec.required && value === null) {
        errors.push({
          path: `header.${spec.name}`,
          message: "Required header missing",
          expected: spec.schema?.type || "string",
          actual: undefined,
        });
      } else if (value !== null && spec.schema) {
        // Validate header using JSON Schema processor
        const validation = await this.validateValue(
          this.parseQueryValue(value, spec.schema),
          spec.schema as Schema,
          `header.${spec.name}`,
        );
        if (!validation.valid) {
          if (this.mode === "strict") {
            errors.push(...validation.errors);
          } else {
            warnings.push(...validation.errors);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate request body using JSON Schema processor
   */
  private async validateRequestBody(
    body: string,
    requestBody: { required?: boolean; content?: Record<string, { schema?: SchemaObject }> },
    contentType: string,
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Parse content type (strip parameters like charset)
    const mediaType = contentType.split(";")[0]?.trim() || "application/json";

    // Check if content type is supported
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
      // No schema to validate against
      return { valid: true, errors, warnings };
    }

    // Parse body based on content type
    let parsedBody: unknown;
    try {
      if (mediaType === "application/json" || mediaType.endsWith("+json")) {
        parsedBody = JSON.parse(body);
      } else {
        // For non-JSON content types, validate as string
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

    // Validate using JSON Schema processor
    const validation = await this.validateValue(
      parsedBody,
      mediaTypeSpec.schema as Schema,
      "body",
    );

    if (!validation.valid) {
      if (this.mode === "strict") {
        errors.push(...validation.errors);
      } else {
        warnings.push(...validation.errors);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate a value against a JSON Schema using the processor
   */
  private async validateValue(
    value: unknown,
    schema: Schema,
    path: string,
  ): Promise<ValidationResult> {
    // Get or create schema validator
    const schemaKey = JSON.stringify(schema);
    let validator = this.schemaProcessors.get(schemaKey);

    if (!validator) {
      try {
        // Process schema once
        const processor = new JsonSchemaProcessor();
        const processResult = await processor.process(schema, {
          baseUri: "steady://internal/validation",
        });

        if (!processResult.valid || !processResult.schema) {
          // Schema itself is invalid - this is a spec error
          return {
            valid: false,
            errors: processResult.errors.map((err) => ({
              path,
              message: `Invalid schema in OpenAPI spec: ${err.message}`,
              expected: "Valid JSON Schema",
              actual: schema,
            })),
            warnings: [],
          };
        }

        validator = new SchemaValidator(processResult.schema);
        this.schemaProcessors.set(schemaKey, validator);
      } catch (error) {
        return {
          valid: false,
          errors: [{
            path,
            message: `Schema processing failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }],
          warnings: [],
        };
      }
    }

    // Validate the data
    const result = validator.validate(value);

    // Convert JSON Schema validation errors to our format
    const errors: ValidationError[] = result.errors.map((err) => ({
      path: err.instancePath ? `${path}${err.instancePath}` : path,
      message: err.message,
      expected: err.schema,
      actual: err.data,
    }));

    return {
      valid: result.valid,
      errors,
      warnings: [],
    };
  }

  /**
   * Parse query parameter value based on schema type
   */
  private parseQueryValue(value: string, schema: SchemaObject): unknown {
    // Handle OpenAPI 3.1 type arrays
    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type
      ? [schema.type]
      : ["string"];

    // Find the first non-null type
    const type = types.find((t) => t !== "null") || "string";

    switch (type) {
      case "integer":
        return parseInt(value, 10);
      case "number":
        return parseFloat(value);
      case "boolean":
        return value === "true";
      case "array":
        // Query params like ?tag=a&tag=b should be parsed as array
        return [value];
      case "object":
        // Try to parse as JSON
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
