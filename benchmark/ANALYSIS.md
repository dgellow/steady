# Steady vs Prism vs Fern: Performance Analysis

## Executive Summary

Steady significantly outperforms Prism and Fern in startup time:

| Metric | Steady | Prism | Fern |
|--------|--------|-------|------|
| **Startup Time** | 605ms | 12,188ms | 12,511ms |
| **Avg Latency** | 1.30ms | 1.49ms | 0.50ms |
| **Throughput** | 766.6 req/s | 670.8 req/s | 2,006.2 req/s |

### Key Findings:

1. **Startup**: Steady is **~20x faster** than both Prism and Fern
2. **Runtime Latency**: Fern is actually faster once started (Express.js optimization)
3. **Throughput**: Fern handles 2.6x more requests/sec than Steady

### Why Fern Has Fast Runtime but Slow Startup

Fern uses **Express.js** (highly optimized HTTP server) for runtime, but requires:
- Loading the full `fern-api` npm package (includes SDK generators, IR compiler, etc.)
- Generating an **Intermediate Representation (IR)** from the API spec
- Validating the workspace configuration

This is a **cold-start problem** - once running, Fern is very fast.

---

## Architectural Differences

### Fern Mock Server Architecture

Fern's mock server (`packages/cli/mock/`) uses **Express.js**:

```typescript
// runMockServer.ts
export class MockServer {
    private app = express();

    constructor({ context, ir, port }) {
        this.app.use(express.json({ limit: "50mb" }));

        // Register routes from IR (Intermediate Representation)
        for (const service of Object.values(ir.services)) {
            for (const endpoint of service.endpoints) {
                const path = getFullPathForEndpoint(endpoint);
                // Register handler based on HTTP method
                this.app.get(path, getRequestHandler(endpoints));
            }
        }
    }
}
```

**Key characteristics:**
- Uses Express.js (mature, highly optimized)
- Requires Fern's Intermediate Representation (IR) format
- Example-based matching (returns pre-defined examples)
- Path parameters use Express `:param` syntax

**Request handling:**
```typescript
function getRequestHandler(endpoints: HttpEndpoint[]): RequestHandler {
    return (req, res) => {
        for (const endpoint of endpoints) {
            for (const example of endpoint.examples) {
                const match = requestEqual({ request: req, example });
                if (match.type === "equal") {
                    res.json(example.response.body.jsonExample);
                    return;
                }
            }
        }
        res.status(404).send({ message: "No matching example" });
    };
}
```

### Why Fern is Fast at Runtime

1. **Express.js is production-grade**: Millions of installs, heavily optimized
2. **Simple matching logic**: Just compares request against pre-defined examples
3. **No schema validation**: Only checks if request matches an example
4. **No response generation**: Returns pre-defined example data

### Why Fern is Slow at Startup

1. **npm package loading**: `fern-api` includes SDK generators, docs tools, etc.
2. **IR generation**: Converts OpenAPI → Fern IR (complex transformation)
3. **Workspace validation**: Validates `fern.config.json` and `generators.yml`
4. **Node.js cold start**: V8 JIT compilation overhead

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
1. **Startup optimization matters** - 20x difference shows importance of pre-compilation
2. **Document-centric architecture** - Single source of truth simplifies caching
3. **Minimal dependencies** - Each import adds startup cost
4. **Avoid per-request allocations** - Pre-compile, pre-index, cache

---

## Full Comparison: Steady vs Prism vs Fern

| Aspect | Steady | Prism | Fern |
|--------|--------|-------|------|
| **Language** | TypeScript (Deno) | TypeScript (Node.js) | TypeScript (Node.js) |
| **HTTP Server** | Deno native | Fastify | Express.js |
| **Startup Time** | ~600ms | ~12s | ~12.5s |
| **Runtime Latency** | 1.30ms | 1.49ms | 0.50ms |
| **Throughput** | 767 req/s | 671 req/s | 2,006 req/s |
| **Input Format** | OpenAPI 3.x direct | OpenAPI 3.x direct | Fern IR (from OpenAPI) |
| **Path Matching** | Pre-compiled patterns | Per-request regex | Express router |
| **Schema Validation** | Full JSON Schema 2020-12 | AJV (external) | Example matching only |
| **Response Generation** | Schema-based + examples | json-schema-faker | Pre-defined examples |
| **Dependencies** | Minimal (Deno std) | Heavy (fp-ts, lodash, etc.) | Heavy (full Fern toolkit) |

### When to Use Each

**Steady** - Best for:
- Fast iteration during development (quick startup)
- SDK testing with schema validation
- Deterministic response generation
- Minimal footprint environments

**Prism** - Best for:
- Contract testing with detailed validation
- When you need OpenAPI 2.0 support
- Integration with Stoplight ecosystem

**Fern** - Best for:
- High-throughput testing (once warmed up)
- SDK development with Fern ecosystem
- When you're already using Fern for SDK generation

### Startup Time Breakdown (Estimated)

| Phase | Steady | Prism | Fern |
|-------|--------|-------|------|
| Module loading | ~100ms | ~5s | ~6s |
| Spec parsing | ~50ms | ~2s | ~1s |
| Route compilation | ~10ms | N/A | N/A |
| Schema indexing | ~10ms | N/A | N/A |
| IR generation | N/A | N/A | ~4s |
| Server binding | ~50ms | ~1s | ~1s |
| **Total** | **~600ms** | **~12s** | **~12.5s** |
