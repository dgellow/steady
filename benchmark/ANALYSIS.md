# Steady vs Prism: Performance Analysis

## Executive Summary

Steady significantly outperforms Prism in startup time and achieves better throughput:

| Metric | Steady | Prism | Steady Advantage |
|--------|--------|-------|------------------|
| **Startup Time** | 340ms | 11,024ms | **32.4x faster** |
| **Avg Latency** | 1.31ms | 1.46ms | **1.1x faster** |
| **Throughput** | 764.5 req/s | 683.3 req/s | **1.1x more** |

The primary performance advantage comes from **startup time** - Steady loads specs **32x faster** than Prism.

---

## Architectural Differences

### 1. Route Matching Algorithm

#### Prism (`packages/http/src/router/matchPath.ts`)

```typescript
// Creates RegExp ON EVERY MATCH
const captureRegExp = escaped.replace(/\\\{[^\\]+\\\}/g, '(.*)');
const match = new RegExp(captureRegExp).exec(requestPathFragment);
```

**Problems:**
- Creates new RegExp objects for every path segment match
- O(n) iteration through ALL resources for every request
- Sorts resources by match score on EVERY request: O(n log n)

#### Steady (`src/path-matcher.ts`)

```typescript
// Pre-compiled at startup
interface CompiledPathPattern {
  segments: PathSegment[];  // Pre-parsed, no regex
  segmentCount: number;     // For O(1) early rejection
}

// O(1) exact match via Map
exactRoutes: Map<string, PathItemObject>
```

**Advantages:**
- Path patterns compiled ONCE at startup
- Two-tier lookup: O(1) for exact paths, O(n) only for templated paths
- No runtime RegExp creation
- Segment count comparison for early rejection

### 2. JSON Schema Handling

#### Prism (`packages/http/src/validator/validators/utils.ts`)

```typescript
// Uses AJV with caching
const validationsFunctionsCache = new WeakMap<JSONSchema, WeakMap<object, ValidateFunction>>();

function getValidationFunction(ajvInstance: AjvCore, schema: JSONSchema, bundle?: unknown): ValidateFunction {
  // Creates AJV compiled validator, caches by schema reference
  const validationFunction = ajvInstance.compile({...schema, __bundled__: bundle});
}
```

```typescript
// Response generation uses json-schema-faker
JSONSchemaFaker.generate({ ...cloneDeep(updatedSource), __bundled__: bundle })
```

**Overhead:**
- `cloneDeep()` called on every generation
- `json-schema-faker` is heavyweight (faker.js dependency)
- Multiple AJV instances (draft-04, 2019-09, 2020-12)
- `sortSchemaAlphabetically()` called on every generated response

#### Steady (`packages/json-schema/`)

```typescript
// Document-centric SchemaRegistry - single source of truth
class SchemaRegistry {
  document: unknown;         // Full OpenAPI spec
  refGraph: RefGraph;        // Complete $ref topology
  cache: Map<string, RegistrySchema>;  // Lazy-loaded, O(1) lookup
}

// Pre-built indexes at startup
index: {
  byPointer: Map<string, Schema>;  // O(1) lookup
  byId: Map<string, Schema>;
  byAnchor: Map<string, Schema>;
}
```

**Advantages:**
- Single document-centric architecture
- $refs resolved once at startup, cached
- No external dependencies (no json-schema-faker)
- Built-in runtime validator with Set-based evaluation tracking
- Seeded LCG for deterministic generation (no faker overhead)

### 3. fp-ts Overhead in Prism

Prism uses fp-ts extensively throughout the codebase:

```typescript
// Example from router/index.ts
return pipe(
  sortedResources,
  E.fromPredicate(A.isNonEmpty, () => ...),
  E.chain(resources =>
    E.sequenceArray(
      resources.map(resource =>
        pipe(
          matchPath(requestPath, resource.path),
          E.chain<...>(...),
          ...
        )
      )
    )
  ),
  E.chain(candidateMatches => ...)
);
```

**Impact:**
- Function call overhead for every operation
- Memory allocation for Either/Option wrappers
- Difficult to optimize due to functional abstractions

#### Steady

Direct imperative code with minimal abstractions:

```typescript
// Direct iteration, no functional wrappers
for (const compiled of this.patternRoutes) {
  const params = matchCompiledPath(requestPath, compiled.segments);
  if (params) return { pathItem: compiled.pathItem, params };
}
```

### 4. Startup Processing

#### Prism

1. Parses spec with @stoplight/json-ref-resolver
2. Creates AJV instances for each JSON Schema draft
3. No pre-compilation of routes
4. No pre-indexing of schemas

#### Steady

1. Parses spec with @std/yaml
2. Builds RefGraph (reference topology) once
3. Pre-compiles all route patterns
4. Pre-indexes schemas by pointer, $id, $anchor
5. Detects circular references with Tarjan's SCC algorithm

```
Steady Startup Pipeline:
  Parse YAML → Build RefGraph → Compile Routes → Index Schemas
                     ↓
              Detect Cycles (Tarjan's algorithm)
                     ↓
              Ready for O(1) lookups
```

### 5. Memory Allocation Patterns

#### Prism

- Heavy use of lodash (`cloneDeep`, `merge`, `get`, `inRange`)
- Creates new objects for fp-ts wrappers
- Multiple library dependencies loaded at startup

#### Steady

- Zero-copy where possible
- `Object.create(null)` for prototype pollution prevention
- WeakSet for circular reference detection (no memory leaks)
- Pre-allocated data structures

---

## Micro-Benchmark Results (Steady Internals)

```
Test                                         │Iterations  │Avg (ms)    │Ops/sec
─────────────────────────────────────────────┼────────────┼────────────┼────────────
Path compilation (100 patterns)              │1000        │0.0073      │136,611
Path matching (100 patterns x 4 requests)    │1000        │0.0089      │111,866
Schema resolution (2 refs)                   │10000       │0.0248      │40,269
JSON Schema validation (nested object)       │10000       │0.0023      │441,107
Response generation (nested with enum)       │1000        │0.0151      │66,128
```

Key observations:
- Path matching: **111K+ ops/sec**
- Schema validation: **441K+ ops/sec**
- Response generation: **66K+ ops/sec**

---

## Why Steady is 32x Faster at Startup

1. **No npm dependencies to load**
   - Steady uses Deno with ESM imports (cached)
   - Prism loads: json-schema-faker, faker.js, fp-ts, lodash, AJV, etc.

2. **No external JSON Schema library**
   - Steady has built-in RuntimeValidator
   - Prism initializes 3 AJV instances (different drafts)

3. **Pre-compilation at startup pays off**
   - Steady does more work upfront (route compilation, indexing)
   - But this work is O(n) once vs O(n) per-request

4. **Simpler architecture**
   - Document-centric vs isolated schema processing
   - Direct code vs fp-ts abstractions

---

## Complexity Comparison

| Operation | Steady | Prism |
|-----------|--------|-------|
| Route matching (exact) | O(1) | O(n) |
| Route matching (pattern) | O(p × s) | O(n × s × regex) |
| Schema lookup | O(1) via Map | O(1) via WeakMap |
| $ref resolution | O(1) cached | O(depth) per resolution |
| Response generation | O(schema size) | O(schema size) + cloneDeep |

Where:
- n = number of endpoints
- p = number of pattern routes (subset of n)
- s = number of path segments

---

## Recommendations for Further Optimization

### Steady Could:
1. Use worker threads for parallel schema processing on large specs
2. Implement HTTP/2 for connection multiplexing
3. Add response caching for deterministic generation

### Key Takeaways:
1. **Startup optimization matters** - 32x difference shows importance of pre-compilation
2. **Document-centric architecture** - Single source of truth simplifies caching
3. **Minimal dependencies** - Each import adds startup cost
4. **Avoid per-request allocations** - Pre-compile, pre-index, cache
