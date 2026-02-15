/**
 * Containment-aware cycle detection for JSON Schema $ref graphs.
 *
 * Detects both $ref-chain cycles (A refs B, B refs A) and containment
 * cycles (a property refs its ancestor schema). This replaces the cycle
 * detection previously embedded in ScaleAwareRefResolver.
 *
 * Algorithm:
 * 1. Build a definition-level graph from $ref edges
 * 2. Run Tarjan's SCC to find $ref-chain cycles
 * 3. Check for ancestor-based containment cycles
 * 4. Propagate cyclicity from definitions to their ref pointers
 */

/**
 * Determine which definition "owns" a given pointer.
 *
 * If the pointer is inside a $defs block, returns the innermost $defs
 * entry path. Otherwise returns the pointer itself. This collapses
 * internal structure so that cycle detection operates at the
 * definition level rather than the individual-pointer level.
 */
export function sourceNodeFor(pointer: string): string {
  const segments = pointer.split("/");
  let lastDefEnd = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === "$defs" && i + 1 < segments.length) {
      lastDefEnd = i + 1;
    }
  }
  if (lastDefEnd >= 0) {
    return segments.slice(0, lastDefEnd + 1).join("/");
  }
  return pointer;
}

/**
 * Compute all cyclic ref pointers from a $ref edge map.
 *
 * @param edges - Map from source pointer to set of $ref target values.
 *   This is the same shape as RefGraph.edges.
 * @returns Set of all pointers involved in cycles (both source and target).
 */
export function computeCyclicRefs(
  edges: Map<string, Set<string>>,
): Set<string> {
  const cyclic = new Set<string>();

  // Step 1: Build definition-level graph
  const defEdges = new Map<string, Set<string>>();
  const allDefNodes = new Set<string>();

  for (const [pointer, targets] of edges) {
    const sourceNode = sourceNodeFor(pointer);
    allDefNodes.add(sourceNode);

    for (const target of targets) {
      allDefNodes.add(target);

      if (!defEdges.has(sourceNode)) {
        defEdges.set(sourceNode, new Set());
      }
      const targetSet = defEdges.get(sourceNode);
      if (targetSet) {
        targetSet.add(target);
      }
    }
  }

  // Step 2: Tarjan's SCC on definition-level graph
  const defLevelCyclic = tarjanSCC(allDefNodes, defEdges);

  // Step 3: Ancestor-based containment cycles
  for (const [pointer, targets] of edges) {
    for (const target of targets) {
      if (pointer.startsWith(target + "/") || pointer === target) {
        cyclic.add(pointer);
        cyclic.add(target);
      }
    }
  }

  // Step 4: Propagation - if a pointer's definition is cyclic,
  // both the pointer and its target are cyclic
  for (const [pointer, targets] of edges) {
    const sourceNode = sourceNodeFor(pointer);
    if (defLevelCyclic.has(sourceNode)) {
      cyclic.add(pointer);
      for (const target of targets) {
        cyclic.add(target);
      }
    }
  }

  return cyclic;
}

/**
 * Tarjan's strongly connected components algorithm.
 * Returns the set of all nodes that are part of an SCC with size > 1,
 * or that have a self-loop.
 */
function tarjanSCC(
  nodes: Set<string>,
  edges: Map<string, Set<string>>,
): Set<string> {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let currentIndex = 0;
  const cyclicNodes = new Set<string>();

  const strongConnect = (node: string) => {
    index.set(node, currentIndex);
    lowlink.set(node, currentIndex);
    currentIndex++;
    stack.push(node);
    onStack.add(node);

    const nodeEdges = edges.get(node);
    if (nodeEdges) {
      for (const target of nodeEdges) {
        if (!index.has(target)) {
          strongConnect(target);
          const targetLow = lowlink.get(target);
          const nodeLow = lowlink.get(node);
          if (targetLow !== undefined && nodeLow !== undefined) {
            lowlink.set(node, Math.min(nodeLow, targetLow));
          }
        } else if (onStack.has(target)) {
          const targetIdx = index.get(target);
          const nodeLow = lowlink.get(node);
          if (targetIdx !== undefined && nodeLow !== undefined) {
            lowlink.set(node, Math.min(nodeLow, targetIdx));
          }
        }
      }
    }

    // Root of SCC
    if (lowlink.get(node) === index.get(node)) {
      const scc: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w !== undefined) {
          onStack.delete(w);
          scc.push(w);
        }
      } while (w !== node);

      if (scc.length > 1) {
        for (const n of scc) {
          cyclicNodes.add(n);
        }
      } else if (scc.length === 1) {
        // Check for self-loop
        const single = scc[0];
        if (single !== undefined && edges.get(single)?.has(single)) {
          cyclicNodes.add(single);
        }
      }
    }
  };

  for (const node of nodes) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }

  return cyclicNodes;
}
