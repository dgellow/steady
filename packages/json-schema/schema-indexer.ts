/**
 * Schema Indexer - Builds efficient indexes for runtime operations
 *
 * Pre-computes various indexes to enable O(1) lookups during validation
 * and response generation. This is critical for performance with large schemas.
 */

import type {
  ComplexityMetrics,
  ProcessedSchema,
  Schema,
  SchemaMetadata,
  SchemaSource,
} from "./types.ts";

export class SchemaIndexer {
  /**
   * Build comprehensive indexes from a schema
   */
  index(
    schema: Schema | boolean,
    refs: ProcessedSchema["refs"],
    source?: SchemaSource,
  ): ProcessedSchema {
    const index: ProcessedSchema["index"] = {
      byPointer: new Map(),
      byId: new Map(),
      byAnchor: new Map(),
      definitions: new Map(),
      byType: new Map(),
      byFormat: new Map(),
      byKeyword: new Map(),
    };

    const formats = new Set<string>();
    const features = new Set<string>();

    // Walk the schema tree once, building all indexes
    this.walkSchema(schema, "", (subSchema, pointer) => {
      // Add to pointer index
      index.byPointer.set(pointer, subSchema);

      if (typeof subSchema === "boolean") return;

      // ID index
      if (subSchema.$id) {
        index.byId.set(subSchema.$id, subSchema);
      }

      // Anchor index
      if (subSchema.$anchor) {
        index.byAnchor.set(subSchema.$anchor, subSchema);
      }

      // Type index
      if (subSchema.type) {
        const types = Array.isArray(subSchema.type)
          ? subSchema.type
          : [subSchema.type];
        for (const type of types) {
          if (!index.byType.has(type)) {
            index.byType.set(type, new Set());
          }
          index.byType.get(type)!.add(pointer);
        }
      }

      // Format index
      if (subSchema.format) {
        formats.add(subSchema.format);
        if (!index.byFormat.has(subSchema.format)) {
          index.byFormat.set(subSchema.format, new Set());
        }
        index.byFormat.get(subSchema.format)!.add(pointer);
      }

      // Keyword index for feature detection
      this.indexKeywords(subSchema, pointer, index.byKeyword, features);

      // Track definitions
      if (
        pointer.startsWith("#/$defs/") || pointer.startsWith("#/definitions/")
      ) {
        index.definitions.set(pointer, subSchema);
      }
    });

    // Calculate metadata
    const metadata: SchemaMetadata = {
      totalSchemas: index.byPointer.size,
      totalRefs: refs.resolved.size,
      maxDepth: this.calculateMaxDepth(schema),
      complexity: this.calculateComplexity(schema, index, refs),
      formats,
      features,
    };

    return {
      root: schema,
      refs,
      index,
      metadata,
      source: source || {},
    };
  }

  /**
   * Walk the schema tree, calling visitor for each sub-schema
   */
  private walkSchema(
    schema: Schema | boolean,
    pointer: string,
    visitor: (schema: Schema | boolean, pointer: string) => void,
    visited = new Set<string>(),
  ): void {
    // Prevent infinite recursion
    if (visited.has(pointer)) return;
    visited.add(pointer);

    // Visit current schema
    visitor(schema, pointer);

    if (typeof schema === "boolean") return;

    // Walk all possible schema locations
    if (schema.$defs) {
      for (const [key, subSchema] of Object.entries(schema.$defs)) {
        this.walkSchema(
          subSchema,
          `${pointer}/$defs/${this.escapeJsonPointer(key)}`,
          visitor,
          visited,
        );
      }
    }

    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        this.walkSchema(
          subSchema,
          `${pointer}/properties/${this.escapeJsonPointer(key)}`,
          visitor,
          visited,
        );
      }
    }

    if (schema.patternProperties) {
      for (
        const [pattern, subSchema] of Object.entries(schema.patternProperties)
      ) {
        this.walkSchema(
          subSchema,
          `${pointer}/patternProperties/${this.escapeJsonPointer(pattern)}`,
          visitor,
          visited,
        );
      }
    }

    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      this.walkSchema(
        schema.additionalProperties,
        `${pointer}/additionalProperties`,
        visitor,
        visited,
      );
    }

    if (schema.items) {
      if (Array.isArray(schema.items)) {
        schema.items.forEach((subSchema, index) => {
          this.walkSchema(
            subSchema,
            `${pointer}/items/${index}`,
            visitor,
            visited,
          );
        });
      } else {
        this.walkSchema(
          schema.items,
          `${pointer}/items`,
          visitor,
          visited,
        );
      }
    }

    if (schema.prefixItems) {
      schema.prefixItems.forEach((subSchema, index) => {
        this.walkSchema(
          subSchema,
          `${pointer}/prefixItems/${index}`,
          visitor,
          visited,
        );
      });
    }

    if (schema.contains) {
      this.walkSchema(
        schema.contains,
        `${pointer}/contains`,
        visitor,
        visited,
      );
    }

    if (schema.propertyNames) {
      this.walkSchema(
        schema.propertyNames,
        `${pointer}/propertyNames`,
        visitor,
        visited,
      );
    }

    // Composition schemas
    if (schema.allOf) {
      schema.allOf.forEach((subSchema, index) => {
        this.walkSchema(
          subSchema,
          `${pointer}/allOf/${index}`,
          visitor,
          visited,
        );
      });
    }

    if (schema.anyOf) {
      schema.anyOf.forEach((subSchema, index) => {
        this.walkSchema(
          subSchema,
          `${pointer}/anyOf/${index}`,
          visitor,
          visited,
        );
      });
    }

    if (schema.oneOf) {
      schema.oneOf.forEach((subSchema, index) => {
        this.walkSchema(
          subSchema,
          `${pointer}/oneOf/${index}`,
          visitor,
          visited,
        );
      });
    }

    if (schema.not) {
      this.walkSchema(
        schema.not,
        `${pointer}/not`,
        visitor,
        visited,
      );
    }

    // Conditional schemas
    if (schema.if) {
      this.walkSchema(
        schema.if,
        `${pointer}/if`,
        visitor,
        visited,
      );
    }

    if (schema.then) {
      this.walkSchema(
        schema.then,
        `${pointer}/then`,
        visitor,
        visited,
      );
    }

    if (schema.else) {
      this.walkSchema(
        schema.else,
        `${pointer}/else`,
        visitor,
        visited,
      );
    }

    // Dependent schemas
    if (schema.dependentSchemas) {
      for (const [key, subSchema] of Object.entries(schema.dependentSchemas)) {
        this.walkSchema(
          subSchema,
          `${pointer}/dependentSchemas/${this.escapeJsonPointer(key)}`,
          visitor,
          visited,
        );
      }
    }

    // Unevaluated properties/items
    if (
      schema.unevaluatedProperties &&
      typeof schema.unevaluatedProperties === "object"
    ) {
      this.walkSchema(
        schema.unevaluatedProperties,
        `${pointer}/unevaluatedProperties`,
        visitor,
        visited,
      );
    }

    if (
      schema.unevaluatedItems && typeof schema.unevaluatedItems === "object"
    ) {
      this.walkSchema(
        schema.unevaluatedItems,
        `${pointer}/unevaluatedItems`,
        visitor,
        visited,
      );
    }
  }

  /**
   * Index keywords for feature detection
   */
  private indexKeywords(
    schema: Schema,
    pointer: string,
    keywordIndex: Map<string, Set<string>>,
    features: Set<string>,
  ): void {
    const keywords = Object.keys(schema).filter((k) => !k.startsWith("$"));

    for (const keyword of keywords) {
      features.add(keyword);

      if (!keywordIndex.has(keyword)) {
        keywordIndex.set(keyword, new Set());
      }
      keywordIndex.get(keyword)!.add(pointer);
    }

    // Track specific features
    if (schema.if || schema.then || schema.else) {
      features.add("conditional");
    }

    if (schema.unevaluatedProperties || schema.unevaluatedItems) {
      features.add("unevaluated");
    }

    if (schema.$dynamicRef || schema.$dynamicAnchor) {
      features.add("dynamic");
    }

    if (schema.dependentSchemas || schema.dependentRequired) {
      features.add("dependencies");
    }
  }

  /**
   * Calculate maximum depth of schema nesting
   */
  private calculateMaxDepth(
    schema: Schema | boolean,
    currentDepth = 0,
    visited = new WeakSet<object>(),
  ): number {
    if (typeof schema === "boolean") {
      return currentDepth;
    }

    // Check depth limit and warn if hit
    if (currentDepth > 100) {
      console.warn(
        `Schema depth limit (100) reached - calculation may be incomplete`,
      );
      return currentDepth;
    }

    // Use object identity for cycle detection (more efficient than stringify)
    if (visited.has(schema)) {
      return currentDepth; // Already visited this schema object
    }
    visited.add(schema);

    let maxDepth = currentDepth;

    const checkDepth = (subSchema: Schema | boolean) => {
      const depth = this.calculateMaxDepth(
        subSchema,
        currentDepth + 1,
        visited,
      );
      maxDepth = Math.max(maxDepth, depth);
    };

    // Check all nested schemas
    if (schema.properties) {
      Object.values(schema.properties).forEach(checkDepth);
    }

    if (schema.items && !Array.isArray(schema.items)) {
      checkDepth(schema.items);
    }

    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      checkDepth(schema.additionalProperties);
    }

    if (schema.allOf) schema.allOf.forEach(checkDepth);
    if (schema.anyOf) schema.anyOf.forEach(checkDepth);
    if (schema.oneOf) schema.oneOf.forEach(checkDepth);
    if (schema.not) checkDepth(schema.not);

    return maxDepth;
  }

  /**
   * Calculate complexity metrics
   */
  private calculateComplexity(
    schema: Schema | boolean,
    index: ProcessedSchema["index"],
    refs: ProcessedSchema["refs"],
  ): ComplexityMetrics {
    const score = index.byPointer.size * 5 + // Base complexity per schema
      refs.resolved.size * 10 + // References add complexity
      refs.cyclic.size * 50 + // Circular refs are complex
      (index.byKeyword.get("allOf")?.size || 0) * 20 + // Composition is complex
      (index.byKeyword.get("anyOf")?.size || 0) * 15 +
      (index.byKeyword.get("oneOf")?.size || 0) * 15 +
      (index.byKeyword.get("if")?.size || 0) * 25; // Conditionals are complex

    return {
      score,
      circularRefs: refs.cyclic.size,
      maxNesting: this.calculateMaxDepth(schema),
      totalKeywords: Array.from(index.byKeyword.values())
        .reduce((sum, set) => sum + set.size, 0),
    };
  }

  /**
   * Escape JSON Pointer tokens according to RFC 6901
   */
  private escapeJsonPointer(token: string): string {
    return token.replace(/~/g, "~0").replace(/\//g, "~1");
  }
}
