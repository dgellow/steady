/**
 * PathAnalyzer - Analyzes OpenAPI path definitions for issues
 *
 * Checks for:
 * - Duplicate path patterns (same structure, different parameter names)
 *   Per OpenAPI 3.0.3 Section "Path Templating":
 *   "Templated paths with the same hierarchy but different templated names
 *   MUST NOT exist as they are identical."
 * - Paths with multiple question marks (e.g., /files?beta=true?limit=10)
 * - Query parameter names or enum values containing '?' characters
 */

import type { SchemaRegistry } from "../schema-registry.ts";
import type { Analyzer } from "./ref-analyzer.ts";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/types.ts";
import { getAttribution } from "../diagnostics/attribution.ts";
import { escapeSegment } from "@steady/json-pointer";

/**
 * Extract the base path without query parameters.
 * Steady supports paths like "/files?beta=true" for query-based routing.
 */
function getBasePath(path: string): string {
  const queryIndex = path.indexOf("?");
  return queryIndex >= 0 ? path.slice(0, queryIndex) : path;
}

/**
 * Normalize a path pattern by replacing all {param} with {*}.
 * This allows detection of structurally identical paths regardless
 * of parameter names.
 */
function normalizePathPattern(path: string): string {
  return path.replace(/\{[^}]+\}/g, "{*}");
}

/**
 * Analyzes OpenAPI path definitions for issues
 */
export class PathAnalyzer implements Analyzer {
  readonly name = "PathAnalyzer";
  readonly codes: DiagnosticCode[] = [
    "path-duplicate-pattern",
    "path-multiple-question-marks",
    "param-question-mark-in-query",
  ];

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

    // Group paths by their normalized base pattern.
    // We use the base path (without query params) for grouping since
    // "/users/{id}" and "/users/{id}?beta=true" have the same structure.
    const patternGroups = new Map<string, string[]>();

    for (const path of Object.keys(paths)) {
      const basePath = getBasePath(path);

      // Skip paths without parameters - they can't have this issue
      if (!basePath.includes("{")) continue;

      const normalized = normalizePathPattern(basePath);
      const group = patternGroups.get(normalized);
      if (group) {
        group.push(path);
      } else {
        patternGroups.set(normalized, [path]);
      }
    }

    // Report groups with more than one path
    for (const [normalized, pathList] of patternGroups) {
      if (pathList.length > 1) {
        // Create a diagnostic for the first path, with related diagnostics for the others
        const [firstPath, ...otherPaths] = pathList;
        const pointer = `#/paths/${escapeSegment(firstPath!)}`;

        diagnostics.push({
          code: "path-duplicate-pattern",
          severity: "warning",
          pointer,
          message:
            `Path "${firstPath}" has the same pattern as ${otherPaths.length} other path(s)`,
          attribution: getAttribution("path-duplicate-pattern"),
          suggestion:
            `Per OpenAPI 3.0 spec, paths with identical structure but different parameter names are considered duplicates. ` +
            `Pattern "${normalized}" is used by: ${pathList.join(", ")}`,
          related: otherPaths.map((p) => ({
            pointer: `#/paths/${escapeSegment(p)}`,
            message: `Also matches pattern "${normalized}"`,
          })),
        });
      }
    }

    // Check for paths with multiple question marks
    for (const path of Object.keys(paths)) {
      const firstQ = path.indexOf("?");
      if (firstQ >= 0 && path.indexOf("?", firstQ + 1) >= 0) {
        const pointer = `#/paths/${escapeSegment(path)}`;
        diagnostics.push({
          code: "path-multiple-question-marks",
          severity: "warning",
          pointer,
          message: `Path "${path}" contains multiple '?' characters`,
          attribution: getAttribution("path-multiple-question-marks"),
          suggestion:
            `Only the first '?' delimits the query string. Subsequent '?' become part of parameter values, ` +
            `which likely indicates a URL construction bug (e.g., SDK appending '?params' to a path that already has '?query').`,
        });
      }
    }

    // Check for query parameters with '?' in names or enum values
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      const item = pathItem as Record<string, unknown>;

      for (
        const method of [
          "get",
          "post",
          "put",
          "patch",
          "delete",
          "options",
          "head",
        ]
      ) {
        const operation = item[method] as Record<string, unknown> | undefined;
        if (!operation?.parameters) continue;

        const params = operation.parameters as Array<Record<string, unknown>>;
        for (const param of params) {
          if (param.in !== "query") continue;
          const paramName = param.name as string;

          // Check param name for '?'
          if (paramName.includes("?")) {
            const pointer = `#/paths/${
              escapeSegment(path)
            }/${method}/parameters`;
            diagnostics.push({
              code: "param-question-mark-in-query",
              severity: "warning",
              pointer,
              message:
                `Query parameter "${paramName}" contains '?' in its name`,
              attribution: getAttribution("param-question-mark-in-query"),
              suggestion:
                `'?' in query parameter names causes ambiguity with the URL query delimiter. ` +
                `Consider renaming to "${
                  paramName.replace(/\?/g, "")
                }" or using percent-encoding.`,
            });
          }

          // Check enum values for '?'
          const schema = param.schema as Record<string, unknown> | undefined;
          if (schema?.enum && Array.isArray(schema.enum)) {
            const cursedValues = (schema.enum as unknown[]).filter(
              (v) => typeof v === "string" && v.includes("?"),
            );
            if (cursedValues.length > 0) {
              const pointer = `#/paths/${
                escapeSegment(path)
              }/${method}/parameters`;
              diagnostics.push({
                code: "param-question-mark-in-query",
                severity: "warning",
                pointer,
                message:
                  `Query parameter "${paramName}" has enum values containing '?': ${
                    cursedValues.map((v) => `"${v}"`).join(", ")
                  }`,
                attribution: getAttribution("param-question-mark-in-query"),
                suggestion:
                  `'?' in query parameter values is ambiguous with the URL query delimiter and may be inconsistently percent-encoded.`,
              });
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
