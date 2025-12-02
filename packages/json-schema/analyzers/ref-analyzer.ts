/**
 * RefAnalyzer - Analyzes reference topology for issues
 *
 * Uses the RefGraph to detect:
 * - Unresolved references
 * - Circular references
 * - Deep reference chains
 */

import type { RefGraph } from "../ref-graph.ts";
import type { SchemaRegistry } from "../schema-registry.ts";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/types.ts";
import { getAttribution } from "../diagnostics/attribution.ts";

/**
 * Analyzer interface - each analyzer handles one category of checks
 */
export interface Analyzer {
  readonly name: string;
  readonly codes: DiagnosticCode[];
  analyze(registry: SchemaRegistry): Diagnostic[];
}

/**
 * Configuration for ref analysis
 */
export interface RefAnalyzerConfig {
  /** Maximum reference chain depth before warning (default: 10) */
  maxChainDepth?: number;
}

/**
 * Analyzes reference topology for issues
 */
export class RefAnalyzer implements Analyzer {
  readonly name = "RefAnalyzer";
  readonly codes: DiagnosticCode[] = ["ref-unresolved", "ref-cycle", "ref-deep-chain"];

  constructor(private config: RefAnalyzerConfig = {}) {}

  analyze(registry: SchemaRegistry): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const refGraph = registry.refGraph;

    // Check for unresolved references
    diagnostics.push(...this.checkUnresolvedRefs(registry, refGraph));

    // Check for cycles
    diagnostics.push(...this.checkCycles(refGraph));

    // Check for deep chains
    diagnostics.push(...this.checkDeepChains(refGraph));

    return diagnostics;
  }

  /**
   * Check for $refs that don't resolve to anything
   */
  private checkUnresolvedRefs(
    registry: SchemaRegistry,
    refGraph: RefGraph,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const ref of refGraph.refs) {
      // Skip non-local refs (external URLs)
      if (!ref.startsWith("#")) {
        continue;
      }

      // Try to resolve
      const resolved = registry.resolve(ref);
      if (resolved === undefined) {
        diagnostics.push({
          code: "ref-unresolved",
          severity: "error",
          pointer: ref,
          message: `Reference "${ref}" cannot be resolved`,
          attribution: getAttribution("ref-unresolved"),
          suggestion: `Check that the path "${ref}" exists in your OpenAPI spec`,
        });
      }
    }

    return diagnostics;
  }

  /**
   * Check for circular references
   */
  private checkCycles(refGraph: RefGraph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const cycle of refGraph.cycles) {
      // Create a diagnostic for each cycle
      const cycleStr = cycle.length > 3
        ? `${cycle.slice(0, 3).join(" → ")} → ... (${cycle.length} refs)`
        : cycle.join(" → ");

      diagnostics.push({
        code: "ref-cycle",
        severity: "warning",
        pointer: cycle[0] ?? "#",
        message: `Circular reference detected: ${cycleStr}`,
        attribution: getAttribution("ref-cycle"),
        suggestion: "Circular references are handled gracefully but may indicate overly complex schemas",
        related: cycle.slice(1).map((ref) => ({
          pointer: ref,
          message: "Part of cycle",
        })),
      });
    }

    return diagnostics;
  }

  /**
   * Check for very deep reference chains
   */
  private checkDeepChains(refGraph: RefGraph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const maxDepth = this.config.maxChainDepth ?? 10;
    const visited = new Map<string, number>();

    // Calculate depth for each ref
    const getDepth = (ref: string, seen: Set<string>): number => {
      if (seen.has(ref)) return 0; // Cycle - don't count
      if (visited.has(ref)) return visited.get(ref)!;

      seen.add(ref);
      const deps = refGraph.edges.get(ref);
      let maxChildDepth = 0;

      if (deps) {
        for (const dep of deps) {
          const childDepth = getDepth(dep, new Set(seen));
          maxChildDepth = Math.max(maxChildDepth, childDepth);
        }
      }

      const depth = maxChildDepth + 1;
      visited.set(ref, depth);
      return depth;
    };

    // Check all refs
    for (const pointer of refGraph.pointers) {
      const depth = getDepth(pointer, new Set());
      if (depth > maxDepth) {
        diagnostics.push({
          code: "ref-deep-chain",
          severity: "info",
          pointer,
          message: `Reference chain depth is ${depth} (threshold: ${maxDepth})`,
          attribution: getAttribution("ref-deep-chain"),
          suggestion: "Consider flattening deep reference chains for better performance",
        });
      }
    }

    return diagnostics;
  }
}
