#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import { parseArgs } from "@std/cli/parse-args";
import { parseSpec } from "../packages/openapi/parser.ts";
import {
  compareStrategies,
  evaluateStability,
  formatStabilityReport,
  type NamingStrategy,
  parseStrategy,
} from "./oas-extract/mod.ts";

function printHelp() {
  console.log(`
OpenAPI Schema Naming Stability Evaluator

Evaluate the stability and consistency of different naming strategies.

Usage:
  oas-evaluate <input-file> [options]

Options:
  --strategy <name>      Strategy to evaluate (default: all)
  --strategy-opts <json> Strategy options as JSON
  --runs <n>            Number of runs for evaluation (default: 5)
  --compare             Compare all strategies
  --verbose             Show detailed progress
  --output <file>       Save report to file

Examples:
  # Evaluate default strategy
  oas-evaluate api.json

  # Evaluate specific strategy with 10 runs
  oas-evaluate api.json --strategy adaptive --runs 10

  # Compare all strategies
  oas-evaluate api.json --compare

  # Evaluate multi-sample with custom options
  oas-evaluate api.json --strategy multi-sample --strategy-opts '{"samples":5,"selection":"best-score"}'
`);
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["help", "compare", "verbose"],
    string: ["strategy", "strategy-opts", "output"],
    default: {
      runs: 5,
    },
  });

  if (args.help || args._.length === 0) {
    printHelp();
    Deno.exit(0);
  }

  const inputFile = args._[0] as string;

  try {
    // Load the spec
    console.log(`📄 Loading OpenAPI spec from ${inputFile}...`);
    const spec = await parseSpec(inputFile);

    if (args.compare) {
      // Compare all strategies
      console.log(
        `\n🔬 Comparing all naming strategies with ${args.runs} runs each...\n`,
      );

      const strategies: Array<{ name: string; strategy: NamingStrategy }> = [
        { name: "Deterministic", strategy: { type: "deterministic" } },
        { name: "Low Variance", strategy: { type: "low-variance" } },
        { name: "Adaptive", strategy: { type: "adaptive" } },
        {
          name: "Multi-Sample (3)",
          strategy: {
            type: "multi-sample",
            samples: 3,
            selection: "most-common",
          },
        },
        {
          name: "Decay",
          strategy: { type: "decay", initial: 0.3, final: 0, rate: 0.9 },
        },
      ];

      const { strategies: reports, summary } = await compareStrategies(
        spec,
        strategies,
        args.runs as number,
        args.verbose,
      );

      console.log("\n" + summary);

      // Save detailed reports if output specified
      if (args.output) {
        let fullReport = summary + "\n\n---\n\n";
        for (const report of reports) {
          fullReport += formatStabilityReport(report) + "\n---\n\n";
        }
        await Deno.writeTextFile(args.output, fullReport);
        console.log(`\n📊 Full report saved to ${args.output}`);
      }
    } else {
      // Evaluate single strategy
      const strategy = parseStrategy(
        args.strategy as string,
        args["strategy-opts"] as string,
      );

      console.log(
        `\n🔬 Evaluating ${strategy.type} strategy with ${args.runs} runs...\n`,
      );

      const report = await evaluateStability(
        spec,
        strategy,
        args.runs as number,
        args.verbose,
      );

      const formatted = formatStabilityReport(report);
      console.log("\n" + formatted);

      if (args.output) {
        await Deno.writeTextFile(args.output, formatted);
        console.log(`\n📊 Report saved to ${args.output}`);
      }
    }
  } catch (error) {
    console.error(
      "\n❌ Error:",
      error instanceof Error ? error.message : String(error),
    );
    if (args.verbose && error instanceof Error && error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
