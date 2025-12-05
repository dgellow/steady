/**
 * RefGraph - Complete reference topology for a JSON document
 *
 * Builds the entire $ref dependency graph upfront, enabling:
 * - O(1) cycle detection during processing
 * - Optimal resolution order (topological sort)
 * - Global view of all references in the document
 */

export interface RefEdge {
  from: string; // JSON Pointer to schema containing the $ref
  to: string; // The $ref target
  refPointer: string; // JSON Pointer to the $ref itself
}

export class RefGraph {
  /** All $ref values found in the document */
  readonly refs: Set<string> = new Set();

  /** All edges: source pointer → set of $ref targets */
  readonly edges: Map<string, Set<string>> = new Map();

  /** Reverse edges: $ref target → set of source pointers */
  readonly reverseEdges: Map<string, Set<string>> = new Map();

  /** References that are part of cycles */
  readonly cyclicRefs: Set<string> = new Set();

  /** Detected cycles (as arrays of pointers) */
  readonly cycles: string[][] = [];

  /** All JSON Pointers to schemas in the document */
  readonly pointers: Set<string> = new Set();

  private constructor() {}

  /**
   * Build a complete RefGraph from a document.
   * Single pass through entire document.
   */
  static build(document: unknown): RefGraph {
    const graph = new RefGraph();
    graph.extract(document, "#");
    graph.detectCycles();
    return graph;
  }

  /**
   * Check if a reference is part of a cycle
   */
  isCyclic(ref: string): boolean {
    return this.cyclicRefs.has(ref);
  }

  /**
   * Get all refs that a schema at pointer depends on
   */
  getDependencies(pointer: string): Set<string> {
    return this.edges.get(pointer) ?? new Set();
  }

  /**
   * Get all schemas that depend on a ref
   */
  getDependents(ref: string): Set<string> {
    return this.reverseEdges.get(ref) ?? new Set();
  }

  /**
   * Get topologically sorted pointers for processing
   * Schemas with no dependencies come first
   */
  getProcessingOrder(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (pointer: string) => {
      if (visited.has(pointer)) return;
      if (visiting.has(pointer)) return; // Cycle - skip

      visiting.add(pointer);

      // Visit dependencies first
      const deps = this.edges.get(pointer);
      if (deps) {
        for (const dep of deps) {
          // Only visit if it's a pointer we track
          if (this.pointers.has(dep)) {
            visit(dep);
          }
        }
      }

      visiting.delete(pointer);
      visited.add(pointer);
      result.push(pointer);
    };

    for (const pointer of this.pointers) {
      visit(pointer);
    }

    return result;
  }

  /**
   * Extract all refs from the document
   */
  private extract(value: unknown, pointer: string): void {
    if (value === null || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        this.extract(item, `${pointer}/${index}`);
      });
      return;
    }

    const obj = value as Record<string, unknown>;

    // Track this pointer as a potential schema location
    this.pointers.add(pointer);

    // Check for $ref
    if (typeof obj.$ref === "string") {
      const ref = obj.$ref;
      this.refs.add(ref);

      // Add edge: this pointer references the target
      if (!this.edges.has(pointer)) {
        this.edges.set(pointer, new Set());
      }
      this.edges.get(pointer)!.add(ref);

      // Add reverse edge
      if (!this.reverseEdges.has(ref)) {
        this.reverseEdges.set(ref, new Set());
      }
      this.reverseEdges.get(ref)!.add(pointer);
    }

    // Recurse into all properties
    for (const [key, val] of Object.entries(obj)) {
      if (key === "$ref") continue; // Already handled
      this.extract(val, `${pointer}/${this.escapePointer(key)}`);
    }
  }

  /**
   * Detect cycles using Tarjan's strongly connected components
   */
  private detectCycles(): void {
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let currentIndex = 0;

    const strongConnect = (node: string) => {
      index.set(node, currentIndex);
      lowlink.set(node, currentIndex);
      currentIndex++;
      stack.push(node);
      onStack.add(node);

      const edges = this.edges.get(node);
      if (edges) {
        for (const target of edges) {
          if (!index.has(target)) {
            // Target not yet visited
            strongConnect(target);
            lowlink.set(
              node,
              Math.min(lowlink.get(node)!, lowlink.get(target)!),
            );
          } else if (onStack.has(target)) {
            // Target is on stack -> part of current SCC
            lowlink.set(node, Math.min(lowlink.get(node)!, index.get(target)!));
          }
        }
      }

      // If node is a root of an SCC
      if (lowlink.get(node) === index.get(node)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== node);

        // If SCC has more than one node, it's a cycle
        if (scc.length > 1) {
          this.cycles.push(scc);
          for (const ref of scc) {
            this.cyclicRefs.add(ref);
          }
        } // Also detect self-references
        else if (scc.length === 1 && this.edges.get(scc[0]!)?.has(scc[0]!)) {
          this.cycles.push(scc);
          this.cyclicRefs.add(scc[0]!);
        }
      }
    };

    // Run on all nodes
    for (const node of this.pointers) {
      if (!index.has(node)) {
        strongConnect(node);
      }
    }
    // Also check refs that might not be in pointers
    for (const ref of this.refs) {
      if (!index.has(ref)) {
        strongConnect(ref);
      }
    }
  }

  /**
   * Escape special characters in JSON Pointer segments
   */
  private escapePointer(segment: string): string {
    return segment.replace(/~/g, "~0").replace(/\//g, "~1");
  }
}
