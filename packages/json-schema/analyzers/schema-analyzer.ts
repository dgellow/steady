/**
 * SchemaAnalyzer - Analyzes JSON Schema quality
 *
 * Checks for:
 * - $ref sibling keywords (ignored in OpenAPI 3.0.x / draft-07, but processed in 3.1.x)
 * - High complexity scores
 * - Deep nesting
 */

import type { SchemaRegistry } from "../schema-registry.ts";
import type { Analyzer } from "./ref-analyzer.ts";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/types.ts";
import { getAttribution } from "../diagnostics/attribution.ts";
import { escapeSegment } from "@steady/json-pointer";

/**
 * Keywords that are always processed as siblings to $ref (in all versions).
 * Other keywords are ignored in draft-07/OpenAPI 3.0.x but processed in 2020-12/3.1.x.
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

    // Check OpenAPI version - in 3.1.x, $ref siblings ARE processed (not ignored)
    const openapiVersion = this.getOpenAPIVersion(registry);
    const is31 = openapiVersion?.startsWith("3.1.") ?? false;

    // Check all schemas for ref siblings (only warn for 3.0.x where they're ignored)
    if (!is31) {
      diagnostics.push(...this.checkRefSiblings(registry));
    }

    // Check complexity and nesting per schema
    diagnostics.push(...this.checkSchemaComplexity(registry));

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
            message:
              `$ref has sibling keywords that will be ignored in OpenAPI 3.0.x: ${
                ignoredKeywords.join(", ")
              }`,
            attribution: getAttribution("schema-ref-siblings"),
            suggestion:
              "In OpenAPI 3.0.x (draft-07), keywords alongside $ref are ignored. " +
              "Move these keywords into the referenced schema or remove them.",
            documentation:
              "https://json-schema.org/understanding-json-schema/structuring.html#ref",
          });
        }
      }

      // Recurse into all properties
      for (const [key, val] of Object.entries(obj)) {
        if (key === "$ref") continue;
        check(val, `${pointer}/${escapeSegment(key)}`);
      }
    };

    check(document, "#");
    return diagnostics;
  }

  /**
   * Check individual schemas for complexity and nesting issues
   */
  private checkSchemaComplexity(registry: SchemaRegistry): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const document = registry.document;
    const maxComplexity = this.config.maxComplexity ?? 1000;
    const maxNesting = this.config.maxNesting ?? 20;

    // Get schemas from #/components/schemas
    const schemas = this.getComponentSchemas(document);

    for (const [name, schema] of schemas) {
      const pointer = `#/components/schemas/${escapeSegment(name)}`;
      const { complexity, nesting, complexityDetails } = this.analyzeSchema(
        schema,
      );

      if (complexity > maxComplexity) {
        diagnostics.push({
          code: "schema-complexity",
          severity: "info",
          pointer,
          message:
            `Schema '${name}' has complexity ${complexity} (threshold: ${maxComplexity})`,
          attribution: getAttribution("schema-complexity"),
          suggestion: this.formatComplexityDetails(complexityDetails),
        });
      }

      if (nesting > maxNesting) {
        diagnostics.push({
          code: "schema-nesting",
          severity: "info",
          pointer,
          message:
            `Schema '${name}' has nesting depth ${nesting} (threshold: ${maxNesting})`,
          attribution: getAttribution("schema-nesting"),
          suggestion: "Consider flattening nested structures or using $ref",
        });
      }
    }

    return diagnostics;
  }

  /**
   * Get component schemas from the document
   */
  private getComponentSchemas(
    document: unknown,
  ): Map<string, Record<string, unknown>> {
    const schemas = new Map<string, Record<string, unknown>>();

    if (typeof document !== "object" || document === null) {
      return schemas;
    }

    const doc = document as Record<string, unknown>;
    const components = doc.components;
    if (typeof components !== "object" || components === null) {
      return schemas;
    }

    const schemasObj = (components as Record<string, unknown>).schemas;
    if (typeof schemasObj !== "object" || schemasObj === null) {
      return schemas;
    }

    for (
      const [name, schema] of Object.entries(
        schemasObj as Record<string, unknown>,
      )
    ) {
      if (typeof schema === "object" && schema !== null) {
        schemas.set(name, schema as Record<string, unknown>);
      }
    }

    return schemas;
  }

  /**
   * Analyze a single schema's complexity
   */
  private analyzeSchema(schema: Record<string, unknown>): {
    complexity: number;
    nesting: number;
    complexityDetails: {
      properties: number;
      allOf: number;
      anyOf: number;
      oneOf: number;
      refs: number;
    };
  } {
    let complexity = 0;
    let maxNesting = 0;
    const details = { properties: 0, allOf: 0, anyOf: 0, oneOf: 0, refs: 0 };

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

      // Track complexity sources
      if ("properties" in obj) {
        const props = obj.properties;
        if (typeof props === "object" && props !== null) {
          details.properties += Object.keys(props).length;
        }
      }
      if ("allOf" in obj) {
        complexity += 5;
        details.allOf++;
      }
      if ("anyOf" in obj) {
        complexity += 5;
        details.anyOf++;
      }
      if ("oneOf" in obj) {
        complexity += 5;
        details.oneOf++;
      }
      if ("if" in obj) complexity += 3;
      if ("$ref" in obj) {
        complexity += 2;
        details.refs++;
      }

      for (const val of Object.values(obj)) {
        analyze(val, depth + 1);
      }
    };

    analyze(schema, 0);

    return { complexity, nesting: maxNesting, complexityDetails: details };
  }

  /**
   * Format complexity details into a suggestion
   */
  private formatComplexityDetails(details: {
    properties: number;
    allOf: number;
    anyOf: number;
    oneOf: number;
    refs: number;
  }): string {
    const parts: string[] = [];

    if (details.properties > 20) {
      parts.push(`${details.properties} properties`);
    }
    if (details.allOf > 3) {
      parts.push(`${details.allOf} allOf compositions`);
    }
    if (details.anyOf > 3) {
      parts.push(`${details.anyOf} anyOf variants`);
    }
    if (details.oneOf > 3) {
      parts.push(`${details.oneOf} oneOf variants`);
    }
    if (details.refs > 10) {
      parts.push(`${details.refs} $ref references`);
    }

    if (parts.length === 0) {
      return "Consider splitting into smaller schemas";
    }

    return `Has ${parts.join(", ")}. Consider splitting into smaller schemas`;
  }

  /**
   * Get the OpenAPI version from the document
   */
  private getOpenAPIVersion(registry: SchemaRegistry): string | undefined {
    const doc = registry.document;
    if (typeof doc === "object" && doc !== null && "openapi" in doc) {
      const version = (doc as Record<string, unknown>).openapi;
      if (typeof version === "string") {
        return version;
      }
    }
    return undefined;
  }
}
