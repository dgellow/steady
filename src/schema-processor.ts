/**
 * Server Schema Processor - Manages JSON Schema processing for OpenAPI specs
 *
 * Responsibilities:
 * - Process all schemas in an OpenAPI spec once at startup
 * - Cache ProcessedSchema objects for reuse
 * - Provide response generation capabilities
 * - Unified schema handling (no duplicate reference resolution)
 */

import {
  JsonSchemaProcessor,
  type ProcessedSchema,
  ResponseGenerator,
  type Schema,
} from "@steady/json-schema";
import type {
  ExampleObject,
  MediaTypeObject,
  OpenAPISpec,
  SchemaObject,
} from "@steady/parser";
import { isReference } from "./types.ts";

interface SchemaProcessorOptions {
  /**
   * Maximum depth for response generation
   */
  maxDepth?: number;

  /**
   * Whether to use examples from schemas
   */
  useExamples?: boolean;
}

export class ServerSchemaProcessor {
  private schemaCache: Map<string, ProcessedSchema> = new Map();
  private processor: JsonSchemaProcessor;
  private options: SchemaProcessorOptions;

  constructor(
    private spec: OpenAPISpec,
    options: SchemaProcessorOptions = {},
  ) {
    this.processor = new JsonSchemaProcessor();
    this.options = {
      maxDepth: 10,
      useExamples: true,
      ...options,
    };
  }

  /**
   * Process all component schemas in the spec
   * Call this once at server startup for performance
   */
  async processComponentSchemas(): Promise<void> {
    if (!this.spec.components?.schemas) {
      return;
    }

    for (const [name, schema] of Object.entries(this.spec.components.schemas)) {
      const key = `#/components/schemas/${name}`;
      await this.processAndCache(schema, key);
    }
  }

  /**
   * Process a schema and cache the result
   */
  private async processAndCache(
    schema: SchemaObject,
    key: string,
  ): Promise<ProcessedSchema | null> {
    const result = await this.processor.process(schema, {
      baseUri: key,
    });

    if (result.valid && result.schema) {
      this.schemaCache.set(key, result.schema);
      return result.schema;
    }

    // Log warning for invalid schemas
    if (!result.valid) {
      console.warn(
        `Warning: Schema at ${key} failed validation:`,
        result.errors,
      );
    }

    return null;
  }

  /**
   * Generate response data from a MediaTypeObject
   *
   * Priority order:
   * 1. Explicit example from MediaTypeObject
   * 2. Example from examples array
   * 3. Generated from schema using ResponseGenerator
   */
  async generateFromMediaType(
    mediaType: MediaTypeObject,
  ): Promise<unknown> {
    // Priority 1: Use explicit example
    if (mediaType.example !== undefined) {
      return mediaType.example;
    }

    // Priority 2: Use first example from examples
    if (mediaType.examples && Object.keys(mediaType.examples).length > 0) {
      const firstExampleOrRef = Object.values(mediaType.examples)[0];
      // Skip $ref examples - we don't resolve them here
      if (firstExampleOrRef && !isReference(firstExampleOrRef)) {
        const firstExample = firstExampleOrRef as ExampleObject;
        if (firstExample.value !== undefined) {
          return firstExample.value;
        }
      }
    }

    // Priority 3: Generate from schema
    if (mediaType.schema) {
      return await this.generateFromSchema(mediaType.schema);
    }

    // No schema or example available
    return null;
  }

  /**
   * Generate data from a schema
   */
  async generateFromSchema(schema: SchemaObject): Promise<unknown> {
    // If schema has explicit example, use it
    if (schema.example !== undefined && this.options.useExamples) {
      return schema.example;
    }

    // Check if this is a reference
    let processedSchema: ProcessedSchema | null = null;

    if (schema.$ref) {
      // Try to get from cache
      processedSchema = this.schemaCache.get(schema.$ref) || null;

      // If not cached, process it now
      if (!processedSchema) {
        processedSchema = await this.processAndCache(
          schema,
          schema.$ref,
        );
      }
    } else {
      // Inline schema - process it
      const result = await this.processor.process(schema as Schema, {
        baseUri: "steady://inline",
      });

      if (result.valid && result.schema) {
        processedSchema = result.schema;
      }
    }

    // If we couldn't process the schema, return null
    if (!processedSchema) {
      return null;
    }

    // Generate response using ResponseGenerator
    const generator = new ResponseGenerator(processedSchema, {
      maxDepth: this.options.maxDepth,
      useExamples: this.options.useExamples,
    });

    return generator.generate();
  }

  /**
   * Get a processed schema from cache
   */
  getProcessedSchema(ref: string): ProcessedSchema | null {
    return this.schemaCache.get(ref) || null;
  }

  /**
   * Get cache statistics (for debugging/monitoring)
   */
  getCacheStats(): {
    size: number;
    keys: string[];
  } {
    return {
      size: this.schemaCache.size,
      keys: Array.from(this.schemaCache.keys()),
    };
  }
}
