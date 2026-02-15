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
  SchemaValidationError,
  SchemaWarning,
} from "./types.ts";
import { MetaschemaValidator } from "./metaschema-validator.ts";
import { SchemaIndexer } from "./schema-indexer.ts";
import { SchemaRegistry } from "./schema-registry.ts";
import { computeCyclicRefs } from "./cycle-detection.ts";
import { checkRefSiblings } from "./ref-sibling-checker.ts";
import { validateRef } from "@steady/json-pointer";

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
  process(
    schemaObject: unknown,
    source?: SchemaSource,
  ): SchemaProcessResult {
    const warnings: SchemaWarning[] = [];

    // 1. Validate against metaschema
    if (source?.metaschema) {
      const metaschemaResult = this.metaschemaValidator.validate(
        schemaObject,
        source.metaschema,
      );
      if (!metaschemaResult.valid) {
        return {
          valid: false,
          errors: this.convertToSchemaErrors(metaschemaResult.errors),
          warnings,
        };
      }
    }

    const schema = schemaObject as Schema | boolean;

    // 2. Resolve all references via SchemaRegistry
    const registry = new SchemaRegistry(schema, {
      baseUri: source?.baseUri,
    });
    const refGraph = registry.refGraph;

    const resolved = new Map<string, Schema | boolean>();
    const syntaxErrors: SchemaError[] = [];

    for (const ref of refGraph.refs) {
      // Validate ref syntax per RFC 6901. Syntax violations are fatal
      // (the schema itself is malformed). Resolution failures (valid
      // syntax but missing target) are non-fatal; the diagnostics
      // engine handles those via E1004 with full spec context.
      const validation = validateRef(ref);
      if (!validation.valid) {
        syntaxErrors.push({
          type: "schema-invalid",
          instancePath: "",
          schemaPath: "#",
          keyword: "$ref",
          message: `Invalid $ref syntax: ${validation.error}`,
          suggestion: validation.suggestion,
        });
        continue;
      }

      if (!ref.startsWith("#")) {
        syntaxErrors.push({
          type: "schema-invalid",
          instancePath: "",
          schemaPath: "#",
          keyword: "$ref",
          message: `External reference not supported: ${ref}. ` +
            `Include referenced schemas in $defs.`,
          suggestion:
            "Include the schema directly in your document using $defs",
        });
        continue;
      }

      const result = registry.resolveRef(ref);
      if (result) {
        resolved.set(ref, result.raw);
      }
    }

    if (syntaxErrors.length > 0) {
      return {
        valid: false,
        errors: syntaxErrors,
        warnings,
      };
    }

    // 3. Compute cycles using containment-aware algorithm
    const cyclicRefs = computeCyclicRefs(refGraph.edges);

    // Generate warnings for detected cycles
    for (const cycle of refGraph.cycles) {
      warnings.push({
        type: "performance-concern" as const,
        message: `Circular reference detected: ${cycle.join(" -> ")}`,
        location: "#",
      });
    }

    const refs: ProcessedSchema["refs"] = {
      resolved,
      cyclic: cyclicRefs,
    };

    const indexed = this.indexer.index(
      schema,
      refs,
      source,
    );

    // 3.5. Check for $ref siblings (JSON Schema 2020-12 behavior)
    const siblingWarnings = checkRefSiblings(schema);
    warnings.push(...siblingWarnings);

    // 4. Analyze complexity and add warnings
    const complexityWarnings = this.analyzeComplexity(indexed);
    warnings.push(...complexityWarnings);

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

  private convertToSchemaErrors(
    errors: SchemaValidationError[],
  ): SchemaError[] {
    return errors.map((err) => ({
      ...err,
      type: "metaschema-violation" as const,
      suggestion: "Fix the schema to comply with JSON Schema specification",
    }));
  }
}
