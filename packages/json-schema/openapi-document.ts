/**
 * OpenAPIDocument - Document-centric OpenAPI processing
 *
 * The main entry point for the document-centric architecture.
 * Wraps an OpenAPI spec and provides access to all schemas with
 * proper cross-reference resolution.
 *
 * Usage:
 *   const doc = new OpenAPIDocument(spec);
 *   const generator = doc.getGenerator("#/components/schemas/User");
 *   const response = generator.generate();
 */

import {
  RegistryResponseGenerator,
  RegistryValidator,
  SchemaRegistry,
  type RegistrySchema,
} from "./schema-registry.ts";
import { RefGraph } from "./ref-graph.ts";
import type { GenerateOptions, ValidationResult } from "./types.ts";

export interface OpenAPIDocumentOptions {
  /** Base URI for the document */
  baseUri?: string;
}

export class OpenAPIDocument {
  /** The full OpenAPI spec */
  readonly spec: unknown;
  /** Schema registry with document context */
  readonly schemas: SchemaRegistry;
  /** Reference graph for the entire document */
  readonly refGraph: RefGraph;

  constructor(spec: unknown, options: OpenAPIDocumentOptions = {}) {
    this.spec = spec;
    this.schemas = new SchemaRegistry(spec, options);
    this.refGraph = this.schemas.refGraph;
  }

  /**
   * Get a response generator with document context
   */
  getGenerator(options?: GenerateOptions): RegistryResponseGenerator {
    return new RegistryResponseGenerator(this.schemas, options);
  }

  /**
   * Generate a response for a schema at the given pointer
   */
  generateResponse(pointer: string, options?: GenerateOptions): unknown {
    const generator = new RegistryResponseGenerator(this.schemas, options);
    return generator.generate(pointer);
  }

  /**
   * Get a validator for validating data against schemas
   */
  getValidator(): RegistryValidator {
    return new RegistryValidator(this.schemas);
  }

  /**
   * Validate data against a schema at the given pointer
   */
  validate(pointer: string, data: unknown): ValidationResult {
    const validator = new RegistryValidator(this.schemas);
    return validator.validate(pointer, data);
  }

  /**
   * Get a schema by pointer
   */
  getSchema(pointer: string): RegistrySchema | undefined {
    return this.schemas.get(pointer);
  }

  /**
   * Resolve a $ref
   */
  resolveRef(ref: string): RegistrySchema | undefined {
    return this.schemas.resolveRef(ref);
  }

  /**
   * Get all component schemas (convenience method)
   */
  getComponentSchemas(): Map<string, RegistrySchema> {
    return this.schemas.getComponentSchemas();
  }

  /**
   * Check if a reference is cyclic
   */
  isCyclic(ref: string): boolean {
    return this.refGraph.isCyclic(ref);
  }

  /**
   * Get document statistics
   */
  getStats(): {
    totalRefs: number;
    totalPointers: number;
    cachedSchemas: number;
    cyclicRefs: number;
    cycles: number;
  } {
    return this.schemas.getStats();
  }

  /**
   * Get the OpenAPI info section
   */
  getInfo(): { title?: string; version?: string; description?: string } | undefined {
    const info = this.schemas.resolve("#/info");
    if (typeof info === "object" && info !== null) {
      return info as { title?: string; version?: string; description?: string };
    }
    return undefined;
  }

  /**
   * Get all paths in the spec
   */
  getPaths(): Record<string, unknown> | undefined {
    const paths = this.schemas.resolve("#/paths");
    if (typeof paths === "object" && paths !== null) {
      return paths as Record<string, unknown>;
    }
    return undefined;
  }

  /**
   * Get a specific operation by path and method
   */
  getOperation(path: string, method: string): unknown {
    const pointer = `#/paths/${this.escapePointer(path)}/${method.toLowerCase()}`;
    return this.schemas.resolve(pointer);
  }

  /**
   * Get the response schema for an operation
   */
  getResponseSchema(path: string, method: string, statusCode: string): RegistrySchema | undefined {
    const responsePointer = `#/paths/${this.escapePointer(path)}/${method.toLowerCase()}/responses/${statusCode}/content/application~1json/schema`;
    return this.schemas.get(responsePointer);
  }

  /**
   * Generate a response for an operation
   */
  generateOperationResponse(
    path: string,
    method: string,
    statusCode: string,
    options?: GenerateOptions,
  ): unknown {
    // First try to get example from operation response
    const examplePointer = `#/paths/${this.escapePointer(path)}/${method.toLowerCase()}/responses/${statusCode}/content/application~1json/example`;
    const example = this.schemas.resolve(examplePointer);
    if (example !== undefined) {
      return example;
    }

    // Then try examples array
    const examplesPointer = `#/paths/${this.escapePointer(path)}/${method.toLowerCase()}/responses/${statusCode}/content/application~1json/examples`;
    const examples = this.schemas.resolve(examplesPointer);
    if (typeof examples === "object" && examples !== null) {
      const firstExample = Object.values(examples)[0];
      if (typeof firstExample === "object" && firstExample !== null && "value" in firstExample) {
        return (firstExample as { value: unknown }).value;
      }
    }

    // Fall back to schema generation
    const schemaPointer = `#/paths/${this.escapePointer(path)}/${method.toLowerCase()}/responses/${statusCode}/content/application~1json/schema`;
    const schema = this.schemas.get(schemaPointer);

    if (schema) {
      // If schema has $ref, follow it
      if (typeof schema.raw === "object" && schema.raw !== null && "$ref" in schema.raw) {
        const ref = (schema.raw as { $ref: string }).$ref;
        const generator = new RegistryResponseGenerator(this.schemas, options);
        return generator.generate(ref);
      }

      const generator = new RegistryResponseGenerator(this.schemas, options);
      return generator.generateFromSchema(schema.raw, schemaPointer, 0);
    }

    return null;
  }

  /**
   * Escape a path for use in JSON Pointer
   */
  private escapePointer(path: string): string {
    return path.replace(/~/g, "~0").replace(/\//g, "~1");
  }
}
