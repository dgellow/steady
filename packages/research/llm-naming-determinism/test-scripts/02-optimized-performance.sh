#!/bin/bash
# Performance test with optimized settings

echo "=== Optimized Performance Test ==="
echo "Testing with optimized settings (batch=80, concurrency=8)"
echo ""

# Run extraction with optimized settings
time deno run --allow-read --allow-write --allow-net --allow-env \
  ../../../cmd/oas-extract.ts extract \
  ../test-data/datadog-openapi.json \
  --strategy deterministic \
  --verbose \
  --dedup-batch-size 80 \
  --dedup-concurrency 8 \
  --dedup-delay 0 \
  -o optimized-output.json

echo ""
echo "Compare the timing with baseline test"