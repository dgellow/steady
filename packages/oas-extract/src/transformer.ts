import type { ExtractedSchema, OpenAPISpec } from "./types.ts";

/**
 * SpecTransformer - Transforms OpenAPI specs by extracting inline schemas
 * and replacing them with $ref references.
 *
 * The transformation uses a two-phase approach:
 *
 * Phase 1: Add extracted schemas to components.schemas
 * - Ensures the components.schemas section exists
 * - Adds all extracted schemas with their generated names
 *
 * Phase 2: Replace inline schemas with $ref
 * - Walks the entire spec tree recursively
 * - Uses deep equality matching to find schemas that match extracted ones
 * - Replaces matched inline schemas with $ref pointers
 *
 * This two-phase approach is necessary because:
 * - We can't use JSON path navigation reliably (schemas move during transformation)
 * - Deep equality ensures we match the exact schemas that were extracted
 * - The approach handles nested schemas and complex structures correctly
 *
 * Performance: O(n * m) where n = spec size, m = extracted schemas
 * In practice, this is fast enough for specs with thousands of schemas.
 */
export class SpecTransformer {
  transform(
    spec: OpenAPISpec,
    extractedSchemas: ExtractedSchema[],
  ): OpenAPISpec {
    // Deep clone the spec to avoid mutations
    const newSpec = JSON.parse(JSON.stringify(spec)) as OpenAPISpec;

    // Phase 1: Ensure components.schemas exists and add all extracted schemas
    if (!newSpec.components) {
      newSpec.components = {};
    }
    if (!newSpec.components.schemas) {
      newSpec.components.schemas = {};
    }

    for (const extracted of extractedSchemas) {
      newSpec.components.schemas[extracted.name] = extracted.schema;
    }

    // Phase 2: Walk through the entire spec and replace inline schemas with refs
    // We do this by comparing the actual schema objects
    let replacementCount = 0;

    const replaceSchemas = (obj: unknown, path: string[] = []): unknown => {
      if (!obj || typeof obj !== "object") return obj;

      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map((item, index) =>
          replaceSchemas(item, [...path, `[${index}]`])
        );
      }

      // Handle objects
      const record = obj as Record<string, unknown>;

      // Skip if already a reference
      if ("$ref" in record) return obj;

      // Check if this matches any extracted schema
      for (const extracted of extractedSchemas) {
        if (this.schemasMatch(record, extracted.schema)) {
          replacementCount++;
          return { $ref: `#/components/schemas/${extracted.name}` };
        }
      }

      // Recursively process all properties
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        result[key] = replaceSchemas(value, [...path, key]);
      }

      return result;
    };

    // Apply replacements
    newSpec.paths = replaceSchemas(newSpec.paths) as typeof newSpec.paths;

    console.log(
      `\nReplacement summary: ${replacementCount} schemas replaced with references`,
    );

    // Validate the transformed spec
    this.validateTransformation(newSpec, extractedSchemas, replacementCount);

    return newSpec;
  }

  private schemasMatch(a: unknown, b: unknown): boolean {
    // Deep equality check, ignoring certain fields
    if (a === b) return true;
    if (!a || !b) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      return a.every((item, index) => this.schemasMatch(item, b[index]));
    }

    if (typeof a === "object" && typeof b === "object") {
      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;

      // Get keys, filtering out fields we want to ignore
      const ignoredKeys = [
        "description",
        "example",
        "examples",
        "title",
        "x-nullable",
      ];
      const aKeys = Object.keys(aObj).filter((k) => !ignoredKeys.includes(k))
        .sort();
      const bKeys = Object.keys(bObj).filter((k) => !ignoredKeys.includes(k))
        .sort();

      if (aKeys.length !== bKeys.length) return false;
      if (!aKeys.every((k, i) => k === bKeys[i])) return false;

      // Compare all non-ignored properties
      return aKeys.every((key) => this.schemasMatch(aObj[key], bObj[key]));
    }

    return false;
  }

  private validateTransformation(
    spec: OpenAPISpec,
    _extractedSchemas: ExtractedSchema[],
    replacementCount: number,
  ): void {
    const errors: string[] = [];

    // Check all $refs point to existing schemas
    const schemaNames = new Set(Object.keys(spec.components?.schemas || {}));

    const checkRefs = (obj: unknown, path: string = "root"): void => {
      if (!obj || typeof obj !== "object") return;

      if (Array.isArray(obj)) {
        obj.forEach((item, index) => checkRefs(item, `${path}[${index}]`));
        return;
      }

      const record = obj as Record<string, unknown>;

      if ("$ref" in record && typeof record.$ref === "string") {
        const ref = record.$ref;
        if (ref.startsWith("#/components/schemas/")) {
          const schemaName = ref.replace("#/components/schemas/", "");
          if (!schemaNames.has(schemaName)) {
            errors.push(
              `Invalid reference at ${path}: ${ref} (schema does not exist)`,
            );
          }
        }
      }

      for (const [key, value] of Object.entries(record)) {
        checkRefs(value, `${path}.${key}`);
      }
    };

    checkRefs(spec.paths);

    if (errors.length > 0) {
      console.error(
        `\n❌ Validation failed: ${errors.length} invalid references found`,
      );
      for (const error of errors.slice(0, 5)) {
        console.error(`  - ${error}`);
      }
      if (errors.length > 5) {
        console.error(`  ... and ${errors.length - 5} more`);
      }
      throw new Error(
        `Transformation created ${errors.length} invalid references`,
      );
    }

    console.log(
      `✅ Validation passed: All ${replacementCount} references are valid`,
    );
  }

  generateReport(
    _spec: OpenAPISpec,
    extractedSchemas: ExtractedSchema[],
  ): string {
    const report: string[] = [];

    report.push("# OpenAPI Schema Extraction Report");
    report.push("");
    report.push(`Total schemas extracted: ${extractedSchemas.length}`);
    report.push("");

    // Group by resource
    const byResource = new Map<string, ExtractedSchema[]>();
    for (const schema of extractedSchemas) {
      const resource = schema.context.resourceName || "general";
      if (!byResource.has(resource)) {
        byResource.set(resource, []);
      }
      byResource.get(resource)!.push(schema);
    }

    report.push("## Extracted Schemas by Resource:");
    for (const [resource, schemas] of byResource.entries()) {
      report.push(`\n### ${resource} (${schemas.length} schemas)`);
      for (const schema of schemas) {
        const location = `${
          schema.context.method || "N/A"
        } ${schema.context.path}`;
        report.push(`- **${schema.name}** - ${location}`);
        if (schema.context.location.includes("requestBody")) {
          report.push(`  - Type: Request Body`);
        } else if (schema.context.location.includes("responses")) {
          report.push(`  - Type: Response (${schema.context.statusCode})`);
        }
      }
    }

    // Summary by type
    const byType = {
      requestBodies:
        extractedSchemas.filter((s) =>
          s.context.location.includes("requestBody")
        ).length,
      responses:
        extractedSchemas.filter((s) => s.context.location.includes("responses"))
          .length,
      parameters:
        extractedSchemas.filter((s) =>
          s.context.location.includes("parameters")
        ).length,
      nested: extractedSchemas.filter((s) => s.context.parentContext).length,
    };

    report.push("\n## Summary by Type:");
    report.push(`- Request Bodies: ${byType.requestBodies}`);
    report.push(`- Responses: ${byType.responses}`);
    report.push(`- Parameters: ${byType.parameters}`);
    report.push(`- Nested Objects: ${byType.nested}`);

    return report.join("\n");
  }
}
