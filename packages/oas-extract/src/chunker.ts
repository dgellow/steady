import type { LLMBatch, SchemaContext } from "./types.ts";

export class SchemaChunker {
  private maxSchemasPerBatch: number;
  private maxTokensPerBatch: number;

  constructor(
    maxSchemasPerBatch = 30,
    maxTokensPerBatch = 4000,
  ) {
    this.maxSchemasPerBatch = maxSchemasPerBatch;
    this.maxTokensPerBatch = maxTokensPerBatch;
  }

  createBatches(contexts: SchemaContext[]): LLMBatch[] {
    // Group schemas by resource
    const resourceGroups = this.groupByResource(contexts);

    // Create batches from resource groups
    const batches: LLMBatch[] = [];
    let batchId = 1;

    for (const [resource, schemas] of resourceGroups.entries()) {
      // Extract domain hints from the resource and schemas
      const domainHints = this.extractDomainHints(resource, schemas);

      // Split large resource groups into multiple batches
      const chunks = this.chunkSchemas(schemas);

      for (const chunk of chunks) {
        batches.push({
          id: `batch-${batchId++}`,
          schemas: chunk,
          domainHints,
          resourceGroup: resource,
        });
      }
    }

    return batches;
  }

  private groupByResource(
    contexts: SchemaContext[],
  ): Map<string, SchemaContext[]> {
    const groups = new Map<string, SchemaContext[]>();

    for (const context of contexts) {
      const key = context.resourceName || "general";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(context);
    }

    // Sort schemas within each group to keep related schemas together
    for (const [, schemas] of groups.entries()) {
      schemas.sort((a, b) => {
        // Sort by path, then method, then location depth
        if (a.path !== b.path) return a.path.localeCompare(b.path);
        if (a.method !== b.method) {
          return (a.method || "").localeCompare(b.method || "");
        }
        return a.location.split(".").length - b.location.split(".").length;
      });
    }

    return groups;
  }

  private chunkSchemas(schemas: SchemaContext[]): SchemaContext[][] {
    const chunks: SchemaContext[][] = [];
    let currentChunk: SchemaContext[] = [];
    let currentTokenEstimate = 0;

    for (const schema of schemas) {
      const tokenEstimate = this.estimateTokens(schema);

      // Check if adding this schema would exceed limits
      if (
        currentChunk.length >= this.maxSchemasPerBatch ||
        (currentChunk.length > 0 &&
          currentTokenEstimate + tokenEstimate > this.maxTokensPerBatch)
      ) {
        // Start a new chunk
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokenEstimate = 0;
      }

      currentChunk.push(schema);
      currentTokenEstimate += tokenEstimate;
    }

    // Add the last chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private estimateTokens(context: SchemaContext): number {
    // Rough estimation: ~4 characters per token
    let charCount = 0;

    // Add path, method, location
    charCount += context.path.length;
    charCount += (context.method || "").length;
    charCount += context.location.length;
    charCount += (context.operationId || "").length;

    // Add schema preview
    charCount += this.getSchemaCharCount(context.schema);

    // Add some overhead for formatting
    charCount += 100;

    return Math.ceil(charCount / 4);
  }

  private getSchemaCharCount(schema: any): number {
    if (schema.type === "object" && schema.properties) {
      // Count property names
      return Object.keys(schema.properties).join(", ").length + 20;
    }

    if (schema.type === "array") {
      return 30; // "array of ..."
    }

    return 20; // Basic type
  }

  private extractDomainHints(
    resource: string,
    schemas: SchemaContext[],
  ): string[] {
    const hints = new Set<string>();

    // Extract from resource name
    const resourceParts = resource.split(/[/_-]/).filter((p) => p.length > 2);
    resourceParts.forEach((part) => hints.add(part));

    // Look for common patterns in schemas
    for (const context of schemas) {
      // Check operation IDs
      if (context.operationId) {
        const words = context.operationId.split(/(?=[A-Z])|[_-]/).filter((w) =>
          w.length > 3
        );
        words.forEach((word) => hints.add(word.toLowerCase()));
      }

      // Check schema properties for domain terms
      if (context.schema.type === "object" && context.schema.properties) {
        for (const prop of Object.keys(context.schema.properties)) {
          if (prop.toLowerCase().includes("aws")) hints.add("AWS");
          if (prop.toLowerCase().includes("gcp")) hints.add("GCP");
          if (prop.toLowerCase().includes("azure")) hints.add("Azure");
          if (prop.toLowerCase().includes("datadog")) hints.add("Datadog");
          if (prop.toLowerCase().includes("auth")) hints.add("Authentication");
          if (prop.toLowerCase().includes("metric")) hints.add("Metrics");
          if (prop.toLowerCase().includes("log")) hints.add("Logging");
        }
      }
    }

    return Array.from(hints).filter((h) => h.length > 2).slice(0, 5);
  }
}
