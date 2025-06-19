import {
  type ExtractedSchema,
  type ExtractionOptions,
  isReferenceObject,
  isSchemaObject,
  type OpenAPISpec,
  type SchemaContext,
  type SchemaObject,
} from "./types.ts";

export class SchemaAnalyzer {
  private extractedSchemas: ExtractedSchema[] = [];
  private schemaFingerprints = new Map<string, string>();
  private options: Required<ExtractionOptions>;

  constructor(options: ExtractionOptions = {}) {
    this.options = {
      minProperties: options.minProperties ?? 2,
      minComplexity: options.minComplexity ?? 3,
      extractArrayItems: options.extractArrayItems ?? true,
      extractNestedObjects: options.extractNestedObjects ?? true,
      verbose: options.verbose ?? false,
      dryRun: options.dryRun ?? false,
    };
  }

  analyze(spec: OpenAPISpec): SchemaContext[] {
    const contexts: SchemaContext[] = [];

    // Analyze paths
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem) continue;

      // Extract resource name from path
      const resourceName = this.extractResourceName(path);

      // Analyze each method
      const methods = [
        "get",
        "put",
        "post",
        "delete",
        "options",
        "head",
        "patch",
        "trace",
      ] as const;
      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;

        const baseContext = {
          path,
          method,
          resourceName,
          operationId: operation.operationId,
        };

        // Analyze request body
        if (operation.requestBody && isSchemaObject(operation.requestBody)) {
          this.analyzeRequestBody(operation.requestBody, baseContext, contexts);
        }

        // Analyze responses
        for (
          const [statusCode, response] of Object.entries(operation.responses)
        ) {
          if (isSchemaObject(response) && response.content) {
            this.analyzeResponse(
              response,
              { ...baseContext, statusCode },
              contexts,
            );
          }
        }

        // Analyze parameters
        if (operation.parameters) {
          for (let i = 0; i < operation.parameters.length; i++) {
            const param = operation.parameters[i];
            if (
              isSchemaObject(param) && param.schema &&
              isSchemaObject(param.schema)
            ) {
              this.analyzeSchema(
                param.schema,
                {
                  ...baseContext,
                  location: `parameters[${i}].schema`,
                },
                contexts,
              );
            }
          }
        }
      }
    }

    return contexts;
  }

  private analyzeRequestBody(
    requestBody: any,
    baseContext: Omit<SchemaContext, "location" | "schema">,
    contexts: SchemaContext[],
  ): void {
    if (!requestBody.content) return;

    for (
      const [contentType, mediaType] of Object.entries(requestBody.content)
    ) {
      if (!mediaType || typeof mediaType !== "object") continue;
      const mt = mediaType as any;

      if (mt.schema && isSchemaObject(mt.schema)) {
        this.analyzeSchema(
          mt.schema,
          {
            ...baseContext,
            location: `requestBody.content["${contentType}"].schema`,
          },
          contexts,
        );
      }
    }
  }

  private analyzeResponse(
    response: any,
    baseContext: Omit<SchemaContext, "location" | "schema">,
    contexts: SchemaContext[],
  ): void {
    if (!response.content) return;

    for (const [contentType, mediaType] of Object.entries(response.content)) {
      if (!mediaType || typeof mediaType !== "object") continue;
      const mt = mediaType as any;

      if (mt.schema && isSchemaObject(mt.schema)) {
        this.analyzeSchema(
          mt.schema,
          {
            ...baseContext,
            location:
              `responses["${baseContext.statusCode}"].content["${contentType}"].schema`,
          },
          contexts,
        );
      }
    }
  }

  private analyzeSchema(
    schema: SchemaObject,
    context: Omit<SchemaContext, "schema">,
    contexts: SchemaContext[],
  ): void {
    // Check if schema meets extraction criteria
    if (this.shouldExtract(schema)) {
      contexts.push({
        ...context,
        schema,
      });
    }

    // Recursively analyze nested schemas
    if (this.options.extractNestedObjects) {
      // Analyze object properties
      if (schema.type === "object" && schema.properties) {
        for (
          const [propName, propSchema] of Object.entries(schema.properties)
        ) {
          if (isSchemaObject(propSchema)) {
            this.analyzeSchema(
              propSchema,
              {
                ...context,
                location: `${context.location}.properties.${propName}`,
                parentContext: context.location,
              },
              contexts,
            );
          }
        }
      }

      // Analyze array items
      if (
        this.options.extractArrayItems && schema.type === "array" &&
        schema.items
      ) {
        if (isSchemaObject(schema.items)) {
          this.analyzeSchema(
            schema.items,
            {
              ...context,
              location: `${context.location}.items`,
              parentContext: context.location,
            },
            contexts,
          );
        }
      }

      // Analyze allOf, oneOf, anyOf
      const combiners = ["allOf", "oneOf", "anyOf"] as const;
      for (const combiner of combiners) {
        const schemas = schema[combiner];
        if (Array.isArray(schemas)) {
          schemas.forEach((s, index) => {
            if (isSchemaObject(s)) {
              this.analyzeSchema(
                s,
                {
                  ...context,
                  location: `${context.location}.${combiner}[${index}]`,
                  parentContext: context.location,
                },
                contexts,
              );
            }
          });
        }
      }

      // Analyze additionalProperties
      if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object" &&
        isSchemaObject(schema.additionalProperties)
      ) {
        this.analyzeSchema(
          schema.additionalProperties,
          {
            ...context,
            location: `${context.location}.additionalProperties`,
            parentContext: context.location,
          },
          contexts,
        );
      }
    }
  }

  private shouldExtract(schema: SchemaObject): boolean {
    // Don't extract primitive types
    if (
      schema.type &&
      ["string", "number", "integer", "boolean", "null"].includes(
        schema.type,
      ) && !schema.properties
    ) {
      return false;
    }

    // Calculate complexity score
    const complexity = this.calculateComplexity(schema);
    if (complexity < this.options.minComplexity) {
      return false;
    }

    // Check property count for objects
    if (schema.type === "object" && schema.properties) {
      const propCount = Object.keys(schema.properties).length;
      if (propCount < this.options.minProperties) {
        return false;
      }
    }

    return true;
  }

  private calculateComplexity(schema: SchemaObject): number {
    let score = 0;

    // Base type complexity
    if (schema.type === "object") score += 2;
    if (schema.type === "array") score += 1;

    // Properties
    if (schema.properties) {
      score += Object.keys(schema.properties).length;
    }

    // Required fields
    if (schema.required) {
      score += schema.required.length * 0.5;
    }

    // Nested structures
    if (schema.allOf || schema.oneOf || schema.anyOf) {
      score += 2;
    }

    // Constraints
    if (schema.pattern || schema.format || schema.enum) {
      score += 1;
    }

    return score;
  }

  private extractResourceName(path: string): string {
    // Extract resource name from path
    // /api/v2/actions/connections/{id} -> actions/connections
    const parts = path.split("/").filter((p) =>
      p && !p.startsWith("{") && !p.match(/^v\d+$/)
    );

    // Skip common prefixes
    const skipPrefixes = ["api", "rest", "v1", "v2", "v3"];
    const meaningful = parts.filter((p) =>
      !skipPrefixes.includes(p.toLowerCase())
    );

    return meaningful.join("/") || "root";
  }

  generateFingerprint(schema: SchemaObject): string {
    // Generate a unique fingerprint for schema deduplication
    const key = JSON.stringify({
      type: schema.type,
      properties: schema.properties
        ? Object.keys(schema.properties).sort()
        : undefined,
      required: schema.required?.sort(),
      items: schema.items
        ? this.generateFingerprint(schema.items as SchemaObject)
        : undefined,
    });
    return key;
  }
}
