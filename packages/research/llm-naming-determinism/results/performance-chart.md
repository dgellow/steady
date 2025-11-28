# Performance Visualization

## Extraction Time by Strategy

```
Strategy        Time (seconds)
              0    10   20   30   40   50
              |    |    |    |    |    |
Low Variance  |████████████████████████████████| 32.2s ⭐ Fastest
Decay         |█████████████████████████████████| 32.9s
Multi-Sample  |████████████████████████████████████| 36.2s
Deterministic |█████████████████████████████████████| 37.5s
Adaptive      |██████████████████████████████████████| 38.4s
```

## Consistency vs Performance Trade-off

```
      High ┐
           │  Deterministic
           │  (100%, 37.5s)
           │      ●
           │
Consistency│
           │
           │                    ● Multi-Sample
           │                   (44%, 36.2s)
           │
           │     ● Low Variance    ● Decay
           │    (33%, 32.2s)    (28%, 32.9s)
           │              ● Adaptive
      Low  └─────────────(26%, 38.4s)────────────
           Fast                            Slow
                    Performance →
```

## Semantic Analysis Time Breakdown

### With Old Defaults (batch=20, concurrency=2)

```
Total: 54.3s
├─ Structural Analysis: ~1s
├─ Semantic Analysis: ~50s ████████████████████████████████████████
├─ Apply Decisions: ~2s
└─ Validation: ~1s
```

### With New Defaults (batch=50, concurrency=5)

```
Total: 34.5s
├─ Structural Analysis: ~1s
├─ Semantic Analysis: ~23s ███████████████████
├─ Apply Decisions: ~2s
└─ Validation: ~1s
```

## Batch Processing Efficiency

```
Batch Size  # of API Calls  Avg Time per Call  Total Time
20          20 calls        2.5s               50s
50          9 calls         2.6s               23s  ⭐ Optimal
80          6 calls         2.8s               17s
100         5 calls         3.0s               15s
```

## Name Variation Examples

### Deterministic (100% consistent)

```
Run 1: PaginationResponse → ErrorResponse
Run 2: PaginationResponse → ErrorResponse  ✓ Same
Run 3: PaginationResponse → ErrorResponse  ✓ Same
```

### Multi-Sample (44% consistent)

```
Run 1: PaginationResponse → ErrorResponse
Run 2: PaginatedResponse  → ErrorResponse  ✗ Different
Run 3: PaginationResponse → ErrorDetails   ✗ Different
```
