import type { SchemaObject, SchemaContext } from "./types.ts";

/**
 * Naming strategies for schema extraction - controlling the temperature parameter
 * of LLM calls to balance between naming consistency and semantic quality.
 * 
 * CRITICAL FINDING: Our research (see /research/llm-naming-determinism/) proved that
 * only temperature=0 provides 100% consistent naming across runs. Even temperature=0.2
 * achieves only 32.8% consistency. There is no middle ground - any temperature > 0
 * introduces non-determinism due to the fundamental sampling mechanism in LLMs.
 * 
 * Choose your strategy based on your requirements:
 * - CI/CD pipelines: Use 'deterministic' (default) for reproducible builds
 * - Development: Use 'adaptive' or 'low-variance' for better semantic names
 * - One-time migration: Use 'multi-sample' for highest quality names
 */

// Simple strategy types - no classes
export type NamingStrategy = 
  | { type: "deterministic" }
  | { type: "low-variance"; temperature?: number }
  | { type: "adaptive"; thresholds?: { high: number; medium: number } }
  | { type: "multi-sample"; samples: number; selection: "most-common" | "best-score" }
  | { type: "decay"; initial: number; final: number; rate: number };

export interface NamingContext {
  schema: SchemaObject;
  contexts: SchemaContext[];
  existingNames: string[];
  groupId: string;
  batchIndex: number;
  totalBatches: number;
}

export interface NamingResult {
  name: string;
  confidence: number;
  temperature: number;
  alternatives?: string[];
}

/**
 * Get the temperature setting for a given naming strategy and context.
 * 
 * Temperature controls randomness in LLM token generation:
 * - 0: Deterministic (always same output)
 * - 0.1-0.3: Low variance (mostly consistent with occasional variations)  
 * - 0.4+: High variance (creative but inconsistent)
 * 
 * Our research found that even 0.1 temperature can produce different outputs
 * across runs. Only temperature=0 guarantees reproducibility.
 * 
 * @param strategy - The naming strategy configuration
 * @param context - Current extraction context (schema info, batch progress, etc.)
 * @returns Temperature value to use for LLM API call
 */
export function getTemperature(strategy: NamingStrategy, context: NamingContext): number {
  switch (strategy.type) {
    case "deterministic":
      // Temperature=0 is the ONLY setting that provides 100% consistent outputs
      return 0;
    
    case "low-variance":
      // Default 0.2 provides better names but only ~33% consistency
      // Users who choose this explicitly accept naming variations
      return strategy.temperature ?? 0.2;
    
    case "adaptive":
      // Varies temperature based on confidence - high confidence patterns
      // (like error responses) get lower temperature for more consistency
      return getAdaptiveTemperature(context, strategy.thresholds);
    
    case "multi-sample":
      // Higher temperature to generate diverse candidates
      // Selection mechanism provides some consistency improvement
      return 0.3;
    
    case "decay":
      // Starts creative, becomes deterministic over time
      // Useful for large APIs to explore patterns then lock them in
      const progress = context.batchIndex / context.totalBatches;
      return strategy.initial * Math.pow(strategy.rate, progress);
  }
}

function getAdaptiveTemperature(
  context: NamingContext, 
  thresholds?: { high: number; medium: number }
): number {
  const confidence = assessConfidence(context);
  const t = thresholds ?? { high: 0.8, medium: 0.5 };
  
  if (confidence >= t.high) return 0;
  if (confidence >= t.medium) return 0.2;
  return 0.3;
}

/**
 * Assess confidence that we can name this schema well.
 * 
 * Higher confidence means:
 * - The schema appears many times (more context to work with)
 * - It matches common patterns (error response, pagination, etc.)
 * - All occurrences are in semantically similar contexts
 * 
 * This is used by the adaptive strategy to decide temperature:
 * - High confidence (>0.8): Use temperature=0 for consistency
 * - Medium confidence (>0.5): Use temperature=0.2 for slight variation
 * - Low confidence: Use temperature=0.3 for more creative names
 * 
 * @param context - Schema context including all occurrences
 * @returns Confidence score between 0 and 1
 */
export function assessConfidence(context: NamingContext): number {
  const schemaCount = context.contexts.length;
  const hasCommonPattern = detectCommonPattern(context.schema);
  const hasSemanticName = detectSemanticClarity(context);
  
  let confidence = 0.3; // Base confidence
  
  // More occurrences = higher confidence
  if (schemaCount > 5) confidence += 0.2;
  if (schemaCount > 10) confidence += 0.1;
  if (schemaCount > 20) confidence += 0.1;
  
  // Common patterns boost confidence
  if (hasCommonPattern) confidence += 0.2;
  
  // Clear semantic context boosts confidence
  if (hasSemanticName) confidence += 0.1;
  
  return Math.min(confidence, 1.0);
}

function detectCommonPattern(schema: SchemaObject): boolean {
  const props = Object.keys(schema.properties || {});
  
  // Common error response pattern
  if (props.includes("error") && (props.includes("message") || props.includes("code"))) {
    return true;
  }
  
  // Common pagination pattern
  if (props.includes("page") || props.includes("limit") || props.includes("offset") || 
      props.includes("total") || props.includes("next") || props.includes("previous")) {
    return true;
  }
  
  // Common envelope pattern
  if (props.length === 1 && (props[0] === "data" || props[0] === "items" || props[0] === "results")) {
    return true;
  }
  
  // Metadata pattern
  if (props.includes("meta") || props.includes("metadata") || props.includes("links")) {
    return true;
  }
  
  return false;
}

function detectSemanticClarity(context: NamingContext): boolean {
  // Check if contexts have clear semantic indicators
  const paths = context.contexts.map(c => c.path);
  
  // All paths contain same resource name
  const resourceNames = paths.map(p => {
    const match = p.match(/\/([a-z_-]+)/i);
    return match ? match[1] : null;
  }).filter(Boolean);
  
  if (resourceNames.length > 0) {
    const uniqueResources = new Set(resourceNames);
    // If all paths refer to same resource, high semantic clarity
    return uniqueResources.size === 1;
  }
  
  return false;
}

// Parse strategy from CLI arguments
export function parseStrategy(strategy?: string, strategyOpts?: string): NamingStrategy {
  if (!strategy) {
    return { type: "deterministic" };
  }
  
  const opts = strategyOpts ? JSON.parse(strategyOpts) : {};
  
  switch (strategy) {
    case "deterministic":
      return { type: "deterministic" };
      
    case "low-variance":
      return { type: "low-variance", temperature: opts.temperature };
      
    case "adaptive":
      return { type: "adaptive", thresholds: opts.thresholds };
      
    case "multi-sample":
      return { 
        type: "multi-sample", 
        samples: opts.samples || 3,
        selection: opts.selection || "most-common"
      };
      
    case "decay":
      return {
        type: "decay",
        initial: opts.initial || 0.3,
        final: opts.final || 0,
        rate: opts.rate || 0.9
      };
      
    default:
      throw new Error(`Unknown naming strategy: ${strategy}`);
  }
}

// Helper to describe strategy for logging
export function describeStrategy(strategy: NamingStrategy): string {
  switch (strategy.type) {
    case "deterministic":
      return "Deterministic (temperature=0)";
    case "low-variance":
      return `Low variance (temperature=${strategy.temperature ?? 0.2})`;
    case "adaptive":
      return "Adaptive (varies by confidence)";
    case "multi-sample":
      return `Multi-sample (${strategy.samples} samples, ${strategy.selection})`;
    case "decay":
      return `Decay (${strategy.initial} → ${strategy.final}, rate=${strategy.rate})`;
  }
}