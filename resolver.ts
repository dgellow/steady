import { ReferenceGraph, ResolvedSchema } from "./types.ts";
import type { OpenAPISpec, SchemaObject } from "@steady/parser";
import { circularReferenceError, ReferenceError } from "./errors.ts";

// Build a graph of all references in the spec
export function buildReferenceGraph(spec: OpenAPISpec): ReferenceGraph {
  const graph: ReferenceGraph = {
    nodes: new Map(),
    edges: new Map(),
    cycles: [],
  };

  // Helper to add a node and its references
  function addNode(ref: string, schema: SchemaObject) {
    if (!graph.nodes.has(ref)) {
      graph.nodes.set(ref, schema);
      graph.edges.set(ref, new Set());
    }

    // Find all $refs in this schema
    const refs = findReferences(schema);
    for (const childRef of refs) {
      graph.edges.get(ref)!.add(childRef);
    }
  }

  // Process all schemas in components
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      const ref = `#/components/schemas/${name}`;
      addNode(ref, schema);
    }
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function detectCycle(node: string, path: string[] = []): string[] | null {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const edges = graph.edges.get(node) || new Set();
    for (const neighbor of edges) {
      if (!visited.has(neighbor)) {
        const cycle = detectCycle(neighbor, [...path]);
        if (cycle) return cycle;
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        return path.slice(cycleStart);
      }
    }

    recursionStack.delete(node);
    return null;
  }

  // Find all cycles
  for (const node of graph.nodes.keys()) {
    if (!visited.has(node)) {
      const cycle = detectCycle(node);
      if (cycle) {
        graph.cycles.push(new Set(cycle));
      }
    }
  }

  return graph;
}

// Find all $ref strings in a schema
function findReferences(schema: SchemaObject): string[] {
  const refs: string[] = [];

  function traverse(obj: unknown) {
    if (!obj || typeof obj !== "object") return;

    if ("$ref" in obj && typeof obj.$ref === "string") {
      refs.push(obj.$ref);
    }

    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        value.forEach(traverse);
      } else if (typeof value === "object" && value !== null) {
        traverse(value);
      }
    }
  }

  traverse(schema);
  return refs;
}

// Resolve a $ref to its schema
export function resolveRef(
  ref: string,
  spec: OpenAPISpec,
  visitedRefs: Set<string> = new Set(),
): ResolvedSchema {
  // Check for circular reference
  if (visitedRefs.has(ref)) {
    throw circularReferenceError(ref, Array.from(visitedRefs));
  }

  // Parse the reference
  if (!ref.startsWith("#/")) {
    throw new ReferenceError("External references not supported", {
      errorType: "reference",
      reason: `Reference "${ref}" points to an external file`,
      suggestion:
        "Steady currently only supports local references starting with '#/'",
      examples: [
        "$ref: '#/components/schemas/User'",
        "$ref: '#/components/responses/NotFound'",
      ],
    });
  }

  // Split the path
  const parts = ref.substring(2).split("/");
  let current: unknown = spec;

  // Navigate to the referenced schema
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (
      !part || !current || typeof current !== "object" || !(part in current)
    ) {
      throw new ReferenceError("Invalid reference", {
        errorType: "reference",
        schemaPath: parts.slice(0, i + 1),
        reason: `Reference "${ref}" not found in spec`,
        suggestion: "Check that the reference path is correct",
        examples: [
          "Common reference paths:",
          "  #/components/schemas/ModelName",
          "  #/components/responses/ResponseName",
          "  #/components/parameters/ParameterName",
        ],
      });
    }
    current = (current as Record<string, unknown>)[part];
  }

  // If the resolved schema has a $ref, resolve it recursively
  const resolvedCurrent = current as Record<string, unknown>;
  if (resolvedCurrent.$ref && typeof resolvedCurrent.$ref === "string") {
    const newVisited = new Set(visitedRefs);
    newVisited.add(ref);
    return resolveRef(resolvedCurrent.$ref, spec, newVisited);
  }

  // Return resolved schema
  return {
    ...(resolvedCurrent as SchemaObject),
    resolvedFrom: ref,
  };
}

// Resolve all schemas in a spec upfront
export function resolveAllSchemas(
  spec: OpenAPISpec,
  refGraph: ReferenceGraph,
): Map<string, ResolvedSchema> {
  const resolved = new Map<string, ResolvedSchema>();
  const errors: ReferenceError[] = [];

  // Process each schema
  for (const [ref, schema] of refGraph.nodes) {
    try {
      // Check if this ref is part of a cycle
      const isInCycle = refGraph.cycles.some((cycle) => cycle.has(ref));

      if (isInCycle) {
        // For schemas in cycles, we'll handle them specially during generation
        resolved.set(ref, {
          ...schema,
          resolvedFrom: ref,
        });
      } else {
        // Resolve normally
        const resolvedSchema = resolveRef(ref, spec);
        resolved.set(ref, resolvedSchema);
      }
    } catch (error) {
      if (error instanceof ReferenceError) {
        errors.push(error);
      } else {
        throw error;
      }
    }
  }

  // If we have errors, throw the first one
  // In a full implementation, we'd collect and report all errors
  if (errors.length > 0) {
    throw errors[0];
  }

  return resolved;
}

// Helper to check if a schema or any of its nested schemas contains a reference to a cycle
export function containsCycle(
  schema: SchemaObject,
  refGraph: ReferenceGraph,
): boolean {
  const refs = findReferences(schema);
  return refs.some((ref) => refGraph.cycles.some((cycle) => cycle.has(ref)));
}
