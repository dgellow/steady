#!/bin/bash
# Compare all naming strategies

echo "=== Strategy Comparison Test ==="
echo "Comparing all strategies with 3 runs each"
echo ""

# Use the evaluation tool to compare strategies
deno run --allow-read --allow-write --allow-net --allow-env \
  ../../../cmd/oas-evaluate.ts \
  ../test-data/datadog-openapi.json \
  --compare \
  --runs 3 \
  --output strategy-comparison-report.md

echo ""
echo "Report saved to strategy-comparison-report.md"