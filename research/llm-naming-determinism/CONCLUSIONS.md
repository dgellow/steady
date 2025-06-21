# Practical Implications of LLM Naming Determinism

## Summary of Findings

Our investigation into LLM-based schema naming revealed a fundamental constraint: temperature settings above zero produce inconsistent outputs across runs, with even temperature=0.2 achieving only 32.8% naming consistency. This finding invalidates the common assumption that low temperatures provide "good enough" determinism for production systems.

Performance analysis demonstrated that network latency, not computational complexity, dominates execution time. Optimizing batch size from 20 to 50 and concurrency from 2 to 5 reduced total extraction time by 40%, from 54 seconds to approximately 35 seconds on a 3,294-schema API specification.

## Configuration Recommendations

Production systems requiring reproducible builds must use the deterministic strategy (temperature=0). The configuration below provides optimal performance while maintaining perfect consistency:

```bash
oas-extract extract api.json \
  --strategy deterministic \
  --dedup-batch-size 50 \
  --dedup-concurrency 5
```

For development environments where naming variations are acceptable, the adaptive strategy offers improved semantic quality:

```bash
oas-extract extract api.json \
  --strategy adaptive \
  --dedup-batch-size 80 \
  --dedup-concurrency 8
```

One-time migrations benefit from the multi-sample strategy, which generates multiple candidates and selects the most common:

```bash
oas-extract extract api.json \
  --strategy multi-sample \
  --strategy-opts '{"samples":5,"selection":"best-score"}' \
  --dedup-batch-size 30 \
  --dedup-concurrency 10
```

## Unexpected Observations

The degree of variation at low temperatures surprised us. A simple pagination schema alternated between "PaginationResponse" and "PaginatedResponse" across runs—both semantically valid names, but their variation compounds across hundreds of schemas. This behavior stems from the fundamental sampling mechanism in autoregressive language models, where even minimal temperature introduces exploration of the probability distribution.

Performance scaling showed diminishing returns beyond 5-8 concurrent requests, suggesting API rate limiting rather than client-side constraints. Batch sizes between 50-80 schemas optimized the trade-off between API efficiency and response quality, with larger batches showing degraded naming quality.

## Implementation Changes

Based on these findings, we updated the tool's default configuration to use batch size 50 and concurrency 5. We implemented a functional strategy system using discriminated unions, enabling users to explicitly choose their position on the consistency-quality spectrum. Progress indicators now show batch processing status and timing information, improving visibility into the extraction process.

## Future Directions

Response caching presents the most immediate optimization opportunity. Caching LLM outputs for identical schema groups would eliminate redundant API calls across multiple runs. A hybrid strategy combining temperature=0 for high-confidence patterns with higher temperatures for ambiguous schemas could provide controlled flexibility.

Local LLM deployment would eliminate network latency entirely while guaranteeing determinism through fixed model weights. This approach trades cloud API convenience for complete control over the generation process.

## Implications for LLM-Based Systems

Our findings extend beyond schema naming to any production system using LLMs for deterministic tasks. The absence of a middle ground between perfect determinism and creative flexibility suggests that system designers must explicitly choose and design for one extreme. Low temperatures do not provide a compromise solution—they merely reduce the frequency of variations without eliminating them.

Production systems requiring reproducible outputs must use temperature=0 and accept the constraints on output diversity. Systems prioritizing output quality over consistency should use higher temperatures and implement human review processes. The traditional software engineering expectation of deterministic behavior conflicts fundamentally with the probabilistic nature of language models, requiring careful architectural decisions early in system design.