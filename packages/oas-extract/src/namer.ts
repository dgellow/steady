import type { ExtractedSchema, LLMResponse, SchemaContext } from "./types.ts";

export class SchemaNamer {
  private usedNames = new Set<string>();
  private nameMap = new Map<string, string>();

  applyLLMSuggestions(
    contexts: SchemaContext[],
    llmResponses: LLMResponse[],
    batches?: any[],
  ): ExtractedSchema[] {
    const extracted: ExtractedSchema[] = [];

    // Build a map of context to LLM suggestion
    const suggestionMap = new Map<
      SchemaContext,
      { name: string; reasoning: string }
    >();

    // Create a map to quickly find contexts by batch
    const batchContextMap = new Map<string, SchemaContext[]>();
    if (batches) {
      for (const batch of batches) {
        batchContextMap.set(batch.id, batch.schemas);
      }
    }

    for (const response of llmResponses) {
      // Get the schemas for this batch
      const batchSchemas = batchContextMap.get(response.batchId) || [];

      // Map suggestions to schemas
      for (const [index, suggestion] of Object.entries(response.suggestions)) {
        const schemaIndex = parseInt(index) - 1; // LLM uses 1-based indexing
        if (batchSchemas[schemaIndex]) {
          suggestionMap.set(batchSchemas[schemaIndex], suggestion);
        }
      }
    }

    // Process each context with its suggestion
    for (const context of contexts) {
      const suggestion = suggestionMap.get(context);
      let name: string;

      if (suggestion) {
        name = this.ensureUniqueName(suggestion.name);
      } else {
        // Fallback to rule-based naming
        name = this.generateFallbackName(context);
      }

      extracted.push({
        name,
        schema: context.schema,
        context,
        originalPath: this.buildOriginalPath(context),
      });

      this.nameMap.set(this.buildOriginalPath(context), name);
    }

    return extracted;
  }

  private ensureUniqueName(suggestedName: string): string {
    // Clean the name
    let name = this.cleanName(suggestedName);

    // If name is already used, append a number
    if (this.usedNames.has(name)) {
      let counter = 2;
      while (this.usedNames.has(`${name}${counter}`)) {
        counter++;
      }
      name = `${name}${counter}`;
    }

    this.usedNames.add(name);
    return name;
  }

  private generateFallbackName(context: SchemaContext): string {
    const parts: string[] = [];

    // Add resource name
    if (context.resourceName) {
      parts.push(
        ...context.resourceName.split(/[/_-]/).map((p) => this.pascalCase(p)),
      );
    }

    // Add method
    if (context.method) {
      parts.push(this.pascalCase(context.method));
    }

    // Add location type
    if (context.location.includes("requestBody")) {
      parts.push("Request");
    } else if (context.location.includes("responses")) {
      if (context.statusCode === "200") {
        parts.push("Response");
      } else {
        parts.push(`Response${context.statusCode}`);
      }
    } else if (context.location.includes("parameters")) {
      parts.push("Parameter");
    }

    // Add property name for nested objects
    const propMatch = context.location.match(/properties\.(\w+)$/);
    if (propMatch && propMatch[1]) {
      parts.push(this.pascalCase(propMatch[1]));
    }

    // Add item suffix for arrays
    if (context.location.endsWith(".items")) {
      parts.push("Item");
    }

    let name = parts.join("");

    // Ensure we have a name
    if (!name) {
      name = "Schema";
    }

    return this.ensureUniqueName(name);
  }

  private cleanName(name: string): string {
    // Remove any non-alphanumeric characters
    let clean = name.replace(/[^a-zA-Z0-9]/g, "");

    // Ensure it starts with a letter
    if (clean && clean.length > 0 && clean[0] && !clean[0].match(/[a-zA-Z]/)) {
      clean = "Schema" + clean;
    }

    // Ensure PascalCase
    if (
      clean && clean.length > 0 && clean[0] &&
      clean[0] === clean[0].toLowerCase()
    ) {
      clean = clean[0].toUpperCase() + clean.slice(1);
    }

    return clean || "Schema";
  }

  private pascalCase(str: string): string {
    return str
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((word) =>
        word.length > 0
          ? word[0]?.toUpperCase() + word.slice(1).toLowerCase()
          : ""
      )
      .join("");
  }

  private buildOriginalPath(context: SchemaContext): string {
    const parts = [context.path];
    if (context.method) parts.push(context.method);
    parts.push(context.location);
    return parts.join(":");
  }

  getNameForPath(originalPath: string): string | undefined {
    return this.nameMap.get(originalPath);
  }
}
