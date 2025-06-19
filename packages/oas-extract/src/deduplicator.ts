import type { SchemaContext, SchemaObject } from "./types.ts";

export interface SchemaGroup {
  id: string;
  fingerprint: string;
  schemas: SchemaContext[];
  representative: SchemaContext; // First schema in group (guaranteed to exist)
}

export interface DeduplicationDecision {
  groupId: string;
  decision: "MERGE" | "KEEP_SEPARATE";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
  suggestedName?: string;
  semanticConcept: string;
}

export interface DeduplicationBatch {
  analyses: DeduplicationDecision[];
}

export class SemanticDeduplicator {
  private llmClient: any;

  constructor(llmClient: any) {
    this.llmClient = llmClient;
  }

  async deduplicateSchemas(contexts: SchemaContext[]): Promise<{
    mergedContexts: SchemaContext[];
    auditTrail: DeduplicationDecision[];
  }> {
    console.log("🔍 Analyzing structural groups...");

    // Phase 1: Group by structural fingerprint
    const groups = this.createStructuralGroups(contexts);
    const duplicateGroups = groups.filter((g) => g.schemas.length > 1);

    console.log(
      `Found ${duplicateGroups.length} groups with potential duplicates`,
    );

    if (duplicateGroups.length === 0) {
      return {
        mergedContexts: contexts,
        auditTrail: [],
      };
    }

    // Phase 2: Semantic analysis with structured output
    console.log("🤖 Performing semantic analysis...");
    const decisions = await this.analyzeSemantics(duplicateGroups);

    // Phase 3: Apply decisions
    console.log("✅ Applying deduplication decisions...");
    const mergedContexts = this.applyDecisions(contexts, groups, decisions);

    const highConfidenceMerges =
      decisions.filter((d) => d.decision === "MERGE" && d.confidence === "HIGH")
        .length;
    console.log(`Applied ${highConfidenceMerges} high-confidence merges`);

    return {
      mergedContexts,
      auditTrail: decisions,
    };
  }

  private createStructuralGroups(contexts: SchemaContext[]): SchemaGroup[] {
    const fingerprints = new Map<string, SchemaContext[]>();

    for (const context of contexts) {
      const fingerprint = this.generateFingerprint(context.schema);
      if (!fingerprints.has(fingerprint)) {
        fingerprints.set(fingerprint, []);
      }
      fingerprints.get(fingerprint)!.push(context);
    }

    const groups: SchemaGroup[] = [];
    let groupId = 1;

    for (const [fingerprint, schemas] of fingerprints.entries()) {
      if (schemas.length === 0) continue; // Skip empty groups

      const representative = schemas[0];
      if (!representative) continue; // Additional safety check

      groups.push({
        id: `group-${groupId++}`,
        fingerprint,
        schemas,
        representative,
      });
    }

    return groups.sort((a, b) => b.schemas.length - a.schemas.length);
  }

  private generateFingerprint(schema: SchemaObject): string {
    const props = Object.keys(schema.properties || {}).sort();
    const types = props.map((p) => {
      const prop = schema.properties?.[p];
      if (typeof prop === "object" && prop && "type" in prop) {
        return prop.type || "unknown";
      }
      return "unknown";
    });

    return JSON.stringify({
      props,
      types,
      required: schema.required?.sort() || [],
      arrayItems: schema.type === "array"
        ? this.generateFingerprint(schema.items as SchemaObject)
        : null,
    });
  }

  private async analyzeSemantics(
    groups: SchemaGroup[],
  ): Promise<DeduplicationDecision[]> {
    const decisions: DeduplicationDecision[] = [];
    const batchSize = 8; // Process 8 groups at a time

    for (let i = 0; i < groups.length; i += batchSize) {
      const batch = groups.slice(i, i + batchSize);
      try {
        const batchDecisions = await this.analyzeBatch(batch);
        decisions.push(...batchDecisions);
      } catch (error) {
        console.error(`Failed to analyze batch ${i / batchSize + 1}:`, error);
        // Add fallback decisions
        for (const group of batch) {
          decisions.push({
            groupId: group.id,
            decision: "KEEP_SEPARATE",
            confidence: "LOW",
            reasoning: "Analysis failed, keeping separate for safety",
            semanticConcept: "unknown",
          });
        }
      }

      // Respectful delay for semantic analysis quality
      if (i + batchSize < groups.length) {
        await new Promise((resolve) => setTimeout(resolve, 8000)); // 8s between deduplication batches
      }
    }

    return decisions;
  }

  private async analyzeBatch(
    groups: SchemaGroup[],
  ): Promise<DeduplicationDecision[]> {
    const prompt = this.buildAnalysisPrompt(groups);

    const requestBody = {
      contents: [{
        parts: [{
          text: prompt,
        }],
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            analyses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  groupId: { type: "string" },
                  decision: {
                    type: "string",
                    enum: ["MERGE", "KEEP_SEPARATE"],
                  },
                  confidence: {
                    type: "string",
                    enum: ["HIGH", "MEDIUM", "LOW"],
                  },
                  reasoning: { type: "string" },
                  suggestedName: { type: "string" },
                  semanticConcept: { type: "string" },
                },
                required: [
                  "groupId",
                  "decision",
                  "confidence",
                  "reasoning",
                  "semanticConcept",
                ],
              },
            },
          },
          required: ["analyses"],
        },
      },
    };

    const response = await this.llmClient.makeStructuredRequest(requestBody);
    return response.analyses;
  }

  private buildAnalysisPrompt(groups: SchemaGroup[]): string {
    const groupDescriptions = groups.map((group) => {
      const schemas = group.schemas;
      const props = Object.keys(group.representative.schema.properties || {});

      const contexts = schemas.map((s) => ({
        path: s.path,
        method: s.method,
        location: s.location,
        operationId: s.operationId,
        resourceName: s.resourceName,
      }));

      return `
Group ${group.id}:
  Properties: ${props.slice(0, 8).join(", ")}${props.length > 8 ? "..." : ""}
  Schema count: ${schemas.length}
  Contexts:
${
        contexts.map((c) => `    - ${c.method} ${c.path} (${c.location})`).join(
          "\n",
        )
      }`;
    }).join("\n");

    return `You are analyzing groups of structurally identical OpenAPI schemas to determine if they represent the same logical concept and should be merged.

IMPORTANT GUIDELINES:
- MERGE only when schemas represent the exact same semantic concept
- Different API endpoints can share the same data model (e.g., User, Error, Pagination)
- Be conservative: when uncertain, choose KEEP_SEPARATE
- Consider domain context: billing schemas, user schemas, error schemas, etc.
- High confidence requires clear semantic equivalence

Analyze these ${groups.length} schema groups:
${groupDescriptions}

For each group, determine:
1. Do all schemas represent the same logical concept?
2. What is the semantic concept? (e.g., "User", "BillingUsage", "APIError")
3. Should they be merged into one schema?
4. What would be a good name if merged?

Be very careful - false merges break APIs, false separations just use more space.`;
  }

  private applyDecisions(
    contexts: SchemaContext[],
    groups: SchemaGroup[],
    decisions: DeduplicationDecision[],
  ): SchemaContext[] {
    const decisionMap = new Map(decisions.map((d) => [d.groupId, d]));
    const result: SchemaContext[] = [];
    const processedContexts = new Set<SchemaContext>();

    for (const group of groups) {
      const decision = decisionMap.get(group.id);

      if (decision?.decision === "MERGE" && decision.confidence === "HIGH") {
        // Use first schema as representative with suggested name
        const representative = group.representative;
        const mergedContext: SchemaContext = {
          ...representative,
          extractedName: decision.suggestedName,
          mergedFrom: group.schemas.length,
        };
        result.push(mergedContext);

        // Mark all schemas in this group as processed
        for (const schema of group.schemas) {
          processedContexts.add(schema);
        }
      } else {
        // Keep all schemas separate
        for (const schema of group.schemas) {
          if (!processedContexts.has(schema)) {
            result.push(schema);
            processedContexts.add(schema);
          }
        }
      }
    }

    // Add any contexts that weren't in groups
    for (const context of contexts) {
      if (!processedContexts.has(context)) {
        result.push(context);
      }
    }

    return result;
  }
}
