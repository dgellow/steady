/**
 * JSON Schema Reference Resolver
 * Handles $ref resolution for JSON Schema validation
 * 
 * Designed for future performance optimization:
 * - Separation of resolution logic from caching
 * - Interface supports both eager and lazy resolution
 * - Path-oriented design enables efficient memoization
 */

import { resolve, JsonPointerError } from "../json-pointer/mod.ts";
import type { Schema } from "./types.ts";

export interface ResolverContext {
  /** Root document being validated */
  rootSchema: Schema | boolean;
  /** Current resolution path (for circular reference detection) */
  resolutionPath: string[];
  /** Base URI for relative references */
  baseUri?: string;
  /** Visited references (for circular detection) */
  visited: Set<string>;
}

export interface ResolvedReference {
  /** The resolved schema */
  schema: Schema | boolean;
  /** Whether this reference was resolved successfully */
  resolved: boolean;
  /** Error message if resolution failed */
  error?: string;
}

export class RefResolver {
  private readonly context: ResolverContext;

  constructor(rootSchema: Schema | boolean, baseUri?: string) {
    this.context = {
      rootSchema,
      resolutionPath: [],
      baseUri,
      visited: new Set()
    };
  }

  /**
   * Resolve a $ref within the current context
   * Designed to be easily cacheable/memoizable later
   */
  resolve(ref: string): ResolvedReference {
    // Handle different types of references
    if (ref.startsWith('#')) {
      return this.resolveInternalRef(ref);
    }
    
    if (this.isExternalRef(ref)) {
      return this.resolveExternalRef(ref);
    }
    
    // Handle relative $id references (e.g., "node" should find schema with $id: "node")
    const idRef = this.resolveIdReference(ref);
    if (idRef.resolved) {
      return idRef;
    }

    return {
      schema: false,
      resolved: false,
      error: `Invalid reference format: ${ref}`
    };
  }

  /**
   * Resolve internal JSON Pointer reference (#/path/to/schema)
   */
  private resolveInternalRef(ref: string): ResolvedReference {
    // Check for circular references
    if (this.context.visited.has(ref)) {
      return {
        schema: false,
        resolved: false,
        error: `Circular reference detected: ${ref}`
      };
    }

    // Root reference (#)
    if (ref === '#') {
      return {
        schema: this.context.rootSchema,
        resolved: true
      };
    }

    // JSON Pointer reference (#/path)
    const pointer = ref.slice(1); // Remove '#'
    
    try {
      // Add to visited set for circular detection
      this.context.visited.add(ref);
      this.context.resolutionPath.push(ref);

      const resolved = resolve(this.context.rootSchema, pointer);
      
      // Clean up tracking
      this.context.visited.delete(ref);
      this.context.resolutionPath.pop();

      return {
        schema: resolved as Schema | boolean,
        resolved: true
      };
    } catch (error) {
      // Clean up tracking on error
      this.context.visited.delete(ref);
      this.context.resolutionPath.pop();

      if (error instanceof JsonPointerError) {
        return {
          schema: false,
          resolved: false,
          error: `Reference not found: ${ref} (${error.message})`
        };
      }

      return {
        schema: false,
        resolved: false,
        error: `Failed to resolve reference: ${ref}`
      };
    }
  }

  /**
   * Handle external references (http://..., relative paths, etc.)
   * For now, return unresolved - can be extended later with HTTP fetching
   */
  private resolveExternalRef(ref: string): ResolvedReference {
    // TODO: Implement external reference resolution
    // This would involve:
    // 1. Fetching external documents
    // 2. Parsing and validating them
    // 3. Resolving any fragments (#/path)
    // 4. Caching results
    
    return {
      schema: true, // For now, assume external refs are valid (fail open)
      resolved: false,
      error: `External references not yet supported: ${ref}`
    };
  }

  /**
   * Resolve $id references within the current document
   * Searches for schemas with matching $id values
   */
  private resolveIdReference(ref: string): ResolvedReference {
    const found = this.findSchemaById(this.context.rootSchema, ref);
    
    if (found) {
      return {
        schema: found,
        resolved: true
      };
    }
    
    return {
      schema: false,
      resolved: false,
      error: `Schema with $id "${ref}" not found`
    };
  }

  /**
   * Recursively search for a schema with the given $id
   */
  private findSchemaById(schema: Schema | boolean, targetId: string): Schema | boolean | null {
    if (typeof schema === 'boolean') {
      return null;
    }
    
    // Check if this schema has the target $id (exact match or ends with target)
    if (schema.$id === targetId || (schema.$id && schema.$id.endsWith('/' + targetId))) {
      return schema;
    }
    
    // Search in $defs
    if (schema.$defs) {
      for (const [key, subSchema] of Object.entries(schema.$defs)) {
        const found = this.findSchemaById(subSchema, targetId);
        if (found) return found;
      }
    }
    
    // Search in properties
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        const found = this.findSchemaById(subSchema, targetId);
        if (found) return found;
      }
    }
    
    // Search in other schema locations
    if (schema.items && typeof schema.items === 'object') {
      const found = this.findSchemaById(schema.items, targetId);
      if (found) return found;
    }
    
    if (schema.allOf) {
      for (const subSchema of schema.allOf) {
        const found = this.findSchemaById(subSchema, targetId);
        if (found) return found;
      }
    }
    
    if (schema.anyOf) {
      for (const subSchema of schema.anyOf) {
        const found = this.findSchemaById(subSchema, targetId);
        if (found) return found;
      }
    }
    
    if (schema.oneOf) {
      for (const subSchema of schema.oneOf) {
        const found = this.findSchemaById(subSchema, targetId);
        if (found) return found;
      }
    }
    
    return null;
  }

  private isExternalRef(ref: string): boolean {
    return ref.startsWith('http://') || 
           ref.startsWith('https://') || 
           (!ref.startsWith('#') && ref.includes('/'));
  }

  /**
   * Create a new resolver context for a sub-schema
   * Used when resolving references within resolved schemas
   */
  createSubContext(newBaseUri?: string): RefResolver {
    return new RefResolver(this.context.rootSchema, newBaseUri || this.context.baseUri);
  }

  /**
   * Get current resolution path (useful for debugging)
   */
  getResolutionPath(): string[] {
    return [...this.context.resolutionPath];
  }
}

/**
 * Utility function to resolve a reference within a schema
 * This is the main API that the validator will use
 */
export function resolveRef(
  ref: string, 
  rootSchema: Schema | boolean,
  baseUri?: string
): ResolvedReference {
  const resolver = new RefResolver(rootSchema, baseUri);
  return resolver.resolve(ref);
}

/**
 * Check if a schema contains any $ref that needs resolution
 * Useful for optimization - skip ref resolution for schemas without refs
 */
export function hasRefs(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) {
    return false;
  }

  if (Array.isArray(schema)) {
    return schema.some(hasRefs);
  }

  const obj = schema as Record<string, unknown>;
  
  if ('$ref' in obj) {
    return true;
  }

  return Object.values(obj).some(hasRefs);
}

/**
 * Design notes for future optimization:
 * 
 * 1. **Caching layer**: Add a Map<string, ResolvedReference> cache
 * 2. **Lazy resolution**: Only resolve refs when validation reaches them
 * 3. **Batch resolution**: Collect all refs first, resolve in parallel
 * 4. **Schema compilation**: Pre-resolve all refs and inline them
 * 5. **External reference loading**: Add HTTP fetching with caching
 * 
 * The current design supports all these optimizations without API changes.
 */