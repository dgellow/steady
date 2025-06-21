# Performance Optimization Guide

## Understanding Performance

The OAS Extract tool's performance is primarily bounded by LLM API calls during
semantic deduplication. For large APIs like Datadog (400+ duplicate groups),
this can take significant time.

## Key Performance Factors

1. **Number of duplicate groups**: More groups = more LLM calls
2. **Batch size**: Larger batches = fewer API calls but potentially less
   granular analysis
3. **Concurrency**: More concurrent requests = faster processing (up to API
   limits)
4. **Delays**: Artificial delays between chunks to avoid rate limiting

## Default Settings

The tool uses these defaults which balance performance and reliability:

```
--dedup-batch-size 50     # Groups per LLM request
--dedup-delay 50          # Milliseconds between chunks
--dedup-concurrency 5     # Concurrent LLM requests
```

## Performance Tuning

### For Large APIs (>200 duplicate groups)

Maximize throughput:

```bash
oas-extract extract large-api.json \
  --dedup-batch-size 100 \
  --dedup-delay 0 \
  --dedup-concurrency 10
```

### For Rate-Limited Environments

Reduce concurrency and add delays:

```bash
oas-extract extract api.json \
  --dedup-batch-size 30 \
  --dedup-delay 200 \
  --dedup-concurrency 2
```

### For Best Quality (Small APIs)

Smaller batches for more focused analysis:

```bash
oas-extract extract api.json \
  --dedup-batch-size 10 \
  --dedup-concurrency 3
```

## Performance Expectations

| API Size | Duplicate Groups | Expected Time |
| -------- | ---------------- | ------------- |
| Small    | <50              | 5-10 seconds  |
| Medium   | 50-200           | 15-30 seconds |
| Large    | 200-500          | 30-90 seconds |
| Huge     | >500             | 2-5 minutes   |

## Optimization Tips

1. **Pre-filter schemas**: Use `--min-properties` and `--min-complexity` to
   reduce schemas analyzed
2. **Use deterministic strategy**: Temperature=0 may be slightly faster
3. **Increase batch size**: For APIs with many similar schemas
4. **Monitor verbose output**: Use `--verbose` to see bottlenecks
5. **Parallelize evaluation**: Run multiple extractions concurrently

## Batch Size Trade-offs

- **Larger batches (50-100)**:
  - ✅ Fewer LLM calls = faster
  - ✅ Better for homogeneous APIs
  - ❌ Less context-aware decisions
  - ❌ Potential quality degradation

- **Smaller batches (10-30)**:
  - ✅ More focused analysis
  - ✅ Better naming quality
  - ❌ More LLM calls = slower
  - ❌ Higher costs

## Example: Optimizing Datadog API

The Datadog API has ~400 duplicate groups. Default settings:

- 400 groups ÷ 50 batch size = 8 batches
- 8 batches ÷ 5 concurrency = 2 rounds
- Total time: ~50-60 seconds

Optimized settings:

```bash
oas-extract extract datadog-openapi.json \
  --dedup-batch-size 80 \
  --dedup-concurrency 8 \
  --dedup-delay 0
```

- 400 groups ÷ 80 batch size = 5 batches
- 5 batches ÷ 8 concurrency = 1 round
- Expected time: ~20-30 seconds

## Monitoring Performance

Use verbose mode to see timing details:

```bash
oas-extract extract api.json --verbose
```

This will show:

- Number of groups found
- Batch processing progress
- Time spent in each phase
- Total extraction time
