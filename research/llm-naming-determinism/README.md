# LLM Naming Determinism in Schema Extraction

## Abstract

This research investigates the determinism and performance characteristics of LLM-based semantic naming in OpenAPI schema extraction. We evaluate five temperature-based strategies across consistency, performance, and semantic quality dimensions using a production-scale API specification containing 3,294 schemas.

## Introduction

The OAS Extract tool employs Large Language Models to generate semantic names for structurally identical schemas during deduplication. The core challenge lies in balancing naming consistency—essential for reproducible builds—against semantic quality. Temperature parameters in LLMs control the randomness of token generation, theoretically offering a tunable trade-off between creativity and determinism.

## Research Questions

We investigate three primary questions. First, what degree of naming consistency can be achieved at various temperature settings? Second, how do batching strategies affect extraction performance on large-scale APIs? Third, is there a viable middle ground between perfect determinism and semantic quality?

## Methodology

### Experimental Setup

We tested five naming strategies on the Datadog OpenAPI specification (8.4MB, 3,294 schemas, 403 duplicate groups requiring deduplication). Each strategy implements a different temperature control mechanism:

The deterministic strategy uses temperature=0 for maximum repeatability. Low variance employs temperature=0.2, hypothesized to maintain high consistency while allowing minor variations. The adaptive strategy varies temperature from 0 to 0.3 based on schema complexity and confidence heuristics. Multi-sample generates three candidates at temperature=0.3 and selects the most common. Decay starts at temperature=0.3 and decreases to 0 over the extraction process.

### Measurement Protocol

Each strategy underwent three complete extraction runs. We measured total extraction time, semantic analysis time, and naming consistency across runs. Consistency is calculated as the percentage of schemas receiving identical names across all runs.

### Performance Optimization

We also investigated the impact of batching parameters on extraction performance. Variables included batch size (schemas per LLM request), concurrency (parallel LLM requests), and inter-batch delays.

## Results

### Consistency Analysis

The deterministic strategy achieved 100% consistency across all runs, as expected. Surprisingly, all other strategies showed significantly lower consistency than hypothesized. Low variance achieved only 32.8% consistency despite its low temperature of 0.2. Adaptive and decay strategies performed similarly at 26.1% and 28.1% respectively. Multi-sample showed marginally better consistency at 44.3%, likely due to its selection mechanism favoring common outputs.

### Performance Characteristics

Baseline performance with original defaults (batch size=20, concurrency=2) required 54.3 seconds for complete extraction. Optimized settings (batch size=50, concurrency=5) reduced this to 32-38 seconds, a 40% improvement. The semantic analysis phase dominates runtime, accounting for approximately 90% of total execution time.

Individual strategy performance varied minimally, with low variance being fastest at 32.2 seconds average and adaptive slowest at 38.4 seconds. The multi-sample strategy, despite making three times more LLM calls, was only 12% slower than single-sample strategies due to parallel processing.

### Naming Variations

Even simple schemas exhibited naming variations at temperature>0. A pagination response schema alternated between "PaginationResponse" and "PaginatedResponse" across runs. Both names are semantically valid, but the variation reduces consistency to 66% for this single schema. Complex schemas showed even greater variation, with some receiving entirely different conceptual names across runs.

## Analysis

### Temperature Effects

Our results definitively show that any temperature above 0 introduces substantial naming variation. The LLM's token sampling mechanism, even at temperature=0.2, explores different regions of the probability distribution across invocations. This behavior is fundamental to autoregressive language models and cannot be mitigated through prompt engineering alone.

### Performance Bottlenecks

Network latency dominates execution time, with each LLM API call requiring 2-3 seconds regardless of payload size. This explains why increased batch sizes improve performance linearly up to about 80 schemas per batch, after which the returns diminish. Concurrency provides multiplicative speedup until API rate limits intervene around 8-10 parallel requests.

### The Consistency-Quality Trade-off

No viable middle ground exists between perfect consistency and semantic flexibility. Temperature=0.1 still produces variations, merely less frequently than higher temperatures. For production systems requiring reproducible builds, only temperature=0 is acceptable. This finding contradicts our initial hypothesis that low temperatures would provide "good enough" consistency.

## Implementation Improvements

Based on these findings, we modified the tool's default configuration. Batch size increased from 20 to 50, optimizing for the sweet spot between API efficiency and response time. Concurrency increased from 2 to 5, maximizing parallelism without hitting rate limits. Inter-batch delays reduced from 100ms to 50ms, removing unnecessary latency.

We also implemented a flexible strategy system allowing users to choose their consistency-quality trade-off explicitly. The system uses simple discriminated unions and pure functions, avoiding complex class hierarchies while maintaining extensibility.

## Conclusions

Temperature=0 is mandatory for consistent schema naming in CI/CD contexts. The 5-second performance penalty compared to non-deterministic strategies is negligible given the value of reproducible builds. For one-time extractions where manual review is expected, higher-temperature strategies can produce more nuanced names.

Performance optimization through batching and concurrency provides substantial benefits, reducing extraction time by 40% on large APIs. The optimal configuration depends on API rate limits and network conditions, but batch sizes of 50-80 and concurrency of 5-8 work well in practice.

## Future Work

Three avenues merit investigation. First, response caching could eliminate redundant LLM calls for identical schema groups across runs. Second, hybrid strategies using temperature=0 for high-confidence patterns and higher temperatures for ambiguous cases might provide controlled flexibility. Third, local LLM deployment would eliminate network latency entirely while guaranteeing perfect determinism with fixed model weights.

The fundamental tension between consistency and creativity in LLM-based systems extends beyond schema naming. Our findings suggest that production systems requiring deterministic outputs must explicitly design for this constraint rather than assuming low temperatures provide sufficient stability.