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
  MediaTypeObject,
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

import { BodyTooLargeError } from "./errors.ts";
import {
  getMediaType,
  isFormMediaType,
  isJsonMediaType,
  parseFormData,
  parseUrlEncoded,
} from "./form-parser.ts";
import { formatExpected } from "./logging/format-expected.ts";
import {
  type ConcreteArrayFormat,
  type ConcreteObjectFormat,
  getArrayValues,
  hasParamValue,
  parseBracketPath,
  resolveArrayFormat,
  resolveObjectFormat,
  setNestedValue,
  wrapURLSearchParams,
} from "./param-format.ts";
import type {
  QueryArrayFormat,
  QueryObjectFormat,
  ValidationIssue,
} from "./types.ts";
import {
  HEADERS,
  isReference,
  isValidArrayFormat,
  isValidObjectFormat,
} from "./types.ts";

/**
 * Result of validating a request
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  requestBody?: unknown;
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
  queryObjectFormat?: QueryObjectFormat;
  formArrayFormat?: QueryArrayFormat;
  formObjectFormat?: QueryObjectFormat;
}

export class RequestValidator {
  private validator: RegistryValidator;
  private registry: SchemaRegistry;
  private queryArrayFormat: QueryArrayFormat;
  private queryObjectFormat: QueryObjectFormat;
  private formArrayFormat: QueryArrayFormat;
  private formObjectFormat: QueryObjectFormat;

  constructor(registry: SchemaRegistry, options?: RequestValidatorOptions) {
    this.registry = registry;
    this.validator = new RegistryValidator(registry, options);
    this.queryArrayFormat = options?.queryArrayFormat ?? "auto";
    this.queryObjectFormat = options?.queryObjectFormat ?? "auto";
    this.formArrayFormat = options?.formArrayFormat ?? "auto";
    this.formObjectFormat = options?.formObjectFormat ?? "auto";
  }

  /**
   * Result of resolving parameters, including any warnings for unresolved $refs.
   */
  private resolveParams(
    params: (ParameterObject | ReferenceObject)[] | undefined,
    location: "query" | "path" | "header" | "cookie",
  ): { params: ParameterObject[]; warnings: ValidationIssue[] } {
    if (!params) return { params: [], warnings: [] };

    const resolved: ParameterObject[] = [];
    const warnings: ValidationIssue[] = [];

    for (const param of params) {
      if (isReference(param)) {
        // Resolve $ref using registry
        const refResult = this.registry.resolveRef(param.$ref);
        if (refResult === null || refResult === undefined) {
          // Spec issue: reference points to non-existent parameter
          warnings.push({
            path: `parameters`,
            message:
              `Unresolved parameter reference "${param.$ref}" - parameter skipped during validation`,
          });
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
    return { params: resolved, warnings };
  }

  async validateRequest(
    req: Request,
    operation: OperationObject,
    pathParams: Record<string, string>,
    consumedQueryParams?: string[],
  ): Promise<ValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const url = new URL(req.url);

    // Check for per-request override of query formats
    const arrayFormatHeader = req.headers.get(HEADERS.QUERY_ARRAY_FORMAT);
    const effectiveArrayFormat = isValidArrayFormat(arrayFormatHeader)
      ? arrayFormatHeader
      : this.queryArrayFormat;

    const objectFormatHeader = req.headers.get(HEADERS.QUERY_OBJECT_FORMAT);
    const effectiveObjectFormat = isValidObjectFormat(objectFormatHeader)
      ? objectFormatHeader
      : this.queryObjectFormat;

    // Check for per-request override of form formats
    const formArrayFormatHeader = req.headers.get(HEADERS.FORM_ARRAY_FORMAT);
    const effectiveFormArrayFormat = isValidArrayFormat(formArrayFormatHeader)
      ? formArrayFormatHeader
      : this.formArrayFormat;

    const formObjectFormatHeader = req.headers.get(HEADERS.FORM_OBJECT_FORMAT);
    const effectiveFormObjectFormat =
      isValidObjectFormat(formObjectFormatHeader)
        ? formObjectFormatHeader
        : this.formObjectFormat;

    // Validate query parameters
    const queryResolved = this.resolveParams(operation.parameters, "query");
    warnings.push(...queryResolved.warnings);
    if (queryResolved.params.length > 0 || consumedQueryParams) {
      const queryValidation = await this.validateQueryParams(
        url.searchParams,
        queryResolved.params,
        effectiveArrayFormat,
        effectiveObjectFormat,
        consumedQueryParams,
      );
      errors.push(...queryValidation.errors);
      warnings.push(...queryValidation.warnings);
    }

    // Validate path parameters
    const pathResolved = this.resolveParams(operation.parameters, "path");
    warnings.push(...pathResolved.warnings);
    if (pathResolved.params.length > 0) {
      const pathValidation = await this.validatePathParams(
        pathParams,
        pathResolved.params,
      );
      errors.push(...pathValidation.errors);
      warnings.push(...pathValidation.warnings);
    }

    // Validate headers
    const headerResolved = this.resolveParams(operation.parameters, "header");
    warnings.push(...headerResolved.warnings);
    if (headerResolved.params.length > 0) {
      const headerValidation = await this.validateHeaders(
        req.headers,
        headerResolved.params,
      );
      errors.push(...headerValidation.errors);
      warnings.push(...headerValidation.warnings);
    }

    // Validate cookies
    const cookieResolved = this.resolveParams(operation.parameters, "cookie");
    warnings.push(...cookieResolved.warnings);
    if (cookieResolved.params.length > 0) {
      const cookieValidation = this.validateCookies(
        req.headers,
        cookieResolved.params,
      );
      errors.push(...cookieValidation.errors);
      warnings.push(...cookieValidation.warnings);
    }

    // Validate request body (if spec defines one, validate it regardless of HTTP method)
    let parsedRequestBody: unknown;
    const requestBodySpec = getResolvedRequestBody(operation.requestBody);
    if (requestBodySpec) {
      const bodyValidation = await this.validateRequestBodyFromRequest(
        req,
        requestBodySpec,
        effectiveFormArrayFormat,
        effectiveFormObjectFormat,
      );
      errors.push(...bodyValidation.errors);
      warnings.push(...bodyValidation.warnings);
      parsedRequestBody = bodyValidation.requestBody;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      requestBody: parsedRequestBody,
    };
  }

  /**
   * Parse object query parameter based on format.
   */
  private parseObjectParam(
    params: URLSearchParams,
    name: string,
    schema: SchemaObject | ReferenceObject,
    objectFormat: Exclude<QueryObjectFormat, "auto">,
  ): unknown {
    const resolved = this.resolveSchema(schema);

    switch (objectFormat) {
      case "flat": {
        // role=admin&firstName=Alex -> {role: "admin", firstName: "Alex"}
        // Properties are top-level params, need to extract based on schema
        const result: Record<string, unknown> = Object.create(null);
        if (resolved?.properties) {
          for (const propName of Object.keys(resolved.properties)) {
            const value = params.get(propName);
            if (value !== null) {
              const propSchema = resolved.properties[propName];
              result[propName] = propSchema && !isReference(propSchema)
                ? this.parseParamValue(value, propSchema)
                : value;
            }
          }
        }
        return result;
      }

      case "flat-comma": {
        // id=role,admin,firstName,Alex -> {role: "admin", firstName: "Alex"}
        const value = params.get(name);
        if (!value) return Object.create(null);

        const parts = value.split(",");
        const result: Record<string, unknown> = Object.create(null);
        for (let i = 0; i < parts.length - 1; i += 2) {
          const key = parts[i];
          const val = parts[i + 1];
          if (key !== undefined && val !== undefined) {
            const propSchema = resolved?.properties?.[key];
            result[key] = propSchema && !isReference(propSchema)
              ? this.parseParamValue(val, propSchema)
              : val;
          }
        }
        return result;
      }

      case "brackets": {
        // id[role]=admin&id[firstName]=Alex -> {role: "admin", firstName: "Alex"}
        const result: Record<string, unknown> = Object.create(null);
        const prefix = `${name}[`;

        for (const [key, value] of params) {
          if (key.startsWith(prefix)) {
            const path = parseBracketPath(key, name);
            if (path.length > 0) {
              const propSchema = this.getNestedPropertySchema(resolved, path);
              const coercedValue = propSchema
                ? this.parseParamValue(value, propSchema)
                : value;
              setNestedValue(result, path, coercedValue);
            }
          }
        }
        return result;
      }

      case "dots": {
        // id.role=admin&id.firstName=Alex -> {role: "admin", firstName: "Alex"}
        const result: Record<string, unknown> = Object.create(null);
        const prefix = `${name}.`;

        for (const [key, value] of params) {
          if (key.startsWith(prefix)) {
            const path = key.slice(prefix.length).split(".");
            if (path.length > 0) {
              const propSchema = this.getNestedPropertySchema(resolved, path);
              const coercedValue = propSchema
                ? this.parseParamValue(value, propSchema)
                : value;
              setNestedValue(result, path, coercedValue);
            }
          }
        }
        return result;
      }
    }
  }

  /**
   * Get the schema for a nested property path
   */
  private getNestedPropertySchema(
    schema: SchemaObject | undefined,
    path: string[],
  ): SchemaObject | ReferenceObject | undefined {
    if (!schema) return undefined;

    let current: SchemaObject | undefined = schema;

    for (const segment of path) {
      if (!current?.properties) return undefined;
      const prop = current.properties[segment];
      if (!prop) return undefined;
      if (isReference(prop)) {
        current = this.resolveSchema(prop);
      } else {
        current = prop;
      }
    }

    return current;
  }

  private getKnownParamKeys(
    paramSpecs: ParameterObject[],
    arrayFormat: QueryArrayFormat,
    objectFormat: QueryObjectFormat,
  ): {
    known: Set<string>;
    dynamicPrefixes: Set<string>;
  } {
    const known = new Set<string>();
    const dynamicPrefixes = new Set<string>();

    for (const spec of paramSpecs) {
      const isArray = this.isArraySchema(spec.schema);
      const resolved = this.resolveSchema(spec.schema);
      const objectSchema = this.getObjectSchemaFromComposition(resolved);

      // Resolve 'auto' to concrete format for this parameter
      const resolvedArrayFormat = resolveArrayFormat(arrayFormat, spec);
      const resolvedObjectFormat = resolveObjectFormat(objectFormat, spec);

      known.add(spec.name);

      if (isArray && resolvedArrayFormat === "brackets") {
        known.add(`${spec.name}[]`);
      }

      // For object params, add known keys based on format
      // Note: flat and flat-comma don't add prefixed keys (they use the param name or property names directly)
      if (objectSchema) {
        if (resolvedObjectFormat === "flat" && objectSchema.properties) {
          // In flat format, object properties become top-level params
          for (const propName of Object.keys(objectSchema.properties)) {
            known.add(propName);
          }
        }

        // For brackets/dots, add prefixed keys
        if (
          resolvedObjectFormat === "brackets" || resolvedObjectFormat === "dots"
        ) {
          if (
            objectSchema.additionalProperties !== undefined ||
            objectSchema.patternProperties !== undefined
          ) {
            if (resolvedObjectFormat === "brackets") {
              dynamicPrefixes.add(`${spec.name}[`);
            }
            if (resolvedObjectFormat === "dots") {
              dynamicPrefixes.add(`${spec.name}.`);
            }
          }

          if (objectSchema.properties) {
            this.addNestedPropertyKeys(
              known,
              dynamicPrefixes,
              spec.name,
              objectSchema,
              resolvedObjectFormat,
            );
          }
        }
      }
    }

    return { known, dynamicPrefixes };
  }

  private addNestedPropertyKeys(
    known: Set<string>,
    dynamicPrefixes: Set<string>,
    basePath: string,
    schema: SchemaObject,
    objectFormat: "brackets" | "dots",
  ): void {
    if (!schema.properties) return;

    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const resolved = isReference(propSchema)
        ? this.resolveSchema(propSchema)
        : propSchema;

      if (objectFormat === "brackets") {
        known.add(`${basePath}[${propName}]`);
      } else {
        known.add(`${basePath}.${propName}`);
      }

      const objectSchema = this.getObjectSchemaFromComposition(resolved);
      if (objectSchema) {
        const nestedBase = objectFormat === "brackets"
          ? `${basePath}[${propName}]`
          : `${basePath}.${propName}`;

        if (objectSchema.additionalProperties !== undefined) {
          if (objectFormat === "brackets") {
            dynamicPrefixes.add(`${nestedBase}[`);
          } else {
            dynamicPrefixes.add(`${nestedBase}.`);
          }
        }

        if (objectSchema.properties) {
          this.addNestedPropertyKeys(
            known,
            dynamicPrefixes,
            nestedBase,
            objectSchema,
            objectFormat,
          );
        }
      }
    }
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
   * Get the object schema variant from a schema that might use anyOf/oneOf/allOf.
   * Returns the first object variant found, or undefined if no object variant exists.
   */
  private getObjectSchemaFromComposition(
    schema: SchemaObject | undefined,
  ): SchemaObject | undefined {
    if (!schema) return undefined;

    // Direct object check
    if (
      schema.type === "object" ||
      schema.properties !== undefined ||
      schema.additionalProperties !== undefined ||
      schema.patternProperties !== undefined
    ) {
      return schema;
    }

    // Check anyOf/oneOf/allOf for object variant
    for (const sub of schema.anyOf ?? []) {
      const resolved = this.resolveSchema(sub);
      const variant = this.getObjectSchemaFromComposition(resolved);
      if (variant) return variant;
    }
    for (const sub of schema.oneOf ?? []) {
      const resolved = this.resolveSchema(sub);
      const variant = this.getObjectSchemaFromComposition(resolved);
      if (variant) return variant;
    }
    for (const sub of schema.allOf ?? []) {
      const resolved = this.resolveSchema(sub);
      const variant = this.getObjectSchemaFromComposition(resolved);
      if (variant) return variant;
    }

    return undefined;
  }

  /**
   * Check if schema is an object type
   * Checks for type: "object" or object-specific keywords (properties, additionalProperties, patternProperties)
   * Handles schema references and anyOf/oneOf/allOf by checking sub-schemas.
   */
  private isObjectSchema(
    schema: SchemaObject | ReferenceObject | undefined,
  ): boolean {
    const resolved = this.resolveSchema(schema);
    return this.getObjectSchemaFromComposition(resolved) !== undefined;
  }

  private validateQueryParams(
    params: URLSearchParams,
    paramSpecs: ParameterObject[],
    arrayFormat: QueryArrayFormat,
    objectFormat: QueryObjectFormat,
    consumedQueryParams?: string[],
  ): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const source = wrapURLSearchParams(params);

    for (const spec of paramSpecs) {
      const isArrayType = this.isArraySchema(spec.schema);
      const isObjectType = this.isObjectSchema(spec.schema);

      // Resolve 'auto' to concrete format for this parameter
      const resolvedArrayFormat = resolveArrayFormat(arrayFormat, spec);
      const resolvedObjectFormat = resolveObjectFormat(objectFormat, spec);

      const hasValue = hasParamValue(
        source,
        spec.name,
        isArrayType,
        isObjectType,
        resolvedArrayFormat,
        resolvedObjectFormat,
      );

      if (spec.required && !hasValue) {
        errors.push({
          path: `query.${spec.name}`,
          keyword: "required",
          message: "Required parameter missing",
          expected: formatExpected("required", { missingProperty: spec.name }),
          actual: undefined,
        });
      } else if (hasValue && spec.schema) {
        const schema = spec.schema;
        let parsedValue: unknown;

        if (isObjectType) {
          parsedValue = this.parseObjectParam(
            params,
            spec.name,
            schema,
            resolvedObjectFormat,
          );
        } else if (isArrayType) {
          // Parse array values
          const values = getArrayValues(
            source,
            spec.name,
            resolvedArrayFormat,
          );
          // Parse each element according to the items schema, not the array schema
          const resolved = this.resolveSchema(schema);
          const itemsSchema = resolved?.items;
          parsedValue = itemsSchema
            ? values.map((v) => this.parseParamValue(v, itemsSchema))
            : values;
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
        this.collectErrors(validation, errors);
      }
    }

    const { known: knownParams, dynamicPrefixes } = this.getKnownParamKeys(
      paramSpecs,
      arrayFormat,
      objectFormat,
    );
    for (const [key] of params) {
      // Check if key is known directly
      if (knownParams.has(key)) continue;

      // Check if key was consumed by route matching (e.g., /files?beta=true)
      if (consumedQueryParams?.includes(key)) continue;

      // Check if key matches any dynamic prefix (for additionalProperties/patternProperties)
      let isDynamic = false;
      for (const prefix of dynamicPrefixes) {
        // For bracket notation: prefix ends with "[", key ends with "]"
        // For dot notation: prefix ends with ".", key has more after the prefix
        if (
          prefix.endsWith("[") && key.startsWith(prefix) && key.endsWith("]")
        ) {
          isDynamic = true;
          break;
        }
        if (prefix.endsWith(".") && key.startsWith(prefix)) {
          isDynamic = true;
          break;
        }
      }
      if (isDynamic) continue;

      // Unknown parameter - extract base name
      let baseName = key;
      if (key.includes("[")) {
        baseName = key.split("[")[0] ?? key;
      } else if (key.includes(".")) {
        baseName = key.split(".")[0] ?? key;
      }

      const isNested = key.includes("[") || key.includes(".");
      errors.push({
        path: `query.${baseName}`,
        keyword: "additionalProperties",
        message: isNested ? `Unknown parameter: ${key}` : "Unknown parameter",
        expected: formatExpected("additionalProperties", {
          additionalProperty: key,
        }),
        actual: key,
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
          keyword: "required",
          message: "Required path parameter missing",
          expected: formatExpected("required", { missingProperty: spec.name }),
          actual: undefined,
        });
      } else if (value !== undefined && spec.schema) {
        const validation = this.validateValue(
          this.parseParamValue(value, spec.schema),
          spec.schema as Schema,
          `path.${spec.name}`,
        );
        this.collectErrors(validation, errors);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate headers using JSON Schema processor
   *
   * HTTP headers with array types are serialized as comma-separated values
   * (per OpenAPI "simple" style which is the default for headers).
   * Example: X-Flags: F1, F2 → ["F1", "F2"]
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
          keyword: "required",
          message: "Required header missing",
          expected: formatExpected("required", { missingProperty: spec.name }),
          actual: undefined,
        });
      } else if (value !== null && spec.schema) {
        // Parse the header value, handling arrays specially
        const parsedValue = this.parseHeaderValue(value, spec.schema);
        const validation = this.validateValue(
          parsedValue,
          spec.schema as Schema,
          `header.${spec.name}`,
        );
        this.collectErrors(validation, errors);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Parse a header value based on schema type.
   *
   * Headers use "simple" serialization style by default in OpenAPI:
   * - Arrays are comma-separated: "a,b,c" or "a, b, c"
   * - Single values are returned as-is (with type coercion)
   */
  private parseHeaderValue(
    value: string,
    schema: SchemaObject | ReferenceObject,
  ): unknown {
    const resolved = this.resolveSchema(schema);
    if (!resolved) return value;

    const types = Array.isArray(resolved.type)
      ? resolved.type
      : resolved.type
      ? [resolved.type]
      : ["string"];

    const type = types.find((t) => t !== "null") || "string";

    if (type === "array") {
      // Split comma-separated values and trim whitespace
      const items = value.split(",").map((v) => v.trim());

      // Get items schema for type coercion
      const itemsSchema = resolved.items;
      if (itemsSchema) {
        return items.map((v) => this.parseParamValue(v, itemsSchema));
      }
      return items;
    }

    // For non-array types, use standard param parsing
    return this.parseParamValue(value, schema);
  }

  /**
   * Validate cookies using JSON Schema processor
   */
  private validateCookies(
    headers: Headers,
    cookieSpecs: ParameterObject[],
  ): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // Parse cookies from Cookie header
    const cookieHeader = headers.get("cookie");
    const cookies: Record<string, string> = {};
    if (cookieHeader) {
      for (const part of cookieHeader.split(";")) {
        const [name, ...valueParts] = part.trim().split("=");
        if (name) {
          cookies[name.trim()] = valueParts.join("=").trim();
        }
      }
    }

    for (const spec of cookieSpecs) {
      const value = cookies[spec.name];

      if (spec.required && value === undefined) {
        errors.push({
          path: `cookie.${spec.name}`,
          keyword: "required",
          message: "Required cookie missing",
          expected: formatExpected("required", { missingProperty: spec.name }),
          actual: undefined,
        });
      } else if (value !== undefined && spec.schema) {
        const validation = this.validateValue(
          this.parseParamValue(value, spec.schema),
          spec.schema as Schema,
          `cookie.${spec.name}`,
        );
        this.collectErrors(validation, errors);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Read and validate request body with size limits
   *
   * Handles different content types appropriately:
   * - application/json: Parse as JSON
   * - multipart/form-data: Use native FormData API
   * - application/x-www-form-urlencoded: Parse as URL-encoded form
   * - Other: Treat as raw string
   */
  private async validateRequestBodyFromRequest(
    req: Request,
    requestBody: {
      required?: boolean;
      content?: Record<string, MediaTypeObject>;
    },
    formArrayFormat: QueryArrayFormat,
    formObjectFormat: QueryObjectFormat,
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

    const contentType = req.headers.get("content-type") || "application/json";
    const mediaType = getMediaType(contentType);

    // Check if the media type is supported by the spec
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

    try {
      let parsedBody: unknown;

      if (isFormMediaType(mediaType)) {
        // Use native FormData API for form data (handles both multipart and urlencoded)
        parsedBody = await this.parseFormBody(
          req.clone(),
          mediaType,
          mediaTypeSpec,
          formArrayFormat,
          formObjectFormat,
        );
      } else if (isJsonMediaType(mediaType)) {
        // Read as string and parse as JSON
        const body = await this.readBodyWithLimit(req.clone());
        parsedBody = JSON.parse(body);
      } else {
        // Other content types: read as raw string
        parsedBody = await this.readBodyWithLimit(req.clone());
      }

      // Validate the parsed body against the schema
      const validation = this.validateValue(
        parsedBody,
        mediaTypeSpec.schema as Schema,
        "body",
      );
      this.collectErrors(validation, errors);

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        requestBody: parsedBody,
      };
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        errors.push({
          path: "body",
          message: error.message,
        });
      } else if (error instanceof SyntaxError) {
        errors.push({
          path: "body",
          message: `Invalid ${mediaType} format: ${error.message}`,
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
   * Parse form data body (multipart/form-data or application/x-www-form-urlencoded)
   *
   * Uses native Deno FormData API for multipart, handles URL-encoded manually
   * for consistency with our nested property parsing.
   */
  private async parseFormBody(
    req: Request,
    mediaType: string,
    mediaTypeSpec: MediaTypeObject,
    formArrayFormat: QueryArrayFormat,
    formObjectFormat: QueryObjectFormat,
  ): Promise<unknown> {
    // Create a schema resolver function
    const resolveSchema = (
      schema: SchemaObject | ReferenceObject,
    ): SchemaObject | undefined => {
      if (isReference(schema)) {
        const resolved = this.registry.resolveRef(schema.$ref);
        return resolved?.raw as SchemaObject | undefined;
      }
      return schema;
    };

    // Resolve "auto" to concrete formats (OpenAPI form defaults: repeat arrays, flat objects)
    const concreteArrayFormat: ConcreteArrayFormat = formArrayFormat === "auto"
      ? "repeat"
      : formArrayFormat;
    const concreteObjectFormat: ConcreteObjectFormat =
      formObjectFormat === "auto" ? "flat" : formObjectFormat;

    if (mediaType === "multipart/form-data") {
      // Use native FormData API - it handles boundary parsing automatically
      const formData = await req.formData();
      const parsed = parseFormData(formData, {
        schema: mediaTypeSpec.schema,
        formArrayFormat: concreteArrayFormat,
        formObjectFormat: concreteObjectFormat,
        resolveSchema,
      });
      return parsed.data;
    } else {
      // application/x-www-form-urlencoded - read as string and parse
      const body = await this.readBodyWithLimit(req);
      const parsed = parseUrlEncoded(body, {
        schema: mediaTypeSpec.schema,
        formArrayFormat: concreteArrayFormat,
        formObjectFormat: concreteObjectFormat,
        resolveSchema,
      });
      return parsed.data;
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
   * Validate a value against a JSON Schema using the document-aware validator.
   * Preserves rich error context from SchemaValidationError.
   */
  private validateValue(
    value: unknown,
    schema: Schema,
    path: string,
  ): ValidationResult {
    // validateData will use path as the base instancePath
    const result = this.validator.validateData(schema, value, path);

    const errors: ValidationIssue[] = result.errors.map((err) => ({
      // Where
      path: err.instancePath || path,
      specPointer: err.schemaPath,

      // What
      keyword: err.keyword,
      message: err.message,

      // Expected vs Actual
      expected: formatExpected(err.keyword, err.params),
      actual: err.data !== undefined ? err.data : value,

      // Attribution (from SchemaValidationError if present)
      attribution: err.attribution
        ? {
          type: err.attribution.type === "sdk-error"
            ? "sdk-issue"
            : err.attribution.type === "spec-error"
            ? "spec-issue"
            : "ambiguous",
          confidence: err.attribution.confidence,
          reasoning: err.attribution.reasoning,
        }
        : undefined,

      // Fix
      suggestion: err.suggestion,
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
  ): void {
    if (!validation.valid) {
      errors.push(...validation.errors);
    }
  }

  /**
   * Extract all possible types from a schema, including from anyOf/oneOf/allOf variants.
   * Returns an array of type strings.
   */
  private getSchemaTypes(schema?: SchemaObject | ReferenceObject): string[] {
    const resolved = this.resolveSchema(schema);
    if (!resolved) return [];

    // Direct type declaration
    if (resolved.type) {
      return Array.isArray(resolved.type) ? resolved.type : [resolved.type];
    }

    // Check anyOf/oneOf/allOf for type variants
    const types = new Set<string>();
    for (const sub of resolved.anyOf ?? []) {
      for (const t of this.getSchemaTypes(sub)) {
        types.add(t);
      }
    }
    for (const sub of resolved.oneOf ?? []) {
      for (const t of this.getSchemaTypes(sub)) {
        types.add(t);
      }
    }
    for (const sub of resolved.allOf ?? []) {
      for (const t of this.getSchemaTypes(sub)) {
        types.add(t);
      }
    }

    return [...types];
  }

  /**
   * Check if a schema represents an array type
   * Handles schema references by resolving them first.
   */
  private isArraySchema(schema?: SchemaObject | ReferenceObject): boolean {
    const types = this.getSchemaTypes(schema);
    return types.includes("array");
  }

  /**
   * Parse parameter value based on schema type
   * Handles schema references by resolving them first.
   */
  private parseParamValue(
    value: string,
    schema: SchemaObject | ReferenceObject,
    issues?: ValidationIssue[],
    paramPath?: string,
  ): unknown {
    const schemaTypes = this.getSchemaTypes(schema);

    // Report diagnostic if we can't determine types from schema
    if (schemaTypes.length === 0 && issues && paramPath) {
      issues.push({
        path: paramPath,
        message:
          "Could not determine parameter type from schema, treating as string",
      });
    }

    const types = schemaTypes.length > 0 ? schemaTypes : ["string"];
    const type = types.find((t) => t !== "null") || "string";

    switch (type) {
      case "integer":
        return parseInt(value, 10);
      case "number":
        return parseFloat(value);
      case "boolean":
        if (value === "true") return true;
        if (value === "false") return false;
        // Invalid boolean - return as string, let schema validation catch it
        return value;
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
