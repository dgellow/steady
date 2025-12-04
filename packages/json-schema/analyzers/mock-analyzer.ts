/**
 * MockAnalyzer - Analyzes mock server readiness
 *
 * Checks for:
 * - Missing examples (will use generated data)
 * - Missing schemas (can't generate meaningful response)
 */

import type { SchemaRegistry } from "../schema-registry.ts";
import type { Analyzer } from "./ref-analyzer.ts";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/types.ts";
import { getAttribution } from "../diagnostics/attribution.ts";

/**
 * Content types that typically don't have schemas (binary, non-JSON)
 */
const BINARY_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/x-protobuf",
  "application/x-protobuffer",
  "application/graphql",
  "application/xml",
  "text/xml",
  "text/plain",
  "text/html",
  "text/csv",
]);

/**
 * Check if content type is binary/non-structured
 */
function isBinaryContentType(contentType: string): boolean {
  if (BINARY_CONTENT_TYPES.has(contentType)) return true;
  if (contentType.startsWith("image/")) return true;
  if (contentType.startsWith("audio/")) return true;
  if (contentType.startsWith("video/")) return true;
  if (contentType.startsWith("font/")) return true;
  return false;
}

/**
 * Analyzes mock server readiness
 */
export class MockAnalyzer implements Analyzer {
  readonly name = "MockAnalyzer";
  readonly codes: DiagnosticCode[] = ["mock-no-example", "mock-no-schema"];

  analyze(registry: SchemaRegistry): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const document = registry.document;

    // Check if this is an OpenAPI spec
    if (!this.isOpenAPISpec(document)) {
      return diagnostics;
    }

    const spec = document as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown> | undefined;

    if (!paths) {
      return diagnostics;
    }

    // Check each path and operation
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;

      const methods = ["get", "post", "put", "patch", "delete", "options", "head"];
      for (const method of methods) {
        const operation = (pathItem as Record<string, unknown>)[method];
        if (!operation || typeof operation !== "object") continue;

        const opObj = operation as Record<string, unknown>;
        const responses = opObj.responses as Record<string, unknown> | undefined;

        if (!responses) continue;

        // Check each response
        for (const [statusCode, response] of Object.entries(responses)) {
          if (!response || typeof response !== "object") continue;

          const respObj = response as Record<string, unknown>;
          const content = respObj.content as Record<string, unknown> | undefined;

          // Skip responses without content (e.g., 204 No Content)
          if (!content) continue;

          // Check each content type
          for (const [contentType, mediaType] of Object.entries(content)) {
            if (!mediaType || typeof mediaType !== "object") continue;

            const mediaObj = mediaType as Record<string, unknown>;
            const pointer = `#/paths/${escapePointer(path)}/${method}/responses/${statusCode}/content/${escapePointer(contentType)}`;

            // Check for schema
            if (!mediaObj.schema) {
              // Skip binary content types - they typically don't have schemas
              if (isBinaryContentType(contentType)) {
                continue;
              }

              diagnostics.push({
                code: "mock-no-schema",
                severity: "warning",
                pointer,
                message: `Response has no schema - cannot generate meaningful mock data`,
                attribution: getAttribution("mock-no-schema"),
                suggestion: "Add a schema to enable response generation",
              });
              continue;
            }

            // Check for example/examples (only for JSON-like content)
            // Use hint severity - missing examples are very common and not critical
            if (!isBinaryContentType(contentType)) {
              const hasExample = mediaObj.example !== undefined;
              const hasExamples = mediaObj.examples &&
                typeof mediaObj.examples === "object" &&
                Object.keys(mediaObj.examples as object).length > 0;

              // Also check schema-level example
              const schema = mediaObj.schema as Record<string, unknown> | undefined;
              const schemaHasExample = schema && (
                schema.example !== undefined ||
                (Array.isArray(schema.examples) && schema.examples.length > 0)
              );

              if (!hasExample && !hasExamples && !schemaHasExample) {
                diagnostics.push({
                  code: "mock-no-example",
                  severity: "hint",
                  pointer,
                  message: `No example provided - will generate from schema`,
                  attribution: getAttribution("mock-no-example"),
                  suggestion: "Add an example for more realistic mock responses",
                });
              }
            }
          }
        }
      }
    }

    return diagnostics;
  }

  /**
   * Check if document looks like an OpenAPI spec
   */
  private isOpenAPISpec(document: unknown): boolean {
    if (!document || typeof document !== "object") return false;
    const doc = document as Record<string, unknown>;
    return typeof doc.openapi === "string" || typeof doc.swagger === "string";
  }
}

/**
 * Escape special characters in JSON Pointer segment
 */
function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
