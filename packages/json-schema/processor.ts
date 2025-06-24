/**
 * JSON Schema Processor - The core of Steady's schema handling
 * 
 * Implements three-phase processing:
 * 1. Schema Analysis - Validate and analyze schemas once at startup
 * 2. Runtime Operations - Fast validation using pre-processed schemas
 * 3. Response Generation - Create mock data from schemas
 */

import type {
  Schema,
  SchemaProcessResult,
  ProcessedSchema,
  SchemaError,
  SchemaWarning,
  SchemaMetadata,
  ComplexityMetrics,
  DependencyGraph,
  SchemaSource,
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
    const errors: SchemaError[] = [];
    const warnings: SchemaWarning[] = [];
    
    // 1. Validate against metaschema
    const metaschemaResult = await this.metaschemaValidator.validate(schemaObject);
    if (!metaschemaResult.valid) {
      return {
        valid: false,
        errors: this.convertToSchemaErrors(metaschemaResult.errors),
        warnings,
        // No metadata for invalid schemas
      };
    }
    
    const schema = schemaObject as Schema | boolean;
    
    // 2. Resolve all references efficiently
    const resolver = new ScaleAwareRefResolver(schema);
    const resolveResult = await resolver.resolveAll(schema);
    
    if (!resolveResult.success) {
      return {
        valid: false,
        errors: resolveResult.errors.map(err => ({
          type: "ref-not-found" as const,
          instancePath: "",
          schemaPath: "#",
          keyword: "$ref",
          message: err,
          suggestion: "Ensure all referenced schemas exist and are accessible",
        })),
        warnings: resolveResult.warnings.map(warn => ({
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
    warnings.push(...resolveResult.warnings.map(warn => ({
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
  
  
  private findAllRefs(schema: Schema | boolean, found = new Set<string>()): string[] {
    if (typeof schema === "boolean") {
      return [];
    }
    
    const refs: string[] = [];
    
    if (schema.$ref && !found.has(schema.$ref)) {
      refs.push(schema.$ref);
      found.add(schema.$ref);
    }
    
    // Recursively find refs in all schema locations
    const subSchemas: (Schema | boolean)[] = [];
    
    if (schema.$defs) {
      subSchemas.push(...Object.values(schema.$defs));
    }
    if (schema.properties) {
      subSchemas.push(...Object.values(schema.properties));
    }
    if (schema.patternProperties) {
      subSchemas.push(...Object.values(schema.patternProperties));
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      subSchemas.push(schema.additionalProperties);
    }
    if (schema.items) {
      if (Array.isArray(schema.items)) {
        subSchemas.push(...schema.items);
      } else {
        subSchemas.push(schema.items);
      }
    }
    if (schema.prefixItems) {
      subSchemas.push(...schema.prefixItems);
    }
    if (schema.contains) {
      subSchemas.push(schema.contains);
    }
    if (schema.allOf) subSchemas.push(...schema.allOf);
    if (schema.anyOf) subSchemas.push(...schema.anyOf);
    if (schema.oneOf) subSchemas.push(...schema.oneOf);
    if (schema.not) subSchemas.push(schema.not);
    if (schema.if) subSchemas.push(schema.if);
    if (schema.then) subSchemas.push(schema.then);
    if (schema.else) subSchemas.push(schema.else);
    if (schema.dependentSchemas) {
      subSchemas.push(...Object.values(schema.dependentSchemas));
    }
    if (schema.propertyNames) {
      subSchemas.push(schema.propertyNames);
    }
    
    for (const subSchema of subSchemas) {
      refs.push(...this.findAllRefs(subSchema, found));
    }
    
    return refs;
  }
  
  private detectCycles(graph: DependencyGraph): string[][] {
    // Simple cycle detection - in production would use Tarjan's algorithm
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack: string[] = [];
    
    const visit = (node: string): void => {
      if (stack.includes(node)) {
        const cycleStart = stack.indexOf(node);
        cycles.push([...stack.slice(cycleStart), node]);
        return;
      }
      
      if (visited.has(node)) return;
      
      visited.add(node);
      stack.push(node);
      
      const edges = graph.edges.get(node) || new Set();
      for (const neighbor of edges) {
        visit(neighbor);
      }
      
      stack.pop();
    };
    
    for (const node of graph.nodes) {
      if (!visited.has(node)) {
        visit(node);
      }
    }
    
    graph.cycles = cycles;
    return cycles;
  }
  
  private calculateMaxDepth(schema: Schema | boolean, depth = 0): number {
    if (typeof schema === "boolean" || depth > 100) {
      return depth;
    }
    
    let maxDepth = depth;
    
    // Check all nested schemas
    const checkSchema = (s: Schema | boolean) => {
      maxDepth = Math.max(maxDepth, this.calculateMaxDepth(s, depth + 1));
    };
    
    if (schema.$defs) {
      Object.values(schema.$defs).forEach(checkSchema);
    }
    if (schema.properties) {
      Object.values(schema.properties).forEach(checkSchema);
    }
    if (schema.items && !Array.isArray(schema.items)) {
      checkSchema(schema.items);
    }
    
    return maxDepth;
  }
  
  private countKeywords(schema: Schema | boolean): number {
    if (typeof schema === "boolean") return 1;
    
    const validationKeywords = [
      "type", "enum", "const", "multipleOf", "maximum", "exclusiveMaximum",
      "minimum", "exclusiveMinimum", "maxLength", "minLength", "pattern",
      "maxItems", "minItems", "uniqueItems", "maxProperties", "minProperties",
      "required", "additionalProperties", "properties", "patternProperties",
      "dependencies", "propertyNames", "if", "then", "else", "allOf", "anyOf",
      "oneOf", "not", "format", "contentMediaType", "contentEncoding",
    ];
    
    let count = 0;
    for (const keyword of validationKeywords) {
      if (keyword in schema) count++;
    }
    
    return count;
  }
  
  private analyzeComplexity(schema: ProcessedSchema): SchemaWarning[] {
    const warnings: SchemaWarning[] = [];
    const { complexity } = schema.metadata;
    
    if (complexity.score > 1000) {
      warnings.push({
        type: "performance-concern",
        message: "Schema complexity is very high",
        location: "#",
        suggestion: "Consider simplifying the schema or splitting into smaller schemas",
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
  
  private convertToSchemaErrors(errors: any[]): SchemaError[] {
    return errors.map(err => ({
      ...err,
      type: "metaschema-violation" as const,
      suggestion: "Fix the schema to comply with JSON Schema specification",
    }));
  }
}