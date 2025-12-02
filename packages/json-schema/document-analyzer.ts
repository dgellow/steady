/**
 * DocumentAnalyzer - Orchestrates static analysis of OpenAPI documents
 *
 * Runs all registered analyzers and collects diagnostics.
 * This is the main entry point for static analysis.
 */

import type { SchemaRegistry } from "./schema-registry.ts";
import type { Diagnostic } from "./diagnostics/types.ts";
import type { Analyzer } from "./analyzers/ref-analyzer.ts";
import { RefAnalyzer } from "./analyzers/ref-analyzer.ts";
import { SchemaAnalyzer } from "./analyzers/schema-analyzer.ts";
import { MockAnalyzer } from "./analyzers/mock-analyzer.ts";

/**
 * Configuration for document analysis
 */
export interface DocumentAnalyzerConfig {
  /** Enable/disable specific analyzers */
  analyzers?: {
    ref?: boolean;
    schema?: boolean;
    mock?: boolean;
  };
  /** RefAnalyzer config */
  refConfig?: {
    maxChainDepth?: number;
  };
  /** SchemaAnalyzer config */
  schemaConfig?: {
    maxComplexity?: number;
    maxNesting?: number;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<DocumentAnalyzerConfig> = {
  analyzers: {
    ref: true,
    schema: true,
    mock: true,
  },
  refConfig: {
    maxChainDepth: 10,
  },
  schemaConfig: {
    maxComplexity: 1000,
    maxNesting: 20,
  },
};

/**
 * Orchestrates static analysis of OpenAPI documents
 */
export class DocumentAnalyzer {
  private analyzers: Analyzer[] = [];

  constructor(config: DocumentAnalyzerConfig = {}) {
    const merged = {
      analyzers: { ...DEFAULT_CONFIG.analyzers, ...config.analyzers },
      refConfig: { ...DEFAULT_CONFIG.refConfig, ...config.refConfig },
      schemaConfig: { ...DEFAULT_CONFIG.schemaConfig, ...config.schemaConfig },
    };

    // Register enabled analyzers
    if (merged.analyzers.ref) {
      this.analyzers.push(new RefAnalyzer(merged.refConfig));
    }
    if (merged.analyzers.schema) {
      this.analyzers.push(new SchemaAnalyzer(merged.schemaConfig));
    }
    if (merged.analyzers.mock) {
      this.analyzers.push(new MockAnalyzer());
    }
  }

  /**
   * Analyze a schema registry and return all diagnostics
   */
  analyze(registry: SchemaRegistry): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analyzer of this.analyzers) {
      try {
        const results = analyzer.analyze(registry);
        diagnostics.push(...results);
      } catch (error) {
        // Don't let one analyzer failure break everything
        console.error(`Analyzer ${analyzer.name} failed:`, error);
      }
    }

    // Sort by severity (errors first)
    return this.sortDiagnostics(diagnostics);
  }

  /**
   * Sort diagnostics by severity
   */
  private sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
    const severityOrder = { error: 0, warning: 1, info: 2, hint: 3 };
    return [...diagnostics].sort((a, b) => {
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Get list of registered analyzer names
   */
  getAnalyzerNames(): string[] {
    return this.analyzers.map((a) => a.name);
  }
}

/**
 * Convenience function to analyze a registry with default config
 */
export function analyzeDocument(
  registry: SchemaRegistry,
  config?: DocumentAnalyzerConfig,
): Diagnostic[] {
  const analyzer = new DocumentAnalyzer(config);
  return analyzer.analyze(registry);
}
