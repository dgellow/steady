import type {
  ExtractedSchema,
  LLMBatch,
  LLMResponse,
  SchemaContext,
} from "./types.ts";

export class SchemaNamer {
  private usedNames = new Set<string>();
  private nameMap = new Map<string, string>();

  applyLLMSuggestions(
    contexts: SchemaContext[],
    llmResponses: LLMResponse[],
    batches?: LLMBatch[],
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

      if (context.extractedName) {
        // Use LLM-provided semantic name from deduplication
        name = this.ensureUniqueName(context.extractedName);
      } else if (suggestion) {
        // Use LLM-provided name from naming process
        name = this.ensureUniqueName(suggestion.name);
      } else {
        // This should never happen if filtering works correctly
        throw new Error(`Internal error: Schema reached naming without LLM name: ${context.path} ${context.method} ${context.location}`);
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
