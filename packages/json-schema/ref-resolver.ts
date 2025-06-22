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
  /** Anchor registry for location-independent identifiers */
  anchors: Map<string, Schema | boolean>;
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
      visited: new Set(),
      anchors: new Map()
    };
    
    // Collect all anchors during initialization
    this.collectAnchors(rootSchema);
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
   * Determine the type of reference
   */
  private getRefType(ref: string): 'root' | 'pointer' | 'anchor' | 'external' {
    if (ref === '#') return 'root';
    if (ref.startsWith('#/')) return 'pointer';
    if (ref.startsWith('#')) return 'anchor';
    return 'external';
  }

  /**
   * Resolve internal reference (root, pointer, or anchor)
   */
  private resolveInternalRef(ref: string): ResolvedReference {
    const refType = this.getRefType(ref);
    
    switch (refType) {
      case 'root':
        return {
          schema: this.context.rootSchema,
          resolved: true
        };
      
      case 'pointer':
        return this.resolvePointer(ref);
        
      case 'anchor':
        return this.resolveAnchor(ref);
        
      default:
        return {
          schema: false,
          resolved: false,
          error: `Invalid internal reference: ${ref}`
        };
    }
  }

  /**
   * Resolve JSON Pointer reference (#/path/to/schema)
   */
  private resolvePointer(ref: string): ResolvedReference {
    // Check for circular references
    if (this.context.visited.has(ref)) {
      return {
        schema: false,
        resolved: false,
        error: `Circular reference detected: ${ref}`
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
   * Resolve anchor reference (#anchorName)
   */
  private resolveAnchor(ref: string): ResolvedReference {
    // Extract anchor name (remove #)
    const anchorName = ref.slice(1);
    
    // Look up in anchor registry
    const schema = this.context.anchors.get(anchorName);
    
    if (schema !== undefined) {
      return {
        schema,
        resolved: true
      };
    }
    
    return {
      schema: false,
      resolved: false,
      error: `Anchor not found: ${anchorName}`
    };
  }

  /**
   * Collect all $anchor definitions in the schema tree
   * Populates the anchor registry for location-independent references
   */
  private collectAnchors(schema: Schema | boolean, currentPath: string = ""): void {
    if (typeof schema === 'boolean') {
      return;
    }

    // Register this schema if it has an $anchor
    if (schema.$anchor) {
      this.context.anchors.set(schema.$anchor, schema);
    }

    // Recursively collect anchors from all sub-schemas
    
    // Check $defs
    if (schema.$defs) {
      for (const [key, subSchema] of Object.entries(schema.$defs)) {
        this.collectAnchors(subSchema, `${currentPath}/$defs/${key}`);
      }
    }

    // Check properties
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        this.collectAnchors(subSchema, `${currentPath}/properties/${key}`);
      }
    }

    // Check patternProperties
    if (schema.patternProperties) {
      for (const [pattern, subSchema] of Object.entries(schema.patternProperties)) {
        this.collectAnchors(subSchema, `${currentPath}/patternProperties/${pattern}`);
      }
    }

    // Check additionalProperties
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      this.collectAnchors(schema.additionalProperties, `${currentPath}/additionalProperties`);
    }

    // Check items
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      this.collectAnchors(schema.items, `${currentPath}/items`);
    } else if (Array.isArray(schema.items)) {
      schema.items.forEach((subSchema, index) => {
        this.collectAnchors(subSchema, `${currentPath}/items/${index}`);
      });
    }

    // Check prefixItems
    if (schema.prefixItems) {
      schema.prefixItems.forEach((subSchema, index) => {
        this.collectAnchors(subSchema, `${currentPath}/prefixItems/${index}`);
      });
    }

    // Check additionalItems (deprecated in 2020-12, but may exist in legacy schemas)
    if ('additionalItems' in schema && schema.additionalItems && typeof schema.additionalItems === 'object') {
      this.collectAnchors(schema.additionalItems as Schema, `${currentPath}/additionalItems`);
    }

    // Check contains
    if (schema.contains && typeof schema.contains === 'object') {
      this.collectAnchors(schema.contains, `${currentPath}/contains`);
    }

    // Check allOf
    if (schema.allOf) {
      schema.allOf.forEach((subSchema, index) => {
        this.collectAnchors(subSchema, `${currentPath}/allOf/${index}`);
      });
    }

    // Check anyOf
    if (schema.anyOf) {
      schema.anyOf.forEach((subSchema, index) => {
        this.collectAnchors(subSchema, `${currentPath}/anyOf/${index}`);
      });
    }

    // Check oneOf
    if (schema.oneOf) {
      schema.oneOf.forEach((subSchema, index) => {
        this.collectAnchors(subSchema, `${currentPath}/oneOf/${index}`);
      });
    }

    // Check not
    if (schema.not && typeof schema.not === 'object') {
      this.collectAnchors(schema.not, `${currentPath}/not`);
    }

    // Check if
    if (schema.if && typeof schema.if === 'object') {
      this.collectAnchors(schema.if, `${currentPath}/if`);
    }

    // Check then
    if (schema.then && typeof schema.then === 'object') {
      this.collectAnchors(schema.then, `${currentPath}/then`);
    }

    // Check else
    if (schema.else && typeof schema.else === 'object') {
      this.collectAnchors(schema.else, `${currentPath}/else`);
    }

    // Check dependentSchemas
    if (schema.dependentSchemas) {
      for (const [key, subSchema] of Object.entries(schema.dependentSchemas)) {
        this.collectAnchors(subSchema, `${currentPath}/dependentSchemas/${key}`);
      }
    }

    // Check propertyNames
    if (schema.propertyNames && typeof schema.propertyNames === 'object') {
      this.collectAnchors(schema.propertyNames, `${currentPath}/propertyNames`);
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
      for (const [, subSchema] of Object.entries(schema.$defs)) {
        const found = this.findSchemaById(subSchema, targetId);
        if (found) return found;
      }
    }
    
    // Search in properties
    if (schema.properties) {
      for (const [, subSchema] of Object.entries(schema.properties)) {
        const found = this.findSchemaById(subSchema, targetId);
        if (found) return found;
      }
    }
    
    // Search in other schema locations
    if (schema.items && typeof schema.items === 'object') {
      if (Array.isArray(schema.items)) {
        for (const subSchema of schema.items) {
          const found = this.findSchemaById(subSchema, targetId);
          if (found) return found;
        }
      } else {
        const found = this.findSchemaById(schema.items, targetId);
        if (found) return found;
      }
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