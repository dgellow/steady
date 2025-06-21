#!/bin/bash
# Test impact of different batch sizes on performance

echo "=== Batch Size Impact Test ==="
echo "Testing different batch sizes with deterministic strategy"
echo ""

# Test different batch sizes
for batch_size in 20 50 80 100; do
  echo ""
  echo "Testing batch size: $batch_size"
  
  # Time the extraction
  start_time=$(date +%s)
  
  deno run --allow-read --allow-write --allow-net --allow-env \
    ../../../cmd/oas-extract.ts extract \
    ../test-data/datadog-openapi.json \
    --strategy deterministic \
    --dedup-batch-size $batch_size \
    --dedup-concurrency 5 \
    --dedup-delay 50 \
    -o batch-${batch_size}-output.json 2>&1 | grep -E "(Extraction complete|Processing|📦)"
  
  end_time=$(date +%s)
  duration=$((end_time - start_time))
  
  echo "  Total time: ${duration}s"
done

echo ""
echo "Compare the times for different batch sizes above"