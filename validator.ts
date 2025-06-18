import {
  OperationObject,
  ParameterObject,
  SchemaObject,
  ValidationResult,
  ValidationError,
  OpenAPISpec,
} from "./types.ts";

export class RequestValidator {
  constructor(
    _spec: OpenAPISpec,
    private mode: "strict" | "relaxed",
  ) {}

  validateRequest(
    req: Request,
    operation: OperationObject,
    _path: string,
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const url = new URL(req.url);

    // Validate query parameters
    if (operation.parameters) {
      const queryParams = operation.parameters.filter(p => p.in === "query");
      const queryValidation = this.validateQueryParams(
        url.searchParams,
        queryParams,
      );
      errors.push(...queryValidation.errors);
      warnings.push(...queryValidation.warnings);
    }

    // Validate path parameters
    if (operation.parameters) {
      // const pathParams = operation.parameters.filter(p => p.in === "path");
      // For MVP, we're doing exact matching so path params are always valid
      // In a full implementation, we'd extract and validate path params here
    }

    // Validate headers
    if (operation.parameters) {
      const headerParams = operation.parameters.filter(p => p.in === "header");
      const headerValidation = this.validateHeaders(req.headers, headerParams);
      errors.push(...headerValidation.errors);
      warnings.push(...headerValidation.warnings);
    }

    // Validate request body
    if (operation.requestBody && req.method !== "GET" && req.method !== "HEAD") {
      // For MVP, skip body validation
      // In full implementation, we'd parse and validate the body here
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateQueryParams(
    params: URLSearchParams,
    paramSpecs: ParameterObject[],
  ): ValidationResult {
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
        // Validate parameter type
        const validation = this.validateValue(
          value,
          spec.schema,
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
    const knownParams = new Set(paramSpecs.map(p => p.name));
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

  private validateHeaders(
    headers: Headers,
    headerSpecs: ParameterObject[],
  ): ValidationResult {
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
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private validateValue(
    value: string,
    schema: SchemaObject,
    path: string,
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Type validation
    switch (schema.type) {
      case "integer":
        if (!/^-?\d+$/.test(value)) {
          errors.push({
            path,
            message: "Expected integer",
            expected: "integer",
            actual: value,
          });
        } else {
          const num = parseInt(value);
          if (schema.minimum !== undefined && num < schema.minimum) {
            errors.push({
              path,
              message: `Value must be >= ${schema.minimum}`,
              expected: `>= ${schema.minimum}`,
              actual: num,
            });
          }
          if (schema.maximum !== undefined && num > schema.maximum) {
            errors.push({
              path,
              message: `Value must be <= ${schema.maximum}`,
              expected: `<= ${schema.maximum}`,
              actual: num,
            });
          }
        }
        break;

      case "number":
        if (!/^-?\d*\.?\d+$/.test(value)) {
          errors.push({
            path,
            message: "Expected number",
            expected: "number",
            actual: value,
          });
        }
        break;

      case "boolean":
        if (value !== "true" && value !== "false") {
          errors.push({
            path,
            message: "Expected boolean",
            expected: "true or false",
            actual: value,
          });
        }
        break;

      case "string":
        // String is always valid, but check format
        if (schema.format) {
          const formatValid = this.validateFormat(value, schema.format);
          if (!formatValid) {
            errors.push({
              path,
              message: `Invalid ${schema.format} format`,
              expected: schema.format,
              actual: value,
            });
          }
        }
        break;
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private validateFormat(value: string, format: string): boolean {
    switch (format) {
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      case "uri":
      case "url":
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      case "date":
        return /^\d{4}-\d{2}-\d{2}$/.test(value);
      case "date-time":
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
      case "uuid":
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
      default:
        // Unknown format, assume valid
        return true;
    }
  }
}