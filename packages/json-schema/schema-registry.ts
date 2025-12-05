/**
 * SchemaRegistry - Document-centric schema resolution and caching
 *
 * The registry holds a reference to the full document and resolves
 * all JSON Pointers against it. This is THE source of truth for
 * schema resolution in the document-centric architecture.
 *
 * Key principles:
 * - The document is the root. All $refs resolve against it.
 * - Lazy processing with caching - only process what's needed
 * - Validators and generators receive registry access for ref following
 */

import { resolve as resolvePointer } from "../json-pointer/mod.ts";
import { RefGraph } from "./ref-graph.ts";
import type {
  GenerateOptions,
  Schema,
  SchemaType,
  ValidationResult,
} from "./types.ts";

export interface SchemaRegistryOptions {
  /** Base URI for the document */
  baseUri?: string;
}

/**
 * A lightweight processed schema that references the registry for ref resolution
 */
export interface RegistrySchema {
  /** The raw schema object */
  raw: Schema | boolean;
  /** JSON Pointer to this schema in the document */
  pointer: string;
  /** Whether this schema is part of a cycle */
  isCyclic: boolean;
}

export class SchemaRegistry {
  /** The full document - ALL refs resolve against this */
  readonly document: unknown;
  /** Complete ref topology */
  readonly refGraph: RefGraph;
  /** Cached processed schemas by pointer */
  private cache = new Map<string, RegistrySchema>();
  /** Base URI for the document */
  readonly baseUri: string;

  constructor(document: unknown, options: SchemaRegistryOptions = {}) {
    this.document = document;
    this.baseUri = options.baseUri ?? "";
    this.refGraph = RefGraph.build(document);
  }

  /**
   * Resolve a JSON Pointer against the document.
   * This ALWAYS works for valid pointers because document is the root.
   *
   * Handles URI fragment percent-encoding per RFC 3986.
   * When JSON Pointers are used as URI fragments (e.g., #/paths/~1users~1%7Bid%7D),
   * they may be percent-encoded. We decode before applying JSON Pointer resolution.
   */
  resolve(pointer: string): unknown {
    if (pointer === "#" || pointer === "") {
      return this.document;
    }

    // Handle #/path/to/schema format
    // Percent-decode for URI fragment compatibility (RFC 3986)
    const path = pointer.startsWith("#")
      ? decodeURIComponent(pointer.slice(1))
      : decodeURIComponent(pointer);

    try {
      return resolvePointer(this.document, path);
    } catch {
      return undefined;
    }
  }

  /**
   * Get a schema by pointer. Returns undefined if not found.
   */
  get(pointer: string): RegistrySchema | undefined {
    // Check cache first
    let schema = this.cache.get(pointer);
    if (schema) {
      return schema;
    }

    // Resolve from document
    const raw = this.resolve(pointer);
    if (raw === undefined) {
      return undefined;
    }

    // Validate it's a schema-like object
    if (!this.isSchemaLike(raw)) {
      return undefined;
    }

    // Create and cache the registry schema
    schema = {
      raw: raw as Schema | boolean,
      pointer,
      isCyclic: this.refGraph.isCyclic(pointer),
    };
    this.cache.set(pointer, schema);

    return schema;
  }

  /**
   * Check if a value looks like a schema
   */
  private isSchemaLike(value: unknown): boolean {
    if (typeof value === "boolean") return true;
    if (typeof value !== "object" || value === null) return false;
    return true; // Objects can be schemas
  }

  /**
   * Resolve a $ref, following the reference chain.
   * Handles both internal (#/...) and anchor ($anchor) references.
   */
  resolveRef(ref: string): RegistrySchema | undefined {
    // Handle JSON Pointer references
    if (ref.startsWith("#")) {
      return this.get(ref);
    }

    // Handle $anchor references (bare string like "myAnchor")
    // Search the document for a schema with matching $anchor
    const anchor = ref.startsWith("#") ? ref.slice(1) : ref;
    const anchorSchema = this.findAnchor(anchor);
    if (anchorSchema) {
      return anchorSchema;
    }

    // Handle $id references
    const idSchema = this.findById(ref);
    if (idSchema) {
      return idSchema;
    }

    return undefined;
  }

  /**
   * Find a schema by $anchor value
   */
  private findAnchor(anchor: string): RegistrySchema | undefined {
    // Search through all pointers for matching $anchor
    for (const pointer of this.refGraph.pointers) {
      const schema = this.get(pointer);
      if (schema && typeof schema.raw === "object" && schema.raw !== null) {
        if ((schema.raw as Schema).$anchor === anchor) {
          return schema;
        }
      }
    }
    return undefined;
  }

  /**
   * Find a schema by $id value
   */
  private findById(id: string): RegistrySchema | undefined {
    for (const pointer of this.refGraph.pointers) {
      const schema = this.get(pointer);
      if (schema && typeof schema.raw === "object" && schema.raw !== null) {
        const schemaId = (schema.raw as Schema).$id;
        if (schemaId === id || schemaId?.endsWith("/" + id)) {
          return schema;
        }
      }
    }
    return undefined;
  }

  /**
   * Check if a reference would create a cycle
   */
  isCyclic(ref: string): boolean {
    return this.refGraph.isCyclic(ref);
  }

  /**
   * Get all component schemas (for OpenAPI specs)
   */
  getComponentSchemas(): Map<string, RegistrySchema> {
    const result = new Map<string, RegistrySchema>();
    const components = this.resolve("#/components/schemas");

    if (typeof components === "object" && components !== null) {
      for (const name of Object.keys(components as Record<string, unknown>)) {
        const pointer = `#/components/schemas/${name}`;
        const schema = this.get(pointer);
        if (schema) {
          result.set(name, schema);
        }
      }
    }

    return result;
  }

  /**
   * Get statistics about the registry
   */
  getStats(): {
    totalRefs: number;
    totalPointers: number;
    cachedSchemas: number;
    cyclicRefs: number;
    cycles: number;
  } {
    return {
      totalRefs: this.refGraph.refs.size,
      totalPointers: this.refGraph.pointers.size,
      cachedSchemas: this.cache.size,
      cyclicRefs: this.refGraph.cyclicRefs.size,
      cycles: this.refGraph.cycles.length,
    };
  }
}

/**
 * Response generator that uses the registry for ref resolution
 */
export class RegistryResponseGenerator {
  private visited = new Set<string>();
  private maxDepth: number;
  private seed: number;

  constructor(
    private registry: SchemaRegistry,
    private options: GenerateOptions = {},
  ) {
    this.maxDepth = options.maxDepth ?? 10;
    this.seed = options.seed ?? Math.random() * 1000000;
  }

  /**
   * Generate data for a schema at the given pointer
   */
  generate(pointer: string): unknown {
    const schema = this.registry.get(pointer);
    if (!schema) {
      return null;
    }
    this.visited.clear();
    return this.generateFromSchema(schema.raw, pointer, 0);
  }

  /**
   * Generate data from a schema object
   */
  generateFromSchema(
    schema: Schema | boolean,
    pointer: string,
    depth: number,
  ): unknown {
    if (depth > this.maxDepth) {
      return null;
    }

    // Handle boolean schemas
    if (typeof schema === "boolean") {
      return schema ? {} : null;
    }

    // Handle $ref - use registry to resolve
    if (schema.$ref) {
      const ref = schema.$ref;

      // Check for cycles
      if (this.visited.has(ref)) {
        return { "$comment": `Circular reference to ${ref}` };
      }

      // Resolve via registry
      const resolved = this.registry.resolveRef(ref);
      if (!resolved) {
        return { "$comment": `Unresolved reference: ${ref}` };
      }

      this.visited.add(ref);
      const result = this.generateFromSchema(resolved.raw, ref, depth + 1);
      this.visited.delete(ref);
      return result;
    }

    // Priority 1: Use explicit example
    if (schema.example !== undefined && this.options.useExamples !== false) {
      return schema.example;
    }

    // Priority 2: Use first example from examples array
    if (schema.examples?.length && this.options.useExamples !== false) {
      return schema.examples[0];
    }

    // Priority 3: Use default
    if (schema.default !== undefined) {
      return schema.default;
    }

    // Priority 4: const
    if (schema.const !== undefined) {
      return schema.const;
    }

    // Priority 5: enum
    if (schema.enum?.length) {
      return this.pick(schema.enum);
    }

    // Priority 6: Handle composition keywords (anyOf, oneOf, allOf)
    if (schema.anyOf?.length) {
      // Pick first non-null option, or null if only null available
      const nonNullOptions = schema.anyOf.filter(
        (s) => typeof s !== "boolean" && s.type !== "null",
      );
      const optionToUse = nonNullOptions.length > 0
        ? nonNullOptions[0]!
        : schema.anyOf[0]!;
      return this.generateFromSchema(optionToUse, `${pointer}/anyOf/0`, depth + 1);
    }

    if (schema.oneOf?.length) {
      return this.generateFromSchema(schema.oneOf[0]!, `${pointer}/oneOf/0`, depth + 1);
    }

    if (schema.allOf?.length) {
      const merged: Record<string, unknown> = {};
      for (let i = 0; i < schema.allOf.length; i++) {
        const subSchema = schema.allOf[i]!;
        if (typeof subSchema === "boolean") continue;
        if (subSchema.properties) {
          for (const [prop, propSchema] of Object.entries(subSchema.properties)) {
            merged[prop] = this.generateFromSchema(
              propSchema,
              `${pointer}/allOf/${i}/properties/${prop}`,
              depth + 1,
            );
          }
        }
      }
      return merged;
    }

    // Priority 7: Generate based on type
    const type = this.inferType(schema);

    switch (type) {
      case "null":
        return null;
      case "boolean":
        return this.random() > 0.5;
      case "integer":
        return this.generateInteger(schema);
      case "number":
        return this.generateNumber(schema);
      case "string":
        return this.generateString(schema);
      case "array":
        return this.generateArray(schema, pointer, depth);
      case "object":
        return this.generateObject(schema, pointer, depth);
      default:
        // Infer from structure
        if (schema.properties || schema.additionalProperties) {
          return this.generateObject(schema, pointer, depth);
        }
        if (schema.items || schema.prefixItems) {
          return this.generateArray(schema, pointer, depth);
        }
        return {};
    }
  }

  private inferType(schema: Schema): SchemaType | null {
    if (schema.type) {
      if (Array.isArray(schema.type)) {
        const nonNull = schema.type.filter((t) => t !== "null");
        return nonNull.length > 0 ? nonNull[0]! : null;
      }
      return schema.type;
    }
    if (schema.properties || schema.patternProperties || schema.additionalProperties) {
      return "object";
    }
    if (schema.items || schema.prefixItems || schema.contains) {
      return "array";
    }
    if (schema.pattern || schema.minLength !== undefined || schema.maxLength !== undefined) {
      return "string";
    }
    if (schema.minimum !== undefined || schema.maximum !== undefined || schema.multipleOf !== undefined) {
      return "number";
    }
    return null;
  }

  private generateInteger(schema: Schema): number {
    const min = schema.exclusiveMinimum !== undefined
      ? schema.exclusiveMinimum + 1
      : (schema.minimum ?? 0);
    const max = schema.exclusiveMaximum !== undefined
      ? schema.exclusiveMaximum - 1
      : (schema.maximum ?? 100);
    let num = Math.floor(min + this.random() * (max - min + 1));
    if (schema.multipleOf) {
      num = Math.floor(num / schema.multipleOf) * schema.multipleOf;
    }
    return num;
  }

  private generateNumber(schema: Schema): number {
    const min = schema.exclusiveMinimum !== undefined
      ? schema.exclusiveMinimum + Number.EPSILON
      : (schema.minimum ?? 0);
    const max = schema.exclusiveMaximum !== undefined
      ? schema.exclusiveMaximum - Number.EPSILON
      : (schema.maximum ?? 100);
    let num = min + this.random() * (max - min);
    if (schema.multipleOf) {
      num = Math.floor(num / schema.multipleOf) * schema.multipleOf;
    }
    return num;
  }

  private generateString(schema: Schema): string {
    // Format-specific generation
    if (schema.format) {
      const formatted = this.generateFormat(schema.format);
      if (formatted !== null) return formatted;
    }

    const minLength = schema.minLength ?? 1;
    const maxLength = schema.maxLength ?? 10;
    const length = minLength + Math.floor(this.random() * (maxLength - minLength + 1));
    return this.randomString(length);
  }

  private generateFormat(format: string): string | null {
    switch (format) {
      case "date-time":
        return new Date(Date.now() - Math.floor(this.random() * 365 * 24 * 60 * 60 * 1000)).toISOString();
      case "date":
        return new Date(Date.now() - Math.floor(this.random() * 365 * 24 * 60 * 60 * 1000)).toISOString().split("T")[0]!;
      case "time": {
        const h = Math.floor(this.random() * 24).toString().padStart(2, "0");
        const m = Math.floor(this.random() * 60).toString().padStart(2, "0");
        const s = Math.floor(this.random() * 60).toString().padStart(2, "0");
        return `${h}:${m}:${s}`;
      }
      case "email":
        return `user${Math.floor(this.random() * 1000)}@example.com`;
      case "hostname":
        return `host${Math.floor(this.random() * 1000)}.example.com`;
      case "ipv4":
        return Array(4).fill(0).map(() => Math.floor(this.random() * 256)).join(".");
      case "ipv6":
        return Array(8).fill(0).map(() => Math.floor(this.random() * 65536).toString(16).padStart(4, "0")).join(":");
      case "uri":
        return `https://example.com/path${Math.floor(this.random() * 1000)}`;
      case "uuid":
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = Math.floor(this.random() * 16);
          const v = c === "x" ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      default:
        return null;
    }
  }

  private generateArray(schema: Schema, pointer: string, depth: number): unknown[] {
    const minItems = schema.minItems ?? 0;
    const maxItems = schema.maxItems ?? 3;
    const length = minItems + Math.floor(this.random() * (maxItems - minItems + 1));

    const array: unknown[] = [];

    // Generate prefix items first
    if (schema.prefixItems) {
      for (let i = 0; i < schema.prefixItems.length && i < length; i++) {
        array.push(this.generateFromSchema(schema.prefixItems[i]!, `${pointer}/prefixItems/${i}`, depth + 1));
      }
    }

    // Generate remaining items
    if (schema.items && array.length < length) {
      const itemSchema = schema.items as Schema;
      for (let i = array.length; i < length; i++) {
        array.push(this.generateFromSchema(itemSchema, `${pointer}/items`, depth + 1));
      }
    }

    return array;
  }

  private generateObject(schema: Schema, pointer: string, depth: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    // Generate required properties
    if (schema.required) {
      for (const prop of schema.required) {
        if (schema.properties?.[prop]) {
          obj[prop] = this.generateFromSchema(schema.properties[prop]!, `${pointer}/properties/${prop}`, depth + 1);
        } else {
          obj[prop] = this.pick(["value", 123, true, null]);
        }
      }
    }

    // Generate other properties
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (!(prop in obj) && this.random() > 0.5) {
          obj[prop] = this.generateFromSchema(propSchema, `${pointer}/properties/${prop}`, depth + 1);
        }
      }
    }

    return obj;
  }

  // Simple seeded random
  private random(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private randomString(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(this.random() * chars.length)];
    }
    return result;
  }

  private pick<T>(array: T[]): T {
    return array[Math.floor(this.random() * array.length)]!;
  }
}

/**
 * Validator that uses the registry for ref resolution
 */
export class RegistryValidator {
  private visited = new Set<string>();

  constructor(private registry: SchemaRegistry) {}

  /**
   * Validate data against a schema at the given pointer
   */
  validate(pointer: string, data: unknown): ValidationResult {
    const schema = this.registry.get(pointer);
    if (!schema) {
      return {
        valid: false,
        errors: [{
          instancePath: "",
          schemaPath: pointer,
          keyword: "$ref",
          message: `Schema not found: ${pointer}`,
        }],
      };
    }

    this.visited.clear();
    const errors = this.validateSchema(schema.raw, data, "", pointer);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate data against a schema
   */
  private validateSchema(
    schema: Schema | boolean,
    data: unknown,
    instancePath: string,
    schemaPath: string,
  ): Array<{ instancePath: string; schemaPath: string; keyword: string; message: string }> {
    const errors: Array<{ instancePath: string; schemaPath: string; keyword: string; message: string }> = [];

    // Boolean schemas
    if (typeof schema === "boolean") {
      if (!schema) {
        errors.push({
          instancePath,
          schemaPath,
          keyword: "false",
          message: "Schema is false - no data is valid",
        });
      }
      return errors;
    }

    // Handle $ref - resolve via registry
    if (schema.$ref) {
      const ref = schema.$ref;

      if (this.visited.has(ref)) {
        // Cycle - assume valid to prevent infinite loop
        return errors;
      }

      const resolved = this.registry.resolveRef(ref);
      if (!resolved) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/$ref`,
          keyword: "$ref",
          message: `Cannot resolve reference: ${ref}`,
        });
        return errors;
      }

      this.visited.add(ref);
      const refErrors = this.validateSchema(resolved.raw, data, instancePath, ref);
      this.visited.delete(ref);
      errors.push(...refErrors);

      // In JSON Schema 2020-12, other keywords apply alongside $ref
      // Continue validation with other keywords
    }

    // Type validation
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actualType = this.getType(data);

      if (!types.includes(actualType as SchemaType)) {
        // Handle integer as special case of number
        if (!(actualType === "integer" && types.includes("number"))) {
          errors.push({
            instancePath,
            schemaPath: `${schemaPath}/type`,
            keyword: "type",
            message: `Expected ${types.join(" or ")}, got ${actualType}`,
          });
        }
      }
    }

    // Const validation
    if (schema.const !== undefined) {
      if (!this.deepEqual(data, schema.const)) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/const`,
          keyword: "const",
          message: `Must equal constant value`,
        });
      }
    }

    // Enum validation
    if (schema.enum !== undefined) {
      if (!schema.enum.some((e) => this.deepEqual(data, e))) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/enum`,
          keyword: "enum",
          message: `Must be one of: ${JSON.stringify(schema.enum)}`,
        });
      }
    }

    // String validations
    if (typeof data === "string") {
      if (schema.minLength !== undefined && data.length < schema.minLength) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/minLength`,
          keyword: "minLength",
          message: `String must be at least ${schema.minLength} characters`,
        });
      }
      if (schema.maxLength !== undefined && data.length > schema.maxLength) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/maxLength`,
          keyword: "maxLength",
          message: `String must be at most ${schema.maxLength} characters`,
        });
      }
      if (schema.pattern !== undefined) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(data)) {
          errors.push({
            instancePath,
            schemaPath: `${schemaPath}/pattern`,
            keyword: "pattern",
            message: `String must match pattern: ${schema.pattern}`,
          });
        }
      }
    }

    // Number validations
    if (typeof data === "number") {
      if (schema.minimum !== undefined && data < schema.minimum) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/minimum`,
          keyword: "minimum",
          message: `Number must be >= ${schema.minimum}`,
        });
      }
      if (schema.maximum !== undefined && data > schema.maximum) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/maximum`,
          keyword: "maximum",
          message: `Number must be <= ${schema.maximum}`,
        });
      }
      if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/exclusiveMinimum`,
          keyword: "exclusiveMinimum",
          message: `Number must be > ${schema.exclusiveMinimum}`,
        });
      }
      if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/exclusiveMaximum`,
          keyword: "exclusiveMaximum",
          message: `Number must be < ${schema.exclusiveMaximum}`,
        });
      }
      if (schema.multipleOf !== undefined && data % schema.multipleOf !== 0) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/multipleOf`,
          keyword: "multipleOf",
          message: `Number must be a multiple of ${schema.multipleOf}`,
        });
      }
    }

    // Array validations
    if (Array.isArray(data)) {
      if (schema.minItems !== undefined && data.length < schema.minItems) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/minItems`,
          keyword: "minItems",
          message: `Array must have at least ${schema.minItems} items`,
        });
      }
      if (schema.maxItems !== undefined && data.length > schema.maxItems) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/maxItems`,
          keyword: "maxItems",
          message: `Array must have at most ${schema.maxItems} items`,
        });
      }

      // Validate items
      if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
        data.forEach((item, index) => {
          errors.push(...this.validateSchema(
            schema.items as Schema,
            item,
            `${instancePath}/${index}`,
            `${schemaPath}/items`,
          ));
        });
      }

      // Validate prefixItems
      if (schema.prefixItems) {
        schema.prefixItems.forEach((itemSchema, index) => {
          if (index < data.length) {
            errors.push(...this.validateSchema(
              itemSchema,
              data[index],
              `${instancePath}/${index}`,
              `${schemaPath}/prefixItems/${index}`,
            ));
          }
        });
      }
    }

    // Object validations
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      const keys = Object.keys(obj);

      if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/minProperties`,
          keyword: "minProperties",
          message: `Object must have at least ${schema.minProperties} properties`,
        });
      }
      if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/maxProperties`,
          keyword: "maxProperties",
          message: `Object must have at most ${schema.maxProperties} properties`,
        });
      }

      // Required properties
      if (schema.required) {
        for (const prop of schema.required) {
          if (!(prop in obj)) {
            errors.push({
              instancePath,
              schemaPath: `${schemaPath}/required`,
              keyword: "required",
              message: `Missing required property: ${prop}`,
            });
          }
        }
      }

      // Validate properties
      if (schema.properties) {
        for (const [prop, propSchema] of Object.entries(schema.properties)) {
          if (prop in obj) {
            errors.push(...this.validateSchema(
              propSchema,
              obj[prop],
              `${instancePath}/${prop}`,
              `${schemaPath}/properties/${prop}`,
            ));
          }
        }
      }

      // Additional properties
      if (schema.additionalProperties === false) {
        const defined = new Set(Object.keys(schema.properties ?? {}));
        const patternProps = Object.keys(schema.patternProperties ?? {});

        for (const key of keys) {
          if (!defined.has(key)) {
            // Check pattern properties
            const matchesPattern = patternProps.some((pattern) => new RegExp(pattern).test(key));
            if (!matchesPattern) {
              errors.push({
                instancePath: `${instancePath}/${key}`,
                schemaPath: `${schemaPath}/additionalProperties`,
                keyword: "additionalProperties",
                message: `Additional property not allowed: ${key}`,
              });
            }
          }
        }
      } else if (typeof schema.additionalProperties === "object") {
        const defined = new Set(Object.keys(schema.properties ?? {}));

        for (const key of keys) {
          if (!defined.has(key)) {
            errors.push(...this.validateSchema(
              schema.additionalProperties,
              obj[key],
              `${instancePath}/${key}`,
              `${schemaPath}/additionalProperties`,
            ));
          }
        }
      }
    }

    // Composition: allOf
    if (schema.allOf) {
      for (let i = 0; i < schema.allOf.length; i++) {
        errors.push(...this.validateSchema(
          schema.allOf[i]!,
          data,
          instancePath,
          `${schemaPath}/allOf/${i}`,
        ));
      }
    }

    // Composition: anyOf
    if (schema.anyOf) {
      const anyOfValid = schema.anyOf.some((subSchema, i) => {
        const subErrors = this.validateSchema(subSchema, data, instancePath, `${schemaPath}/anyOf/${i}`);
        return subErrors.length === 0;
      });
      if (!anyOfValid) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/anyOf`,
          keyword: "anyOf",
          message: "Must match at least one schema in anyOf",
        });
      }
    }

    // Composition: oneOf
    if (schema.oneOf) {
      const matchCount = schema.oneOf.filter((subSchema, i) => {
        const subErrors = this.validateSchema(subSchema, data, instancePath, `${schemaPath}/oneOf/${i}`);
        return subErrors.length === 0;
      }).length;
      if (matchCount !== 1) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/oneOf`,
          keyword: "oneOf",
          message: `Must match exactly one schema in oneOf (matched ${matchCount})`,
        });
      }
    }

    // Composition: not
    if (schema.not) {
      const notErrors = this.validateSchema(schema.not, data, instancePath, `${schemaPath}/not`);
      if (notErrors.length === 0) {
        errors.push({
          instancePath,
          schemaPath: `${schemaPath}/not`,
          keyword: "not",
          message: "Must not match the schema in 'not'",
        });
      }
    }

    return errors;
  }

  private getType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof value === "number") {
      return Number.isInteger(value) ? "integer" : "number";
    }
    return typeof value;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object" || a === null || b === null) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => this.deepEqual(val, b[i]));
    }

    if (Array.isArray(a) || Array.isArray(b)) return false;

    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) =>
      this.deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    );
  }
}
