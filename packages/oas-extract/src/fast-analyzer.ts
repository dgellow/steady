import type {
  OpenAPISpec,
  Operation,
  PathItem,
  SchemaContext,
  SchemaObject,
} from "./types.ts";

interface PathWalker {
  path: string[];
  value: unknown;
}

export class FastAnalyzer {
  private contexts: SchemaContext[] = [];
  private readonly minComplexity: number;
  private readonly minProperties: number;

  constructor(minComplexity = 3, minProperties = 2) {
    this.minComplexity = minComplexity;
    this.minProperties = minProperties;
  }

  analyze(spec: OpenAPISpec): SchemaContext[] {
    this.contexts = [];

    // Fast path iteration - avoid Object.entries overhead
    const paths = spec.paths;
    for (const path in paths) {
      if (!Object.prototype.hasOwnProperty.call(paths, path)) continue;
      const pathItem = paths[path];
      if (pathItem) {
        this.analyzePath(path, pathItem);
      }
    }

    return this.contexts;
  }

  private analyzePath(path: string, pathItem: PathItem): void {
    const resourceName = this.fastExtractResource(path);

    // Direct method access - faster than array iteration
    if (pathItem.get) {
      this.analyzeOperation(path, "get", pathItem.get, resourceName);
    }
    if (pathItem.post) {
      this.analyzeOperation(path, "post", pathItem.post, resourceName);
    }
    if (pathItem.put) {
      this.analyzeOperation(path, "put", pathItem.put, resourceName);
    }
    if (pathItem.patch) {
      this.analyzeOperation(path, "patch", pathItem.patch, resourceName);
    }
    if (pathItem.delete) {
      this.analyzeOperation(path, "delete", pathItem.delete, resourceName);
    }
    if (pathItem.options) {
      this.analyzeOperation(path, "options", pathItem.options, resourceName);
    }
    if (pathItem.head) {
      this.analyzeOperation(path, "head", pathItem.head, resourceName);
    }
    if (pathItem.trace) {
      this.analyzeOperation(path, "trace", pathItem.trace, resourceName);
    }
  }

  private analyzeOperation(
    path: string,
    method: string,
    operation: Operation,
    resourceName: string,
  ): void {
    const baseContext = {
      path,
      method,
      resourceName,
      operationId: operation.operationId,
    };

    // Fast request body check
    if (
      operation.requestBody && !this.isReferenceObject(operation.requestBody) &&
      operation.requestBody.content
    ) {
      for (const contentType in operation.requestBody.content) {
        const schema = operation.requestBody.content[contentType]?.schema;
        if (schema && !this.isReferenceObject(schema)) {
          this.processSchema(schema, {
            ...baseContext,
            location: `requestBody.content["${contentType}"].schema`,
          });
        }
      }
    }

    // Fast responses check
    if (operation.responses) {
      for (const statusCode in operation.responses) {
        const response = operation.responses[statusCode];
        if (response && !this.isReferenceObject(response) && response.content) {
          for (const contentType in response.content) {
            const schema = response.content[contentType]?.schema;
            if (schema && !this.isReferenceObject(schema)) {
              this.processSchema(schema, {
                ...baseContext,
                statusCode,
                location:
                  `responses["${statusCode}"].content["${contentType}"].schema`,
              });
            }
          }
        }
      }
    }
  }

  private processSchema(
    schema: unknown,
    context: Omit<SchemaContext, "schema">,
  ): void {
    // Use a non-recursive stack-based approach for better performance
    const stack: PathWalker[] = [{
      path: [],
      value: schema,
    }];

    while (stack.length > 0) {
      const { path, value } = stack.pop()!;

      // Skip non-objects and references
      if (
        !value || typeof value !== "object" || this.isReferenceObject(value)
      ) continue;

      // Build location
      const location = path.length > 0
        ? `${context.location}.${path.join(".")}`
        : context.location;

      // Check if this schema should be extracted
      if (this.shouldExtract(value)) {
        this.contexts.push({
          ...context,
          location,
          schema: value,
          parentContext: path.length > 0 ? context.location : undefined,
        });
      }

      // Add nested schemas to stack (reverse order for depth-first)
      if (this.isSchemaObject(value)) {
        if (value.type === "object" && value.properties) {
          for (const propName in value.properties) {
            if (
              Object.prototype.hasOwnProperty.call(value.properties, propName)
            ) {
              stack.push({
                path: [...path, "properties", propName],
                value: value.properties[propName],
              });
            }
          }
        }

        if (value.type === "array" && value.items) {
          stack.push({
            path: [...path, "items"],
            value: value.items,
          });
        }
      }

      // Handle allOf, oneOf, anyOf
      if (this.isSchemaObject(value)) {
        const combiners = ["allOf", "oneOf", "anyOf"] as const;
        for (const combiner of combiners) {
          const combinerValue = value[combiner];
          if (Array.isArray(combinerValue)) {
            for (let i = 0; i < combinerValue.length; i++) {
              stack.push({
                path: [...path, combiner, i.toString()],
                value: combinerValue[i],
              });
            }
          }
        }
      }
    }
  }

  private shouldExtract(schema: SchemaObject): boolean {
    // Quick rejection for primitives
    if (schema.type && schema.type !== "object" && schema.type !== "array") {
      return false;
    }

    // Fast complexity calculation
    let complexity = 0;

    if (schema.type === "object") {
      complexity += 2;
      if (schema.properties) {
        const propCount = Object.keys(schema.properties).length;
        if (propCount < this.minProperties) return false;
        complexity += propCount;
      }
    } else if (schema.type === "array") {
      complexity += 1;
    }

    if (schema.required) complexity += schema.required.length * 0.5;
    if (schema.allOf || schema.oneOf || schema.anyOf) complexity += 2;
    if (schema.pattern || schema.format || schema.enum) complexity += 1;

    return complexity >= this.minComplexity;
  }

  private fastExtractResource(path: string): string {
    // Fast resource extraction without regex
    let start = 0;
    const parts: string[] = [];

    for (let i = 0; i <= path.length; i++) {
      if (i === path.length || path[i] === "/") {
        if (i > start) {
          const part = path.substring(start, i);
          // Skip version patterns and parameters
          if (!part.startsWith("{") && !part.match(/^v\d+$/)) {
            // Skip common prefixes
            if (part !== "api" && part !== "rest") {
              parts.push(part);
            }
          }
        }
        start = i + 1;
      }
    }

    return parts.join("/") || "root";
  }

  private isSchemaObject(value: unknown): value is SchemaObject {
    return typeof value === "object" && value !== null &&
      !this.isReferenceObject(value);
  }

  private isReferenceObject(value: unknown): value is { $ref: string } {
    return typeof value === "object" && value !== null && "$ref" in value;
  }
}
