import type { GeminiClient } from "./llm.ts";
import type { NamingStrategy } from "./naming-strategies.ts";
import type { DeduplicationDecision, SchemaGroup } from "./deduplicator.ts";

/**
 * Multi-sample naming strategy implementation.
 *
 * This strategy generates multiple naming suggestions for each schema group
 * and selects the best one based on the selection method. Despite making
 * 3x more LLM calls, our research found it's only ~12% slower than single-sample
 * strategies due to parallel processing.
 *
 * Use cases:
 * - One-time schema extractions where quality matters more than speed
 * - Initial API documentation where manual review is expected
 * - Exploring naming options for complex domain-specific schemas
 *
 * Trade-offs:
 * - Better semantic names than single-sample strategies
 * - Only 44.3% consistency (better than other non-deterministic strategies)
 * - More expensive due to multiple LLM calls
 * - Worth it when naming quality is paramount
 *
 * @param groups - Schema groups to generate names for
 * @param existingSchemaNames - Existing schema names to avoid conflicts
 * @param llmClient - LLM client for API calls
 * @param strategy - Multi-sample strategy configuration
 * @param buildPrompt - Function to build the LLM prompt
 * @returns Array of deduplication decisions with suggested names
 */
export async function generateWithMultiSample(
  groups: SchemaGroup[],
  existingSchemaNames: string[],
  llmClient: GeminiClient,
  strategy: Extract<NamingStrategy, { type: "multi-sample" }>,
  buildPrompt: (groups: SchemaGroup[], names: string[]) => string,
): Promise<DeduplicationDecision[]> {
  const temperature = 0.3; // Higher temp for diversity - produces varied but reasonable names

  // Generate multiple samples in parallel
  const samples = await Promise.all(
    Array(strategy.samples).fill(0).map(() =>
      generateSingleBatch(
        groups,
        existingSchemaNames,
        llmClient,
        temperature,
        buildPrompt,
      )
    ),
  );

  // Select best for each group based on strategy
  return selectBest(samples, strategy.selection);
}

async function generateSingleBatch(
  groups: SchemaGroup[],
  existingSchemaNames: string[],
  llmClient: GeminiClient,
  temperature: number,
  buildPrompt: (groups: SchemaGroup[], names: string[]) => string,
): Promise<DeduplicationDecision[]> {
  const prompt = buildPrompt(groups, existingSchemaNames);

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

  const response = await llmClient.makeStructuredRequest(requestBody);

  if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
    try {
      const parsed = JSON.parse(response.candidates[0].content.parts[0].text);
      return parsed.analyses || [];
    } catch (e) {
      console.error("Failed to parse LLM response:", e);
      return [];
    }
  }

  return [];
}

function selectBest(
  samples: DeduplicationDecision[][],
  selection: "most-common" | "best-score",
): DeduplicationDecision[] {
  if (samples.length === 0) return [];
  if (samples.length === 1) return samples[0]!;

  // Group decisions by groupId
  const groupedDecisions = new Map<string, DeduplicationDecision[]>();

  for (const sample of samples) {
    for (const decision of sample) {
      if (!groupedDecisions.has(decision.groupId)) {
        groupedDecisions.set(decision.groupId, []);
      }
      groupedDecisions.get(decision.groupId)!.push(decision);
    }
  }

  // Select best decision for each group
  const results: DeduplicationDecision[] = [];

  for (const [_groupId, decisions] of groupedDecisions) {
    const selected = selection === "most-common"
      ? selectMostCommon(decisions)
      : selectBestScore(decisions);

    results.push(selected);
  }

  return results;
}

function selectMostCommon(
  decisions: DeduplicationDecision[],
): DeduplicationDecision {
  // Count occurrences of each name
  const nameCounts = new Map<
    string,
    { count: number; decision: DeduplicationDecision }
  >();

  for (const decision of decisions) {
    if (decision.suggestedName) {
      const key = decision.suggestedName;
      if (!nameCounts.has(key)) {
        nameCounts.set(key, { count: 0, decision });
      }
      nameCounts.get(key)!.count++;
    }
  }

  // Find most common name
  let best = decisions[0]!;
  let maxCount = 0;

  for (const { count, decision } of nameCounts.values()) {
    if (count > maxCount) {
      maxCount = count;
      best = decision;
    }
  }

  return best;
}

function selectBestScore(
  decisions: DeduplicationDecision[],
): DeduplicationDecision {
  return decisions.reduce((best, current) => {
    const score = scoreDecision(current);
    const bestScore = scoreDecision(best);
    return score > bestScore ? current : best;
  });
}

function scoreDecision(decision: DeduplicationDecision): number {
  let score = 0;

  // Confidence affects score
  if (decision.confidence === "HIGH") score += 3;
  else if (decision.confidence === "MEDIUM") score += 2;
  else score += 1;

  // Name quality
  if (decision.suggestedName) {
    score += scoreNameQuality(decision.suggestedName);
  }

  // Prefer merge decisions (they provide more value)
  if (decision.decision === "MERGE") score += 1;

  return score;
}

function scoreNameQuality(name: string): number {
  let score = 0;

  // Length preferences
  if (name.length >= 4 && name.length <= 20) score += 2;
  else if (name.length <= 30) score += 1;

  // No numeric suffixes
  if (!/\d+$/.test(name)) score += 2;

  // No generic suffixes
  if (!name.endsWith("Object")) score += 1;
  if (!name.endsWith("Properties")) score += 1;
  if (!name.endsWith("Type")) score += 1;
  if (!name.endsWith("Data")) score += 1;

  // Proper PascalCase
  if (/^[A-Z][a-z]+([A-Z][a-z]+)*$/.test(name)) score += 1;

  // Semantic clarity - contains meaningful words
  const meaningfulWords = [
    "User",
    "Error",
    "Page",
    "Response",
    "Request",
    "Config",
    "Meta",
    "Filter",
    "Sort",
    "Query",
    "Result",
    "Status",
  ];
  if (meaningfulWords.some((word) => name.includes(word))) score += 1;

  return score;
}
