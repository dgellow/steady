/**
 * OpenAPIDocument - Document-centric OpenAPI processing
 *
 * The main entry point for the document-centric architecture.
 * Wraps an OpenAPI spec and provides access to all schemas with
 * proper cross-reference resolution and comprehensive diagnostics.
 *
 * Usage:
 *   const doc = new OpenAPIDocument(spec);
 *   const diagnostics = doc.getDiagnostics();
 *   const generator = doc.getGenerator();
 *   const response = generator.generate("#/components/schemas/User");
 */

import {
  RegistryResponseGenerator,
  type RegistrySchema,
  RegistryValidator,
  SchemaRegistry,
} from "./schema-registry.ts";
import { RefGraph } from "./ref-graph.ts";
import type { GenerateOptions, ValidationResult } from "./types.ts";
import {
  DocumentAnalyzer,
  type DocumentAnalyzerConfig,
} from "./document-analyzer.ts";
import type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticSummary,
} from "./diagnostics/types.ts";
import { filterBySeverity, summarizeDiagnostics } from "./diagnostics/types.ts";

export interface OpenAPIDocumentOptions {
  /** Base URI for the document */
  baseUri?: string;
  /** Configuration for document analysis */
  analyzerConfig?: DocumentAnalyzerConfig;
}

export class OpenAPIDocument {
  /** The full OpenAPI spec */
  readonly spec: unknown;
  /** Schema registry with document context */
  readonly schemas: SchemaRegistry;
  /** Reference graph for the entire document */
  readonly refGraph: RefGraph;

  /** Cached diagnostics (lazy evaluated) */
  private _diagnostics?: Diagnostic[];
  /** Analyzer configuration */
  private analyzerConfig?: DocumentAnalyzerConfig;

  constructor(spec: unknown, options: OpenAPIDocumentOptions = {}) {
    this.spec = spec;
    this.schemas = new SchemaRegistry(spec, options);
    this.refGraph = this.schemas.refGraph;
    this.analyzerConfig = options.analyzerConfig;
  }

  /**
   * Get all diagnostics for this document.
   * Computed lazily on first access and cached.
   */
  getDiagnostics(): Diagnostic[] {
    if (!this._diagnostics) {
      const analyzer = new DocumentAnalyzer(this.analyzerConfig);
      this._diagnostics = analyzer.analyze(this.schemas);
    }
    return this._diagnostics;
  }

  /**
   * Get diagnostics filtered by minimum severity
   */
  getDiagnosticsFiltered(minSeverity: DiagnosticSeverity): Diagnostic[] {
    return filterBySeverity(this.getDiagnostics(), minSeverity);
  }

  /**
   * Get diagnostic summary
   */
  getDiagnosticSummary(): DiagnosticSummary {
    return summarizeDiagnostics(this.getDiagnostics());
  }

  /**
   * Get only errors
   */
  getErrors(): Diagnostic[] {
    return this.getDiagnostics().filter((d) => d.severity === "error");
  }

  /**
   * Get only warnings
   */
  getWarnings(): Diagnostic[] {
    return this.getDiagnostics().filter((d) => d.severity === "warning");
  }

  /**
   * Check if document has any errors
   */
  hasErrors(): boolean {
    return this.getErrors().length > 0;
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
  getInfo():
    | { title?: string; version?: string; description?: string }
    | undefined {
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
    const pointer = `#/paths/${
      this.escapePointer(path)
    }/${method.toLowerCase()}`;
    return this.schemas.resolve(pointer);
  }

  /**
   * Get the response schema for an operation
   */
  getResponseSchema(
    path: string,
    method: string,
    statusCode: string,
  ): RegistrySchema | undefined {
    const responsePointer = `#/paths/${
      this.escapePointer(path)
    }/${method.toLowerCase()}/responses/${statusCode}/content/application~1json/schema`;
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
    const examplePointer = `#/paths/${
      this.escapePointer(path)
    }/${method.toLowerCase()}/responses/${statusCode}/content/application~1json/example`;
    const example = this.schemas.resolve(examplePointer);
    if (example !== undefined) {
      return example;
    }

    // Then try examples array
    const examplesPointer = `#/paths/${
      this.escapePointer(path)
    }/${method.toLowerCase()}/responses/${statusCode}/content/application~1json/examples`;
    const examples = this.schemas.resolve(examplesPointer);
    if (typeof examples === "object" && examples !== null) {
      const firstExample = Object.values(examples)[0];
      if (
        typeof firstExample === "object" && firstExample !== null &&
        "value" in firstExample
      ) {
        return (firstExample as { value: unknown }).value;
      }
    }

    // Fall back to schema generation
    const schemaPointer = `#/paths/${
      this.escapePointer(path)
    }/${method.toLowerCase()}/responses/${statusCode}/content/application~1json/schema`;
    const schema = this.schemas.get(schemaPointer);

    if (schema) {
      // If schema has $ref, follow it
      if (
        typeof schema.raw === "object" && schema.raw !== null &&
        "$ref" in schema.raw
      ) {
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
