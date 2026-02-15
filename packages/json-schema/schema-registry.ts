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

import { resolve as resolvePointer } from "@steady/json-pointer";
import { RefGraph } from "./ref-graph.ts";
import type { GenerateOptions, Schema, SchemaType } from "./types.ts";

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
    let path: string;
    try {
      path = pointer.startsWith("#")
        ? decodeURIComponent(pointer.slice(1))
        : decodeURIComponent(pointer);
    } catch {
      // Invalid percent encoding
      return undefined;
    }

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
    // Handle JSON Pointer references (e.g., "#/components/schemas/User")
    if (ref.startsWith("#")) {
      return this.get(ref);
    }

    // At this point, ref is a bare string (not starting with #)
    // Try $anchor lookup first (e.g., "myAnchor")
    const anchorSchema = this.findAnchor(ref);
    if (anchorSchema) {
      return anchorSchema;
    }

    // Handle $id references (e.g., "schema://example.com/user")
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
   * Find a schema by $id value (exact match only)
   *
   * Per JSON Schema spec, $ref values are resolved as URI-references against
   * the base URI. We only match schemas whose $id exactly equals the reference.
   */
  private findById(id: string): RegistrySchema | undefined {
    for (const pointer of this.refGraph.pointers) {
      const schema = this.get(pointer);
      if (schema && typeof schema.raw === "object" && schema.raw !== null) {
        const schemaId = (schema.raw as Schema).$id;
        if (schemaId === id) {
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
  private initialSeed: number;
  private seed: number;
  private arrayMin: number;
  private arrayMax: number;

  constructor(
    private registry: SchemaRegistry,
    private options: GenerateOptions = {},
  ) {
    this.initialSeed = options.seed ?? Math.random() * 1000000;
    this.seed = this.initialSeed;
    // Default to exactly 1 item (no randomness)
    // If only min is set: exact count (min=max=value)
    // If only max is set: range from default 1 to max
    const minSet = options.arrayMin !== undefined;
    const maxSet = options.arrayMax !== undefined;
    if (minSet && maxSet) {
      this.arrayMin = options.arrayMin!;
      this.arrayMax = options.arrayMax!;
    } else if (minSet) {
      // Only min set: exact count
      this.arrayMin = options.arrayMin!;
      this.arrayMax = options.arrayMin!;
    } else if (maxSet) {
      // Only max set: range from 1 to max
      this.arrayMin = 1;
      this.arrayMax = options.arrayMax!;
    } else {
      // Neither set: exactly 1 item
      this.arrayMin = 1;
      this.arrayMax = 1;
    }
  }

  /**
   * Generate data for a schema at the given pointer
   */
  generate(pointer: string): unknown {
    const schema = this.registry.get(pointer);
    if (!schema) {
      return null;
    }
    // Reset RNG state for deterministic output per-call
    this.seed = this.initialSeed;
    this.visited.clear();
    return this.generateFromSchema(schema.raw, pointer);
  }

  /**
   * Generate data from a schema object
   */
  generateFromSchema(
    schema: Schema | boolean,
    pointer: string,
  ): unknown {
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
      const result = this.generateFromSchema(resolved.raw, ref);
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
      return this.generateFromSchema(optionToUse, `${pointer}/anyOf/0`);
    }

    if (schema.oneOf?.length) {
      return this.generateFromSchema(schema.oneOf[0]!, `${pointer}/oneOf/0`);
    }

    if (schema.allOf?.length) {
      // Merge all subschemas into one combined schema, then generate from it
      const merged: Schema = {};
      this.mergeAllOfInto(merged, schema.allOf, 0);
      // Generate from merged schema (remove allOf to avoid infinite recursion)
      const { allOf: _, ...mergedWithoutAllOf } = merged;
      return this.generateFromSchema(mergedWithoutAllOf, pointer);
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
        return this.generateArray(schema, pointer);
      case "object":
        return this.generateObject(schema, pointer);
      default:
        // Infer from structure
        if (schema.properties || schema.additionalProperties) {
          return this.generateObject(schema, pointer);
        }
        if (schema.items || schema.prefixItems) {
          return this.generateArray(schema, pointer);
        }
        // Schema with nullable: true but no type - return null
        // This handles OpenAPI 3.0 style nullable modifiers in allOf
        if (schema.nullable === true) {
          return null;
        }
        return {};
    }
  }

  /** Recursively flatten allOf members into `merged`, resolving $refs. */
  private mergeAllOfInto(
    merged: Schema,
    members: ReadonlyArray<Schema | boolean>,
    depth: number,
  ): void {
    if (depth > 10) return; // guard against pathological specs

    for (const subSchema of members) {
      if (typeof subSchema === "boolean") continue;

      // Resolve $ref to get the actual schema
      let resolved: Schema = subSchema;
      if (subSchema.$ref) {
        const refResult = this.registry.resolveRef(subSchema.$ref);
        if (refResult) {
          resolved = refResult.raw as Schema;
        }
      }

      for (const [key, value] of Object.entries(resolved)) {
        if (key === "allOf") {
          // Recursively flatten nested allOf
          this.mergeAllOfInto(
            merged,
            value as Array<Schema | boolean>,
            depth + 1,
          );
        } else if (key === "properties" && merged.properties) {
          merged.properties = {
            ...merged.properties,
            ...(value as Schema["properties"]),
          };
        } else if (key === "required" && merged.required) {
          merged.required = [
            ...new Set([...merged.required, ...(value as string[])]),
          ];
        } else {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
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
    if (
      schema.properties || schema.patternProperties ||
      schema.additionalProperties
    ) {
      return "object";
    }
    if (schema.items || schema.prefixItems || schema.contains) {
      return "array";
    }
    if (
      schema.pattern || schema.minLength !== undefined ||
      schema.maxLength !== undefined
    ) {
      return "string";
    }
    if (
      schema.minimum !== undefined || schema.maximum !== undefined ||
      schema.multipleOf !== undefined
    ) {
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
    if (schema.multipleOf && schema.multipleOf > 0) {
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
    if (schema.multipleOf && schema.multipleOf > 0) {
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
    const length = minLength +
      Math.floor(this.random() * (maxLength - minLength + 1));
    return this.randomString(length);
  }

  private generateFormat(format: string): string | null {
    switch (format) {
      case "date-time":
        return new Date(
          Date.now() - Math.floor(this.random() * 365 * 24 * 60 * 60 * 1000),
        ).toISOString();
      case "date":
        return new Date(
          Date.now() - Math.floor(this.random() * 365 * 24 * 60 * 60 * 1000),
        ).toISOString().split("T")[0]!;
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
        return Array(4).fill(0).map(() => Math.floor(this.random() * 256)).join(
          ".",
        );
      case "ipv6":
        return Array(8).fill(0).map(() =>
          Math.floor(this.random() * 65536).toString(16).padStart(4, "0")
        ).join(":");
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

  private generateArray(schema: Schema, pointer: string): unknown[] {
    // Use generator options, which override schema constraints
    const minItems = this.arrayMin;
    const maxItems = this.arrayMax;
    const length = minItems <= 0
      ? 0
      : minItems + Math.floor(this.random() * (maxItems - minItems + 1));

    const array: unknown[] = [];

    // Generate prefix items first
    if (schema.prefixItems) {
      for (let i = 0; i < schema.prefixItems.length && i < length; i++) {
        array.push(
          this.generateFromSchema(
            schema.prefixItems[i]!,
            `${pointer}/prefixItems/${i}`,
          ),
        );
      }
    }

    // Generate remaining items
    if (schema.items && array.length < length) {
      const itemSchema = schema.items as Schema;
      for (let i = array.length; i < length; i++) {
        array.push(this.generateFromSchema(itemSchema, `${pointer}/items`));
      }
    }

    return array;
  }

  private generateObject(
    schema: Schema,
    pointer: string,
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    // Generate required properties
    if (schema.required) {
      for (const prop of schema.required) {
        if (schema.properties?.[prop]) {
          obj[prop] = this.generateFromSchema(
            schema.properties[prop]!,
            `${pointer}/properties/${prop}`,
          );
        } else {
          obj[prop] = this.pick(["value", 123, true, null]);
        }
      }
    }

    // TODO: Revisit optional property generation strategy.
    // Only required properties are generated. Optional properties are omitted
    // to ensure consistent, minimal responses. This avoids flaky SDK tests
    // (e.g., pagination responses randomly missing `items` array).
    // Options to consider:
    // - Always include arrays (even empty) but skip other optionals
    // - Add a "minimal" vs "full" generation mode
    // - Let users configure which optional fields to include

    return obj;
  }

  // Simple seeded random
  private random(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private randomString(length: number): string {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
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
