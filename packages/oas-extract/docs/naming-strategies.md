# OpenAPI Schema Naming Strategies

The OAS Extract tool supports multiple naming strategies to balance between stability (consistent names across runs) and quality (semantically meaningful names).

## Available Strategies

### 1. Deterministic (`deterministic`)
- **Temperature**: 0
- **Best for**: CI/CD pipelines, production builds where consistency is critical
- **Behavior**: Always generates the same names for the same schemas
- **Trade-off**: May miss creative naming opportunities

```bash
oas-extract extract api.json --strategy deterministic
```

### 2. Low Variance (`low-variance`) - Default
- **Temperature**: 0.2 (configurable)
- **Best for**: General use, good balance of stability and quality
- **Behavior**: Allows slight variations for better names while maintaining good stability
- **Trade-off**: Balanced approach

```bash
oas-extract extract api.json --strategy low-variance

# With custom temperature
oas-extract extract api.json --strategy low-variance --strategy-opts '{"temperature":0.1}'
```

### 3. Adaptive (`adaptive`)
- **Temperature**: Varies based on confidence (0 for high, 0.2 for medium, 0.3 for low)
- **Best for**: Large APIs with mix of obvious and ambiguous schemas
- **Behavior**: Uses deterministic naming for clear patterns (errors, pagination), allows creativity for ambiguous cases
- **Trade-off**: More complex but often produces best results

```bash
oas-extract extract api.json --strategy adaptive

# With custom thresholds
oas-extract extract api.json --strategy adaptive --strategy-opts '{"thresholds":{"high":0.9,"medium":0.6}}'
```

### 4. Multi-Sample (`multi-sample`)
- **Temperature**: 0.3
- **Best for**: One-time extractions where quality matters most
- **Behavior**: Generates multiple names and picks the best/most common
- **Trade-off**: Slower (multiple LLM calls) but highest quality

```bash
# Default: 3 samples, most common selection
oas-extract extract api.json --strategy multi-sample

# Custom: 5 samples, best score selection
oas-extract extract api.json --strategy multi-sample --strategy-opts '{"samples":5,"selection":"best-score"}'
```

### 5. Decay (`decay`)
- **Temperature**: Starts high, decreases over time
- **Best for**: Large specs processed in batches
- **Behavior**: Early batches explore creative names, later batches stabilize
- **Trade-off**: Good for finding patterns early then locking them in

```bash
# Default: 0.3 → 0, decay rate 0.9
oas-extract extract api.json --strategy decay

# Custom decay parameters
oas-extract extract api.json --strategy decay --strategy-opts '{"initial":0.4,"final":0.1,"rate":0.95}'
```

## Evaluating Strategies

Use the evaluation tool to test stability across multiple runs:

```bash
# Evaluate single strategy
oas-evaluate api.json --strategy adaptive --runs 10

# Compare all strategies
oas-evaluate api.json --compare --runs 5

# Save detailed report
oas-evaluate api.json --compare --output stability-report.md
```

## Strategy Selection Guide

Choose your strategy based on these factors:

| Use Case | Recommended Strategy | Why |
|----------|---------------------|-----|
| CI/CD Pipeline | `deterministic` | 100% reproducible builds |
| Development | `low-variance` | Good balance, reasonable stability |
| Large Enterprise API | `adaptive` | Handles mix of obvious/complex schemas well |
| One-time Migration | `multi-sample` | Highest quality names |
| Huge API (1000+ schemas) | `decay` | Explores patterns then stabilizes |

## Implementation Details

The naming strategies work by controlling the LLM temperature parameter during semantic deduplication:

- **Temperature = 0**: Deterministic, always same output
- **Temperature = 0.1-0.2**: Low variance, mostly stable with slight variations
- **Temperature = 0.3+**: Higher creativity, more variations

The system uses pure functions and simple data structures following Zig Zen principles:
- No complex class hierarchies
- Strategy is just a data structure
- Temperature calculation is a pure function
- Easy to understand and extend

## Adding Custom Strategies

To add a new strategy:

1. Add the type to `NamingStrategy` union in `naming-strategies.ts`
2. Add a case to `getTemperature()` function
3. Add parsing logic to `parseStrategy()`
4. Optionally add special handling (like multi-sample has)

Example:
```typescript
// Add to NamingStrategy type union
| { type: "my-strategy"; myParam: number }

// Add to getTemperature()
case "my-strategy":
  return strategy.myParam * context.batchIndex;

// Add to parseStrategy()
case "my-strategy":
  return { type: "my-strategy", myParam: opts.myParam || 0.5 };
```