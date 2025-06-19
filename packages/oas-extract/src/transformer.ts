import type { ExtractedSchema, OpenAPISpec, SchemaContext } from "./types.ts";

export class SpecTransformer {
  transform(
    spec: OpenAPISpec,
    extractedSchemas: ExtractedSchema[],
  ): OpenAPISpec {
    // Deep clone the spec to avoid mutations
    const newSpec = JSON.parse(JSON.stringify(spec)) as OpenAPISpec;

    // Ensure components.schemas exists
    if (!newSpec.components) {
      newSpec.components = {};
    }
    if (!newSpec.components.schemas) {
      newSpec.components.schemas = {};
    }

    // Add extracted schemas to components
    for (const extracted of extractedSchemas) {
      newSpec.components.schemas[extracted.name] = extracted.schema;
    }

    // Replace inline schemas with references
    for (const extracted of extractedSchemas) {
      this.replaceWithRef(newSpec, extracted);
    }

    return newSpec;
  }

  private replaceWithRef(spec: OpenAPISpec, extracted: ExtractedSchema): void {
    const { context } = extracted;
    const ref = { $ref: `#/components/schemas/${extracted.name}` };

    // Navigate to the location and replace
    const pathParts = this.parseLocation(context);
    let current: any = spec;

    // Navigate to the parent of the schema
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (
        !part || !current || typeof current !== "object" || !(part in current)
      ) {
        console.warn(`Path not found: ${pathParts.slice(0, i + 1).join(".")}`);
        return;
      }
      current = (current as any)[part];
    }

    // Replace the schema with a reference
    const lastPart = pathParts[pathParts.length - 1];
    if (
      lastPart && current && typeof current === "object" && lastPart in current
    ) {
      (current as any)[lastPart] = ref;
    }
  }

  private parseLocation(context: SchemaContext): string[] {
    const { path, method, location } = context;
    const parts: string[] = ["paths", path];

    if (method) {
      parts.push(method);
    }

    // Parse the location string
    // e.g., "requestBody.content["application/json"].schema.properties.data"
    const locationParts = this.parseLocationString(location);
    parts.push(...locationParts);

    return parts;
  }

  private parseLocationString(location: string): string[] {
    const parts: string[] = [];
    let current = "";
    let inBrackets = false;
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < location.length; i++) {
      const char = location[i];

      if (inBrackets) {
        if (char === '"' || char === "'") {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
          } else if (char === quoteChar) {
            inQuotes = false;
          } else {
            current += char;
          }
        } else if (char === "]" && !inQuotes) {
          parts.push(current);
          current = "";
          inBrackets = false;
        } else if (!inQuotes || char !== quoteChar) {
          current += char;
        }
      } else {
        if (char === "[") {
          if (current) {
            parts.push(current);
            current = "";
          }
          inBrackets = true;
        } else if (char === ".") {
          if (current) {
            parts.push(current);
            current = "";
          }
        } else {
          current += char;
        }
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
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
