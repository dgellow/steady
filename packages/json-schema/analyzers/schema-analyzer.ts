/**
 * SchemaAnalyzer - Analyzes JSON Schema quality
 *
 * Checks for:
 * - $ref sibling keywords (ignored in JSON Schema 2020-12)
 * - High complexity scores
 * - Deep nesting
 */

import type { SchemaRegistry } from "../schema-registry.ts";
import type { Analyzer } from "./ref-analyzer.ts";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/types.ts";
import { getAttribution } from "../diagnostics/attribution.ts";

/**
 * Keywords allowed as siblings to $ref in JSON Schema 2020-12
 */
const ALLOWED_REF_SIBLINGS = new Set([
  "$id",
  "$anchor",
  "$comment",
  "$defs",
  "$ref",
]);

/**
 * Configuration for schema analysis
 */
export interface SchemaAnalyzerConfig {
  /** Complexity threshold before warning (default: 1000) */
  maxComplexity?: number;
  /** Nesting depth threshold before warning (default: 20) */
  maxNesting?: number;
}

/**
 * Analyzes JSON Schema quality
 */
export class SchemaAnalyzer implements Analyzer {
  readonly name = "SchemaAnalyzer";
  readonly codes: DiagnosticCode[] = [
    "schema-ref-siblings",
    "schema-complexity",
    "schema-nesting",
  ];

  constructor(private config: SchemaAnalyzerConfig = {}) {}

  analyze(registry: SchemaRegistry): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Check all schemas for ref siblings
    diagnostics.push(...this.checkRefSiblings(registry));

    // Check complexity and nesting
    const { complexity, maxNesting } = this.analyzeComplexity(registry);

    if (complexity > (this.config.maxComplexity ?? 1000)) {
      diagnostics.push({
        code: "schema-complexity",
        severity: "info",
        pointer: "#",
        message: `Schema complexity score is ${complexity} (threshold: ${this.config.maxComplexity ?? 1000})`,
        attribution: getAttribution("schema-complexity"),
        suggestion: "Consider simplifying schemas or splitting into smaller documents",
      });
    }

    if (maxNesting > (this.config.maxNesting ?? 20)) {
      diagnostics.push({
        code: "schema-nesting",
        severity: "info",
        pointer: "#",
        message: `Maximum schema nesting is ${maxNesting} levels (threshold: ${this.config.maxNesting ?? 20})`,
        attribution: getAttribution("schema-nesting"),
        suggestion: "Deep nesting can impact validation performance",
      });
    }

    return diagnostics;
  }

  /**
   * Check for $ref with sibling keywords that will be ignored
   */
  private checkRefSiblings(registry: SchemaRegistry): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const document = registry.document;

    // Recursively check all objects
    const check = (value: unknown, pointer: string): void => {
      if (value === null || typeof value !== "object") {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          check(item, `${pointer}/${index}`);
        });
        return;
      }

      const obj = value as Record<string, unknown>;

      // Check if this object has $ref
      if (typeof obj.$ref === "string") {
        const keywords = Object.keys(obj);
        const ignoredKeywords = keywords.filter(
          (key) => !ALLOWED_REF_SIBLINGS.has(key),
        );

        if (ignoredKeywords.length > 0) {
          diagnostics.push({
            code: "schema-ref-siblings",
            severity: "warning",
            pointer,
            message: `$ref has sibling keywords that will be ignored: ${ignoredKeywords.join(", ")}`,
            attribution: getAttribution("schema-ref-siblings"),
            suggestion:
              "Per JSON Schema 2020-12, keywords alongside $ref are ignored. " +
              "Move these keywords into the referenced schema or remove them.",
            documentation: "https://json-schema.org/draft/2020-12/json-schema-core.html#name-the-ref-keyword",
          });
        }
      }

      // Recurse into all properties
      for (const [key, val] of Object.entries(obj)) {
        if (key === "$ref") continue;
        check(val, `${pointer}/${escapePointer(key)}`);
      }
    };

    check(document, "#");
    return diagnostics;
  }

  /**
   * Analyze schema complexity
   */
  private analyzeComplexity(registry: SchemaRegistry): {
    complexity: number;
    maxNesting: number;
  } {
    let complexity = 0;
    let maxNesting = 0;
    const document = registry.document;

    const analyze = (value: unknown, depth: number): void => {
      if (value === null || typeof value !== "object") {
        return;
      }

      maxNesting = Math.max(maxNesting, depth);

      if (Array.isArray(value)) {
        complexity += value.length;
        value.forEach((item) => analyze(item, depth + 1));
        return;
      }

      const obj = value as Record<string, unknown>;
      complexity += Object.keys(obj).length;

      // Extra complexity for certain keywords
      if ("allOf" in obj) complexity += 5;
      if ("anyOf" in obj) complexity += 5;
      if ("oneOf" in obj) complexity += 5;
      if ("if" in obj) complexity += 3;
      if ("$ref" in obj) complexity += 2;

      for (const val of Object.values(obj)) {
        analyze(val, depth + 1);
      }
    };

    analyze(document, 0);

    return { complexity, maxNesting };
  }
}

/**
 * Escape special characters in JSON Pointer segment
 */
function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
