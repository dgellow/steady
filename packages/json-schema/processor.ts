/**
 * JSON Schema Processor - The core of Steady's schema handling
 *
 * Implements three-phase processing:
 * 1. Schema Analysis - Validate and analyze schemas once at startup
 * 2. Runtime Operations - Fast validation using pre-processed schemas
 * 3. Response Generation - Create mock data from schemas
 */

import type {
  ProcessedSchema,
  Schema,
  SchemaError,
  SchemaProcessResult,
  SchemaSource,
  SchemaWarning,
} from "./types.ts";
import { MetaschemaValidator } from "./metaschema-validator.ts";
import { SchemaIndexer } from "./schema-indexer.ts";
import { ScaleAwareRefResolver } from "./ref-resolver-enhanced.ts";

export class JsonSchemaProcessor {
  private metaschemaValidator: MetaschemaValidator;
  private indexer: SchemaIndexer;

  constructor() {
    this.metaschemaValidator = new MetaschemaValidator();
    this.indexer = new SchemaIndexer();
  }

  /**
   * Process a raw schema object into an analyzed, indexed structure
   * This is THE key innovation - we validate and analyze schemas ONCE
   */
  async process(
    schemaObject: unknown,
    source?: SchemaSource,
  ): Promise<SchemaProcessResult> {
    const warnings: SchemaWarning[] = [];

    // 1. Validate against metaschema
    if (source?.metaschema) {
      const metaschemaResult = await this.metaschemaValidator.validate(
        schemaObject,
        source.metaschema,
      );
      if (!metaschemaResult.valid) {
        return {
          valid: false,
          errors: this.convertToSchemaErrors(metaschemaResult.errors),
          warnings,
          // No metadata for invalid schemas
        };
      }
    }

    const schema = schemaObject as Schema | boolean;

    // 2. Resolve all references efficiently
    const resolver = new ScaleAwareRefResolver(schema, source?.baseUri);
    const resolveResult = await resolver.resolveAll(schema);

    if (!resolveResult.success) {
      return {
        valid: false,
        errors: resolveResult.errors.map((err) => ({
          type: "ref-not-found" as const,
          instancePath: "",
          schemaPath: "#",
          keyword: "$ref",
          message: err,
          suggestion: "Ensure all referenced schemas exist and are accessible",
        })),
        warnings: resolveResult.warnings.map((warn) => ({
          type: "performance-concern" as const,
          message: warn,
          location: "#",
        })),
        // No metadata for invalid schemas
      };
    }

    // 3. Build indexes for O(1) runtime operations
    // Detect circular references in the dependency graph
    const cyclicRefs = new Set<string>();
    for (const cycle of resolveResult.cycles) {
      for (const ref of cycle) {
        cyclicRefs.add(ref);
      }
    }

    const refs: ProcessedSchema["refs"] = {
      resolved: resolveResult.resolved,
      graph: {
        nodes: resolveResult.dependencyGraph.nodes,
        edges: resolveResult.dependencyGraph.edges,
        cycles: resolveResult.cycles,
      },
      cyclic: cyclicRefs,
    };

    const indexed = this.indexer.index(
      schema,
      refs,
      source,
    );

    // 4. Analyze complexity and add warnings
    const complexityWarnings = this.analyzeComplexity(indexed);
    warnings.push(...complexityWarnings);
    warnings.push(...resolveResult.warnings.map((warn) => ({
      type: "performance-concern" as const,
      message: warn,
      location: "#",
    })));

    return {
      valid: true,
      schema: indexed,
      errors: [],
      warnings,
      metadata: indexed.metadata,
    };
  }

  private analyzeComplexity(schema: ProcessedSchema): SchemaWarning[] {
    const warnings: SchemaWarning[] = [];
    const { complexity } = schema.metadata;

    if (complexity.score > 1000) {
      warnings.push({
        type: "performance-concern",
        message: "Schema complexity is very high",
        location: "#",
        suggestion:
          "Consider simplifying the schema or splitting into smaller schemas",
      });
    }

    if (complexity.circularRefs > 5) {
      warnings.push({
        type: "performance-concern",
        message: `Schema has ${complexity.circularRefs} circular references`,
        location: "#",
        suggestion: "Excessive circular references can impact performance",
      });
    }

    if (complexity.maxNesting > 20) {
      warnings.push({
        type: "performance-concern",
        message: `Schema nesting depth is ${complexity.maxNesting}`,
        location: "#",
        suggestion: "Deep nesting can impact validation performance",
      });
    }

    return warnings;
  }

  private convertToSchemaErrors(errors: SchemaError[]): SchemaError[] {
    return errors.map((err) => ({
      ...err,
      type: "metaschema-violation" as const,
      suggestion: "Fix the schema to comply with JSON Schema specification",
    }));
  }
}
