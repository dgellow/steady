import type { SchemaContext, SchemaObject } from "./types.ts";
import type { GeminiClient } from "./llm.ts";
import type { NamingContext, NamingStrategy } from "./naming-strategies.ts";
import { describeStrategy, getTemperature } from "./naming-strategies.ts";
import { generateWithMultiSample } from "./multi-sample.ts";

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

/**
 * SemanticDeduplicator - Identifies and merges structurally identical schemas
 * that represent the same logical concept, using LLM for semantic analysis.
 *
 * The deduplication process has three phases:
 * 1. Structural grouping - Group schemas by their structure (properties, types)
 * 2. Semantic analysis - Use LLM to determine if schemas in each group represent
 *    the same concept and should be merged
 * 3. Apply decisions - Merge schemas that represent the same concept
 *
 * Performance characteristics (based on our research with Datadog API):
 * - Network latency dominates: Each LLM call takes 2-3 seconds
 * - Optimal batch size: 50-80 schemas per LLM request
 * - Optimal concurrency: 5-8 parallel requests
 * - Total time scales with number of duplicate groups, not total schemas
 *
 * Temperature strategy is critical for consistency - see naming-strategies.ts
 */
export class SemanticDeduplicator {
  private llmClient: GeminiClient;
  private batchSize: number;
  private delay: number;
  private concurrency: number;
  private namingStrategy: NamingStrategy;

  constructor(
    llmClient: GeminiClient,
    batchSize = 50, // Optimal based on testing - balances API efficiency with response quality
    delay = 50, // Minimal delay to avoid rate limiting
    concurrency = 5, // 5-8 concurrent requests optimal before hitting API limits
    namingStrategy?: NamingStrategy,
  ) {
    this.llmClient = llmClient;
    this.batchSize = batchSize;
    this.delay = delay;
    this.concurrency = concurrency;
    this.namingStrategy = namingStrategy || { type: "deterministic" };
  }

  async deduplicateSchemas(
    contexts: SchemaContext[],
    existingSchemaNames?: string[],
  ): Promise<{
    mergedContexts: SchemaContext[];
    auditTrail: DeduplicationDecision[];
    failedGroups: SchemaGroup[];
  }> {
    console.log("🔍 Analyzing structural groups...");
    console.log(
      `📊 Using naming strategy: ${describeStrategy(this.namingStrategy)}`,
    );

    // Phase 1: Group by structural fingerprint
    const groups = this.createStructuralGroups(contexts);
    const duplicateGroups = groups.filter((g) => g.schemas.length > 1);

    console.log(
      `Found ${duplicateGroups.length} groups with potential duplicates`,
    );

    // Debug: Show some example groups
    if (duplicateGroups.length > 0 && this.llmClient.verbose) {
      console.log("\nExample duplicate groups:");
      for (let i = 0; i < Math.min(3, duplicateGroups.length); i++) {
        const group = duplicateGroups[i]!;
        console.log(`\nGroup ${i + 1}: ${group.schemas.length} schemas`);
        console.log(
          `Properties: ${
            Object.keys(group.representative.schema.properties || {}).join(", ")
          }`,
        );
        console.log("Locations:");
        for (const schema of group.schemas.slice(0, 3)) {
          console.log(
            `  - ${schema.method} ${schema.path} (${schema.location})`,
          );
        }
        if (group.schemas.length > 3) {
          console.log(`  ... and ${group.schemas.length - 3} more`);
        }
      }
    }

    if (duplicateGroups.length === 0) {
      return {
        mergedContexts: contexts,
        auditTrail: [],
        failedGroups: [],
      };
    }

    // Phase 2: Semantic analysis with structured output
    console.log("🤖 Performing semantic analysis...");
    const totalBatches = Math.ceil(duplicateGroups.length / this.batchSize);
    console.log(
      `   📦 Processing ${duplicateGroups.length} groups in ${totalBatches} batches (batch size: ${this.batchSize}, concurrency: ${this.concurrency})`,
    );

    const analysisStart = performance.now();
    const { decisions, failedGroups } = await this.analyzeSemantics(
      duplicateGroups,
      existingSchemaNames,
    );
    const analysisTime = (performance.now() - analysisStart) / 1000;

    console.log(`   ⏱️  Analysis completed in ${analysisTime.toFixed(1)}s`);

    // Phase 3: Apply decisions
    console.log("✅ Applying deduplication decisions...");
    const mergedContexts = this.applyDecisions(contexts, groups, decisions);

    const mergeDecisions = decisions.filter((d) => d.decision === "MERGE");
    const highConfidence =
      mergeDecisions.filter((d) => d.confidence === "HIGH").length;
    const mediumConfidence =
      mergeDecisions.filter((d) => d.confidence === "MEDIUM").length;
    const lowConfidence =
      mergeDecisions.filter((d) => d.confidence === "LOW").length;

    console.log(
      `Merge decisions: ${highConfidence} high, ${mediumConfidence} medium, ${lowConfidence} low confidence`,
    );
    console.log(`Applied ${highConfidence} high-confidence merges`);

    // Report failures if any
    if (failedGroups.length > 0) {
      console.error(`\n⚠️  Failed to analyze ${failedGroups.length} groups:`);
      for (const group of failedGroups.slice(0, 5)) {
        console.error(`  - Group ${group.id}: ${group.schemas.length} schemas`);
        console.error(
          `    Example: ${group.schemas[0]?.method} ${group.schemas[0]?.path}`,
        );
      }
      if (failedGroups.length > 5) {
        console.error(`  ... and ${failedGroups.length - 5} more`);
      }
    }

    return {
      mergedContexts,
      auditTrail: decisions,
      failedGroups,
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
    existingSchemaNames?: string[],
  ): Promise<
    { decisions: DeduplicationDecision[]; failedGroups: SchemaGroup[] }
  > {
    const decisions: DeduplicationDecision[] = [];
    const failedGroups: SchemaGroup[] = [];
    const usedNames = new Set(existingSchemaNames || []);

    let processedGroups = 0;
    const totalGroups = groups.length;

    // Process in concurrent chunks
    for (let i = 0; i < groups.length; i += this.batchSize * this.concurrency) {
      const chunkEnd = Math.min(
        i + this.batchSize * this.concurrency,
        groups.length,
      );
      const chunk = groups.slice(i, chunkEnd);

      // Create concurrent batches
      const batchPromises: Promise<
        { decisions: DeduplicationDecision[]; failedGroups: SchemaGroup[] }
      >[] = [];
      for (let j = 0; j < chunk.length; j += this.batchSize) {
        const batch = chunk.slice(j, j + this.batchSize);
        if (batch.length > 0) {
          const batchIndex = Math.floor((i + j) / this.batchSize);
          const totalBatches = Math.ceil(groups.length / this.batchSize);
          batchPromises.push(
            this.analyzeBatchSafely(
              batch,
              batchIndex + 1,
              Array.from(usedNames),
              batchIndex,
              totalBatches,
            ),
          );
        }
      }

      if (this.llmClient.verbose) {
        console.log(
          `   🔄 Processing groups ${i + 1}-${
            Math.min(chunkEnd, totalGroups)
          } of ${totalGroups}...`,
        );
      }

      // Wait for all concurrent batches
      const batchResults = await Promise.all(batchPromises);
      processedGroups += chunk.length;
      for (const result of batchResults) {
        decisions.push(...result.decisions);
        failedGroups.push(...result.failedGroups);

        // Add newly decided names to the used set to avoid conflicts in subsequent batches
        for (const decision of result.decisions) {
          if (decision.suggestedName) {
            usedNames.add(decision.suggestedName);
          }
        }
      }

      // Delay between chunks (not batches)
      if (chunkEnd < groups.length) {
        await new Promise((resolve) => setTimeout(resolve, this.delay));
      }
    }

    return { decisions, failedGroups };
  }

  private async analyzeBatchSafely(
    batch: SchemaGroup[],
    batchNumber: number,
    existingSchemaNames: string[],
    batchIndex: number,
    totalBatches: number,
  ): Promise<
    { decisions: DeduplicationDecision[]; failedGroups: SchemaGroup[] }
  > {
    try {
      const decisions = await this.analyzeBatch(
        batch,
        existingSchemaNames,
        batchIndex,
        totalBatches,
      );
      return { decisions, failedGroups: [] };
    } catch (error) {
      console.error(`Failed to analyze batch ${batchNumber}:`, error);
      // Don't fake results - record as failed
      return { decisions: [], failedGroups: batch };
    }
  }

  /**
   * Analyze a batch of schema groups to determine which should be merged.
   *
   * This is the core method that sends schema groups to the LLM for semantic
   * analysis. The LLM determines if schemas in each group represent the same
   * logical concept and should be merged.
   *
   * Temperature control is critical here:
   * - Deterministic (temp=0): Same names every time, required for CI/CD
   * - Low variance (temp=0.2): Better names but only 33% consistent
   * - Multi-sample: Generates 3 candidates, picks most common
   *
   * Performance notes:
   * - Each batch takes 2-3 seconds due to network latency
   * - Optimal batch size is 50-80 schemas
   * - Larger batches don't significantly slow individual requests
   *
   * @param groups - Schema groups to analyze (already structurally identical)
   * @param existingSchemaNames - Existing names to avoid conflicts
   * @param batchIndex - Current batch number (for decay strategy)
   * @param totalBatches - Total number of batches (for progress tracking)
   * @returns Array of deduplication decisions with suggested names
   */
  private async analyzeBatch(
    groups: SchemaGroup[],
    existingSchemaNames: string[],
    batchIndex: number,
    totalBatches: number,
  ): Promise<DeduplicationDecision[]> {
    // Special handling for multi-sample strategy
    if (this.namingStrategy.type === "multi-sample") {
      return generateWithMultiSample(
        groups,
        existingSchemaNames,
        this.llmClient,
        this.namingStrategy,
        (g, n) => this.buildAnalysisPrompt(g, n),
      );
    }

    // Build context for temperature calculation
    const context: NamingContext = {
      schema: groups[0]!.representative.schema,
      contexts: groups[0]!.schemas,
      existingNames: existingSchemaNames,
      groupId: groups[0]!.id,
      batchIndex,
      totalBatches,
    };

    // Get temperature from strategy
    const temperature = getTemperature(this.namingStrategy, context);

    const prompt = this.buildAnalysisPrompt(groups, existingSchemaNames);

    if (this.llmClient.verbose) {
      console.log(
        `\nAnalyzing batch of ${groups.length} groups (temperature=${temperature})...`,
      );
    }

    const requestBody = {
      contents: [{
        parts: [{
          text: prompt,
        }],
      }],
      generationConfig: {
        temperature,
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

    // Parse the structured response
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      try {
        const parsed = JSON.parse(response.candidates[0].content.parts[0].text);
        const analyses = parsed.analyses || [];

        if (this.llmClient.verbose && analyses.length > 0) {
          console.log(
            `Batch results: ${
              analyses.filter((a: DeduplicationDecision) =>
                a.decision === "MERGE"
              ).length
            } merges, ${
              analyses.filter((a: DeduplicationDecision) =>
                a.decision === "KEEP_SEPARATE"
              ).length
            } kept separate`,
          );
          // Show first merge decision if any
          const firstMerge = analyses.find((a: DeduplicationDecision) =>
            a.decision === "MERGE"
          );
          if (firstMerge) {
            console.log(
              `Example merge: ${firstMerge.groupId} - ${firstMerge.semanticConcept} (${firstMerge.confidence})`,
            );
          }
        }

        return analyses;
      } catch (e) {
        console.error("Failed to parse LLM response:", e);
        return [];
      }
    }

    return [];
  }

  private buildAnalysisPrompt(
    groups: SchemaGroup[],
    existingSchemaNames?: string[],
  ): string {
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
- MERGE when schemas represent the same semantic concept across different endpoints
- Common patterns that should be merged:
  - Error responses across different endpoints (e.g., 400/401/403/404/500 errors)
  - Pagination wrappers with same structure
  - Common response envelopes (data/meta/links patterns)
  - Shared domain objects (User, Organization, etc.) returned by multiple endpoints
- Consider the semantic meaning, not just the endpoint path
- Medium confidence is acceptable for clear semantic matches
- High confidence for obvious matches (errors, pagination, common entities)

NAMING GUIDELINES:
- Use clear, semantic names that describe the concept (e.g., "User", "ErrorResponse", "PageInfo")
- NEVER use number suffixes (e.g., "ErrorResponse2", "User3")
- Avoid generic suffixes like "Object", "Data", "Properties" UNLESS they match the actual property name
- For error responses: "ErrorResponse", "ValidationError", "NotFoundError"
- For pagination: "PageInfo", "PaginationMeta", "PageMetadata"
- For domain objects: Use the actual domain term (e.g., "Monitor", "Dashboard", "Pipeline")
- Keep names concise and meaningful
- If schemas from different resources share the same structure, use a name that captures their shared purpose
- Names MUST NOT conflict with existing schema names in the API

SPECIAL CASE - Property name matching:
- If a schema represents a property literally named "attributes", then "EntityAttributes" or "UserAttributes" is appropriate
- If a schema represents a property literally named "metadata", then "ResourceMetadata" is appropriate
- Match the property name when it's descriptive of the schema's purpose

BAD NAMES: ResourceAttributes (when not an 'attributes' property), GenericObject2, ComplianceRuleOptions3, ErrorMeta2
GOOD NAMES: User, ErrorResponse, PageInfo, MonitorConfig, EntityAttributes (for an 'attributes' property)

${
      existingSchemaNames && existingSchemaNames.length > 0
        ? `
EXISTING SCHEMAS IN THIS API (for context and to avoid conflicts):
${existingSchemaNames.slice(0, 20).join(", ")}${
          existingSchemaNames.length > 20
            ? ` ... and ${existingSchemaNames.length - 20} more`
            : ""
        }

Note: While you should be aware of these existing names to:
1. Avoid naming conflicts
2. Follow the API's naming conventions
3. Understand the domain terminology

Do NOT over-index on existing names. Focus primarily on the actual structure and context of the schemas you're analyzing.
`
        : ""
    }

Analyze these ${groups.length} schema groups:
${groupDescriptions}

For each group, determine:
1. Do all schemas represent the same logical concept?
2. What is the semantic concept?
3. Should they be merged into one schema?
4. What would be a MEANINGFUL name if merged? (no generic suffixes or numbers!)

Focus on the data structure's purpose, not which endpoints use it.`;
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

      if (
        decision?.decision === "MERGE" &&
        (decision.confidence === "HIGH" || decision.confidence === "MEDIUM")
      ) {
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
