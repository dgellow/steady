#!/bin/bash
# Baseline performance test with original defaults

echo "=== Baseline Performance Test ==="
echo "Testing with original defaults (batch=20, concurrency=2)"
echo ""

# Run extraction with verbose output to see timing
cd "$(dirname "$0")"
time deno run --allow-read --allow-write --allow-net --allow-env \
  ../../../cmd/oas-extract.ts extract \
  ../test-data/datadog-openapi.json \
  --verbose \
  --dedup-batch-size 20 \
  --dedup-concurrency 2 \
  --dedup-delay 100 \
  -o baseline-output.json

echo ""
echo "Check the 'Performing semantic analysis' timing in the output above"