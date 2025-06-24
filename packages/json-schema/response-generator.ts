/**
 * Response Generator - Creates mock data from JSON Schemas
 * 
 * Generates realistic data that conforms to schema constraints,
 * prioritizing explicit examples over generated values.
 */

import type {
  ProcessedSchema,
  Schema,
  SchemaType,
  GenerateOptions,
  GenerateContext,
  RandomGenerator,
} from "./types.ts";

// Default random generator using Math.random
class DefaultRandomGenerator implements RandomGenerator {
  private seed: number;
  
  constructor(seed?: number) {
    // Simple seedable random if seed provided
    this.seed = seed ?? Math.random() * 1000000;
  }
  
  next(): number {
    // Simple LCG for deterministic generation
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  
  string(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(this.next() * chars.length)];
    }
    return result;
  }
  
  pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)]!;
  }
}

export class ResponseGenerator {
  constructor(
    private processedSchema: ProcessedSchema,
    private options: GenerateOptions = {},
  ) {}
  
  /**
   * Generate data that conforms to the schema
   */
  generate(): unknown {
    const context: GenerateContext = {
      depth: 0,
      maxDepth: this.options.maxDepth ?? 10,
      visited: new Set(),
      generated: new WeakMap(),
      random: new DefaultRandomGenerator(this.options.seed),
    };
    
    return this.generateFromSchema(this.processedSchema.root, "#", context);
  }
  
  /**
   * Generate data from a specific schema
   */
  private generateFromSchema(
    schema: Schema | boolean,
    pointer: string,
    context: GenerateContext,
  ): unknown {
    // Check depth limit
    if (context.depth > context.maxDepth) {
      return null;
    }
    
    // Handle boolean schemas
    if (typeof schema === "boolean") {
      return schema ? {} : null;
    }
    
    // Check if we've already generated this schema (for circular refs)
    if (context.generated.has(schema)) {
      return context.generated.get(schema);
    }
    
    // Handle $ref - use pre-resolved schema
    if (schema.$ref) {
      const resolved = this.processedSchema.refs.resolved.get(schema.$ref);
      if (resolved) {
        // Check for circular reference
        if (context.visited.has(schema.$ref)) {
          return { "$comment": `Circular reference to ${schema.$ref}` };
        }
        
        context.visited.add(schema.$ref);
        const result = this.generateFromSchema(resolved, schema.$ref, {
          ...context,
          depth: context.depth + 1,
        });
        context.visited.delete(schema.$ref);
        return result;
      }
    }
    
    // Priority 1: Use explicit example
    if (schema.example !== undefined && this.options.useExamples !== false) {
      return schema.example;
    }
    
    // Priority 2: Use first example from examples array
    if (schema.examples && schema.examples.length > 0 && this.options.useExamples !== false) {
      return schema.examples[0];
    }
    
    // Priority 3: Use default if specified
    if (schema.default !== undefined) {
      return schema.default;
    }
    
    // Priority 4: Generate based on const
    if (schema.const !== undefined) {
      return schema.const;
    }
    
    // Priority 5: Generate based on enum
    if (schema.enum && schema.enum.length > 0) {
      return context.random.pick(schema.enum);
    }
    
    // Priority 6: Generate based on type
    const type = this.inferType(schema);
    
    switch (type) {
      case "null":
        return null;
        
      case "boolean":
        return context.random.next() > 0.5;
        
      case "integer":
      case "number":
        return this.generateNumber(schema, type === "integer", context);
        
      case "string":
        return this.generateString(schema, context);
        
      case "array":
        return this.generateArray(schema, pointer, context);
        
      case "object":
        return this.generateObject(schema, pointer, context);
        
      default:
        // If no type specified, try to infer from constraints
        if (schema.properties || schema.additionalProperties) {
          return this.generateObject(schema, pointer, context);
        }
        if (schema.items || schema.prefixItems) {
          return this.generateArray(schema, pointer, context);
        }
        // Default to object
        return {};
    }
  }
  
  /**
   * Infer type from schema
   */
  private inferType(schema: Schema): SchemaType | null {
    if (schema.type) {
      if (Array.isArray(schema.type)) {
        // Pick first non-null type
        const nonNullTypes = schema.type.filter(t => t !== "null");
        return nonNullTypes.length > 0 ? nonNullTypes[0]! : null;
      }
      return schema.type;
    }
    
    // Infer from constraints
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
  
  /**
   * Generate a number
   */
  private generateNumber(
    schema: Schema,
    integer: boolean,
    context: GenerateContext,
  ): number {
    let min = schema.minimum ?? schema.exclusiveMinimum ?? 0;
    let max = schema.maximum ?? schema.exclusiveMaximum ?? 100;
    
    if (schema.exclusiveMinimum !== undefined) {
      min = schema.exclusiveMinimum + 0.001;
    }
    if (schema.exclusiveMaximum !== undefined) {
      max = schema.exclusiveMaximum - 0.001;
    }
    
    let num = min + context.random.next() * (max - min);
    
    if (integer) {
      num = Math.floor(num);
    }
    
    // Apply multipleOf constraint
    if (schema.multipleOf) {
      num = Math.floor(num / schema.multipleOf) * schema.multipleOf;
    }
    
    return num;
  }
  
  /**
   * Generate a string
   */
  private generateString(schema: Schema, context: GenerateContext): string {
    // Handle format-specific generation
    if (schema.format && this.options.formats?.[schema.format]) {
      const formatter = this.options.formats[schema.format]!;
      return formatter(context) as string;
    }
    
    // Built-in format generators
    if (schema.format) {
      const formatted = this.generateFormat(schema.format, context);
      if (formatted !== null) return formatted;
    }
    
    // Generate based on pattern
    if (schema.pattern) {
      // Simple pattern generation - in production would use a regex reverser
      return this.generateFromPattern(schema.pattern, context);
    }
    
    // Generate random string with length constraints
    const minLength = schema.minLength ?? 1;
    const maxLength = schema.maxLength ?? 10;
    const length = minLength + Math.floor(context.random.next() * (maxLength - minLength + 1));
    
    return context.random.string(length);
  }
  
  /**
   * Generate formatted strings
   */
  private generateFormat(format: string, context: GenerateContext): string | null {
    switch (format) {
      case "date-time":
        return new Date(Date.now() - Math.floor(context.random.next() * 365 * 24 * 60 * 60 * 1000))
          .toISOString();
        
      case "date":
        return new Date(Date.now() - Math.floor(context.random.next() * 365 * 24 * 60 * 60 * 1000))
          .toISOString()
          .split("T")[0]!;
        
      case "time":
        const hours = Math.floor(context.random.next() * 24);
        const minutes = Math.floor(context.random.next() * 60);
        const seconds = Math.floor(context.random.next() * 60);
        return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        
      case "email":
        return `user${Math.floor(context.random.next() * 1000)}@example.com`;
        
      case "hostname":
        return `host${Math.floor(context.random.next() * 1000)}.example.com`;
        
      case "ipv4":
        return Array(4).fill(0).map(() => Math.floor(context.random.next() * 256)).join(".");
        
      case "ipv6":
        return Array(8).fill(0).map(() => 
          Math.floor(context.random.next() * 65536).toString(16).padStart(4, "0")
        ).join(":");
        
      case "uri":
        return `https://example.com/path${Math.floor(context.random.next() * 1000)}`;
        
      case "uuid":
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
          const r = Math.floor(context.random.next() * 16);
          const v = c === "x" ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
        
      default:
        return null;
    }
  }
  
  /**
   * Simple pattern-based string generation
   */
  private generateFromPattern(pattern: string, context: GenerateContext): string {
    // Very basic implementation - just generates a string that might match
    // In production, would use a proper regex reverser
    
    if (pattern.includes("^[a-z]+$")) {
      return context.random.string(5).toLowerCase();
    }
    if (pattern.includes("^[A-Z]+$")) {
      return context.random.string(5).toUpperCase();
    }
    if (pattern.includes("^[0-9]+$")) {
      return Math.floor(context.random.next() * 100000).toString();
    }
    
    // Default: generate alphanumeric string
    return context.random.string(8);
  }
  
  /**
   * Generate an array
   */
  private generateArray(
    schema: Schema,
    pointer: string,
    context: GenerateContext,
  ): unknown[] {
    const minItems = schema.minItems ?? 0;
    const maxItems = schema.maxItems ?? 3;
    const length = minItems + Math.floor(context.random.next() * (maxItems - minItems + 1));
    
    const array: unknown[] = [];
    
    // Store for circular reference handling
    context.generated.set(schema, array);
    
    // Generate prefix items first
    if (schema.prefixItems) {
      for (let i = 0; i < schema.prefixItems.length && i < length; i++) {
        array.push(this.generateFromSchema(
          schema.prefixItems[i]!,
          `${pointer}/prefixItems/${i}`,
          { ...context, depth: context.depth + 1 },
        ));
      }
    }
    
    // Generate remaining items
    if (schema.items && array.length < length) {
      const itemSchema = schema.items as Schema;
      for (let i = array.length; i < length; i++) {
        array.push(this.generateFromSchema(
          itemSchema,
          `${pointer}/items`,
          { ...context, depth: context.depth + 1 },
        ));
      }
    } else {
      // No item schema - generate generic items
      for (let i = array.length; i < length; i++) {
        array.push(context.random.pick([
          null,
          true,
          false,
          Math.floor(context.random.next() * 100),
          context.random.string(5),
        ]));
      }
    }
    
    // Ensure uniqueItems if required
    if (schema.uniqueItems && array.length > 1) {
      // Simple approach: regenerate duplicates
      const seen = new Set<string>();
      for (let i = 0; i < array.length; i++) {
        const serialized = JSON.stringify(array[i]);
        if (seen.has(serialized)) {
          // Regenerate this item
          if (schema.items) {
            array[i] = this.generateFromSchema(
              schema.items as Schema,
              `${pointer}/items`,
              { ...context, depth: context.depth + 1 },
            );
          } else {
            array[i] = `unique_${i}_${context.random.string(4)}`;
          }
        }
        seen.add(JSON.stringify(array[i]));
      }
    }
    
    return array;
  }
  
  /**
   * Generate an object
   */
  private generateObject(
    schema: Schema,
    pointer: string,
    context: GenerateContext,
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    
    // Store for circular reference handling
    context.generated.set(schema, obj);
    
    // Generate required properties
    if (schema.required) {
      for (const prop of schema.required) {
        if (schema.properties?.[prop]) {
          obj[prop] = this.generateFromSchema(
            schema.properties[prop],
            `${pointer}/properties/${prop}`,
            { ...context, depth: context.depth + 1 },
          );
        } else {
          // Required but no schema - generate generic value
          obj[prop] = context.random.pick([
            "string_value",
            123,
            true,
            null,
          ]);
        }
      }
    }
    
    // Generate additional properties
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (!obj.hasOwnProperty(prop)) {
          // Optional property - include based on random chance
          if (context.random.next() > 0.5) {
            obj[prop] = this.generateFromSchema(
              propSchema,
              `${pointer}/properties/${prop}`,
              { ...context, depth: context.depth + 1 },
            );
          }
        }
      }
    }
    
    // Add some additional properties if allowed
    if (schema.additionalProperties !== false) {
      const currentPropCount = Object.keys(obj).length;
      const minProps = schema.minProperties ?? 0;
      const maxProps = schema.maxProperties ?? currentPropCount + 2;
      
      // Add properties to meet minProperties
      while (Object.keys(obj).length < minProps) {
        const propName = `prop_${context.random.string(4)}`;
        if (typeof schema.additionalProperties === "object") {
          obj[propName] = this.generateFromSchema(
            schema.additionalProperties,
            `${pointer}/additionalProperties`,
            { ...context, depth: context.depth + 1 },
          );
        } else {
          obj[propName] = context.random.pick([
            "additional_value",
            42,
            false,
          ]);
        }
      }
      
      // Maybe add more properties
      if (Object.keys(obj).length < maxProps && context.random.next() > 0.7) {
        const propName = `extra_${context.random.string(4)}`;
        if (typeof schema.additionalProperties === "object") {
          obj[propName] = this.generateFromSchema(
            schema.additionalProperties,
            `${pointer}/additionalProperties`,
            { ...context, depth: context.depth + 1 },
          );
        } else {
          obj[propName] = "extra_value";
        }
      }
    }
    
    return obj;
  }
}