import { GenerationContext, ReferenceGraph } from "./types.ts";
import type {
  MediaTypeObject,
  OpenAPISpec,
  SchemaObject,
} from "@steady/parser";
import { GenerationError } from "./errors.ts";
import { containsCycle, resolveRef } from "./resolver.ts";

// Generate an example from a media type object
export function generateFromMediaType(
  mediaType: MediaTypeObject,
  spec: OpenAPISpec,
  refGraph: ReferenceGraph,
): unknown {
  // Priority 1: Use explicit example
  if (mediaType.example !== undefined) {
    return mediaType.example;
  }

  // Priority 2: Use first example from examples
  if (mediaType.examples && Object.keys(mediaType.examples).length > 0) {
    const firstExample = Object.values(mediaType.examples)[0];
    if (firstExample && firstExample.value !== undefined) {
      return firstExample.value;
    }
  }

  // Priority 3: Generate from schema
  if (mediaType.schema) {
    const context: GenerationContext = {
      depth: 0,
      maxDepth: 10,
      visitedRefs: new Set(),
      generatedObjects: new WeakMap(),
      spec,
    };

    return generateFromSchema(mediaType.schema, context, refGraph);
  }

  // No way to generate
  throw new GenerationError("Cannot generate response", {
    errorType: "generate",
    reason: "No example or schema provided for response",
    suggestion: "Add either an example or a schema to your response definition",
  });
}

// Generate an example from a schema
export function generateFromSchema(
  schema: SchemaObject,
  context: GenerationContext,
  refGraph: ReferenceGraph,
): unknown {
  // Check depth limit
  if (context.depth > context.maxDepth) {
    return null; // Truncate at max depth
  }

  // Handle $ref
  if (schema.$ref) {
    // Check if we're in a cycle
    if (context.visitedRefs.has(schema.$ref)) {
      // Return a marker for circular reference
      return {
        "$comment": `Circular reference to ${schema.$ref} (truncated)`,
        "...": "truncated for recursion",
      };
    }

    // Add to visited and resolve
    const newContext = {
      ...context,
      depth: context.depth + 1,
      visitedRefs: new Set(context.visitedRefs).add(schema.$ref),
    };

    try {
      const resolved = resolveRef(schema.$ref, context.spec);
      return generateFromSchema(resolved, newContext, refGraph);
    } catch (_error) {
      // If resolution fails, return error marker
      return { "$error": `Failed to resolve ${schema.$ref}` };
    }
  }

  // Use memoization for objects to handle shared references
  if (schema.type === "object" && context.generatedObjects.has(schema)) {
    return context.generatedObjects.get(schema);
  }

  // Use explicit example if provided
  if (schema.example !== undefined) {
    return schema.example;
  }

  // Generate based on type
  switch (schema.type) {
    case "string":
      return generateString(schema);

    case "number":
    case "integer":
      return generateNumber(schema);

    case "boolean":
      return true;

    case "array":
      return generateArray(schema, context, refGraph);

    case "object":
      return generateObject(schema, context, refGraph);

    case "null":
      return null;

    default:
      // If no type specified, try to infer from other constraints
      if (schema.properties) {
        return generateObject(schema, context, refGraph);
      }
      if (schema.items) {
        return generateArray(schema, context, refGraph);
      }
      // Default to null
      return null;
  }
}

function generateString(schema: SchemaObject): string {
  if (schema.format === "date") {
    return "2024-01-01";
  }
  if (schema.format === "date-time") {
    return "2024-01-01T12:00:00Z";
  }
  if (schema.format === "email") {
    return "user@example.com";
  }
  if (schema.format === "uri" || schema.format === "url") {
    return "https://example.com";
  }
  if (schema.format === "uuid") {
    return "123e4567-e89b-12d3-a456-426614174000";
  }

  // Use minLength to generate appropriate length
  const minLength = schema.minLength || 0;
  const maxLength = schema.maxLength || 50;
  const targetLength = Math.min(minLength + 5, maxLength);

  return "string".padEnd(targetLength, "_value");
}

function generateNumber(schema: SchemaObject): number {
  const min = schema.minimum ?? 0;
  const max = schema.maximum ?? 100;

  if (schema.type === "integer") {
    return Math.floor((min + max) / 2);
  }

  return (min + max) / 2;
}

function generateArray(
  schema: SchemaObject,
  context: GenerationContext,
  refGraph: ReferenceGraph,
): unknown[] {
  if (!schema.items) {
    return [];
  }

  const minItems = schema.minItems || 0;
  const maxItems = schema.maxItems || 3;

  // For recursive schemas, limit array size
  const hasRecursion = containsCycle(schema.items, refGraph);
  const targetSize = hasRecursion
    ? Math.min(2, maxItems)
    : Math.min(minItems + 1, maxItems);

  const result: unknown[] = [];
  const newContext = {
    ...context,
    depth: context.depth + 1,
  };

  for (let i = 0; i < targetSize; i++) {
    result.push(generateFromSchema(schema.items, newContext, refGraph));
  }

  return result;
}

function generateObject(
  schema: SchemaObject,
  context: GenerationContext,
  refGraph: ReferenceGraph,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Memoize to handle shared references
  context.generatedObjects.set(schema, result);

  const newContext = {
    ...context,
    depth: context.depth + 1,
  };

  // Generate properties
  if (schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      // Skip optional properties in recursive contexts to limit size
      const isRequired = schema.required?.includes(propName);
      const hasRecursion = containsCycle(propSchema, refGraph);

      if (hasRecursion && !isRequired && context.depth > 3) {
        continue; // Skip optional recursive properties at depth
      }

      result[propName] = generateFromSchema(propSchema, newContext, refGraph);
    }
  }

  // Handle additionalProperties
  if (schema.additionalProperties === true) {
    result.additionalProp1 = "string";
  } else if (
    typeof schema.additionalProperties === "object" &&
    schema.additionalProperties !== null
  ) {
    result.additionalProp1 = generateFromSchema(
      schema.additionalProperties,
      newContext,
      refGraph,
    );
  }

  return result;
}
