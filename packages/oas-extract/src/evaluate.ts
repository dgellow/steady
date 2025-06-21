import type { ExtractedSchema, OpenAPISpec } from "./types.ts";
import type { NamingStrategy } from "./naming-strategies.ts";
import { FastExtractor } from "./fast-extractor.ts";

export interface StabilityReport {
  strategy: string;
  runs: number;
  consistency: number;
  uniqueNamesPerRun: number[];
  variations: NameVariation[];
  avgExtractionTime: number;
}

export interface NameVariation {
  path: string;
  method: string;
  names: string[];
  consistencyRate: number;
}

// Evaluate naming stability across multiple runs
export async function evaluateStability(
  spec: OpenAPISpec,
  strategy: NamingStrategy,
  runs: number = 5,
  verbose = false,
): Promise<StabilityReport> {
  const results: ExtractedSchema[][] = [];
  const times: number[] = [];

  for (let i = 0; i < runs; i++) {
    if (verbose) {
      console.log(`\nRun ${i + 1}/${runs}...`);
    }

    const start = performance.now();
    const extractor = new FastExtractor({
      namingStrategy: strategy,
      verbose: false, // Suppress output during evaluation
    });

    const result = await extractor.extract(spec);
    const elapsed = performance.now() - start;

    results.push(result.extracted);
    times.push(elapsed);

    if (verbose) {
      console.log(
        `  Extracted ${result.extracted.length} schemas in ${
          (elapsed / 1000).toFixed(1)
        }s`,
      );
    }
  }

  // Calculate metrics
  const consistency = calculateConsistency(results);
  const uniqueNamesPerRun = results.map((r) =>
    new Set(r.map((s) => s.name)).size
  );
  const variations = findVariations(results);
  const avgExtractionTime = times.reduce((a, b) => a + b, 0) / times.length;

  return {
    strategy: strategy.type,
    runs,
    consistency,
    uniqueNamesPerRun,
    variations,
    avgExtractionTime,
  };
}

function calculateConsistency(results: ExtractedSchema[][]): number {
  if (results.length === 0) return 0;

  // Create a map of schema locations to their names across runs
  const namesByLocation = new Map<string, string[]>();

  for (const runResults of results) {
    for (const schema of runResults) {
      const key = `${
        schema.context.method || ""
      }::${schema.context.path}::${schema.context.location}`;

      if (!namesByLocation.has(key)) {
        namesByLocation.set(key, []);
      }
      namesByLocation.get(key)!.push(schema.name);
    }
  }

  // Calculate consistency for each location
  let totalLocations = 0;
  let consistentLocations = 0;

  for (const names of namesByLocation.values()) {
    totalLocations++;

    // Check if all names are the same
    const uniqueNames = new Set(names);
    if (uniqueNames.size === 1 && names.length === results.length) {
      consistentLocations++;
    }
  }

  return totalLocations > 0 ? consistentLocations / totalLocations : 0;
}

function findVariations(results: ExtractedSchema[][]): NameVariation[] {
  const variations: NameVariation[] = [];
  const namesByLocation = new Map<
    string,
    { path: string; method: string; names: string[] }
  >();

  // Collect all names for each location
  for (const runResults of results) {
    for (const schema of runResults) {
      const key = `${
        schema.context.method || ""
      }::${schema.context.path}::${schema.context.location}`;

      if (!namesByLocation.has(key)) {
        namesByLocation.set(key, {
          path: schema.context.path,
          method: schema.context.method || "N/A",
          names: [],
        });
      }
      namesByLocation.get(key)!.names.push(schema.name);
    }
  }

  // Find locations with variations
  for (const location of namesByLocation.values()) {
    const uniqueNames = [...new Set(location.names)];

    if (uniqueNames.length > 1) {
      // Calculate consistency rate for this location
      const nameCounts = location.names.reduce((acc, name) => {
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const maxCount = Math.max(...Object.values(nameCounts));
      const consistencyRate = maxCount / location.names.length;

      variations.push({
        path: location.path,
        method: location.method,
        names: uniqueNames,
        consistencyRate,
      });
    }
  }

  // Sort by consistency rate (worst first)
  return variations.sort((a, b) => a.consistencyRate - b.consistencyRate);
}

// Compare multiple strategies
export async function compareStrategies(
  spec: OpenAPISpec,
  strategies: Array<{ name: string; strategy: NamingStrategy }>,
  runs: number = 5,
  verbose = false,
): Promise<{ strategies: StabilityReport[]; summary: string }> {
  const reports: StabilityReport[] = [];

  for (const { name, strategy } of strategies) {
    if (verbose) {
      console.log(`\nEvaluating ${name} strategy...`);
    }

    const report = await evaluateStability(spec, strategy, runs, verbose);
    reports.push(report);
  }

  // Generate summary
  const summary = generateComparisonSummary(reports);

  return { strategies: reports, summary };
}

function generateComparisonSummary(reports: StabilityReport[]): string {
  let summary = "## Strategy Comparison Summary\n\n";

  // Sort by consistency
  const sorted = [...reports].sort((a, b) => b.consistency - a.consistency);

  summary += "### Consistency Ranking\n";
  for (let i = 0; i < sorted.length; i++) {
    const report = sorted[i]!;
    summary += `${i + 1}. **${report.strategy}**: ${
      (report.consistency * 100).toFixed(1)
    }% consistent\n`;
  }

  summary += "\n### Performance\n";
  for (const report of reports) {
    summary += `- **${report.strategy}**: ${
      (report.avgExtractionTime / 1000).toFixed(1)
    }s average\n`;
  }

  summary += "\n### Naming Variations\n";
  for (const report of reports) {
    const totalVariations = report.variations.length;
    if (totalVariations === 0) {
      summary += `- **${report.strategy}**: No variations (100% stable)\n`;
    } else {
      const avgConsistency = report.variations.reduce((sum, v) =>
        sum + v.consistencyRate, 0) / totalVariations;
      summary +=
        `- **${report.strategy}**: ${totalVariations} variations (avg ${
          (avgConsistency * 100).toFixed(1)
        }% consistent)\n`;
    }
  }

  return summary;
}

// Helper to format a stability report
export function formatStabilityReport(report: StabilityReport): string {
  let output = `## Stability Report: ${report.strategy}\n\n`;

  output += `**Runs**: ${report.runs}\n`;
  output += `**Overall Consistency**: ${
    (report.consistency * 100).toFixed(1)
  }%\n`;
  output += `**Average Extraction Time**: ${
    (report.avgExtractionTime / 1000).toFixed(1)
  }s\n`;
  output += `**Unique Names per Run**: ${
    report.uniqueNamesPerRun.join(", ")
  }\n`;

  if (report.variations.length > 0) {
    output += `\n### Name Variations (${report.variations.length} total)\n\n`;

    for (const variation of report.variations.slice(0, 10)) {
      output += `**${variation.method} ${variation.path}** (${
        (variation.consistencyRate * 100).toFixed(0)
      }% consistent)\n`;
      output += `  Names: ${variation.names.join(", ")}\n\n`;
    }

    if (report.variations.length > 10) {
      output += `... and ${report.variations.length - 10} more variations\n`;
    }
  } else {
    output += `\n✅ No naming variations detected - 100% stable!\n`;
  }

  return output;
}
