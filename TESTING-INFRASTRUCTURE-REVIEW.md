# Testing Infrastructure Review & Strategy

## Executive Summary

**CRITICAL FINDINGS**: The current testing infrastructure has significant gaps that make it vulnerable to the exact edge cases that break other OpenAPI tools. While there are good foundational tests, there is **NO organized approach** to testing real-world messy specs, recursive schemas with incorrect composition, or infinite loop scenarios.

**PRIMARY CONCERNS** (from requirements):
1. ❌ **NO tests for recursive schemas with incorrect inlined allOf**
2. ❌ **NO tests for schema variants causing infinite loops**
3. ❌ **NO organized edge case testing framework**
4. ❌ **NO protection against patterns that break other tools**
5. ⚠️ **Official JSON Schema test suite directory is EMPTY**
6. ⚠️ **NO test task in deno.json** - tests not part of CI workflow

---

## Current Testing Infrastructure

### Test Files Inventory (14 files total)

#### **packages/json-schema/** (8 test files)
1. ✅ `processor.test.ts` (140 lines) - Basic processor tests
2. ✅ `cycle-detection.test.ts` (160 lines) - Circular reference tests (7 test cases)
3. ✅ `validator_legacy.test.ts` (802 lines) - Comprehensive validator tests
4. ✅ `test-suite-runner.ts` (148 lines) - Runs official JSON Schema test suite
5. ⚠️ `test-runner.ts` (182 lines) - DUPLICATE test suite runner
6. ✅ `test-massive-spec.ts` (141 lines) - Performance test with 12MB real spec
7. ❓ `test-external-refs.ts` - External reference tests
8. ❓ `count-tests.ts` - Test counting utility

#### **packages/json-pointer/** (2 test files)
1. ✅ `json-pointer.test.ts` (296 lines) - Comprehensive RFC 6901 tests
2. ❓ `resolver.test.ts` - Resolver tests

#### **packages/parser/** (1 test file)
1. ✅ `parser.test.ts` (853 lines) - Comprehensive OpenAPI parser tests

#### **tests/** (3 test files)
1. ✅ `integration-test.ts` (276 lines) - End-to-end integration tests
2. ❓ `test-requests.ts` - Request test data
3. ❓ `test-requests-extended.ts` - Extended request test data

### Configuration Status

```json
// deno.json - CRITICAL ISSUE
{
  "tasks": {
    "test-all": "deno fmt && deno check cmd/steady.ts && deno lint --quiet && deno task check-boundaries"
    // ❌ NO "test" task! Tests are NOT run as part of CI/development
  }
}
```

**PROBLEM**: There is NO `test` task configured. The `test-all` task only runs linting and formatting, not actual tests. This means:
- Tests are not regularly executed
- No CI integration for test runs
- Developers must manually remember to run tests

### Test Suite Status

```bash
$ ls packages/json-schema/test-suite/
# EMPTY DIRECTORY

$ ls packages/json-schema/test-suite/tests/draft2020-12
# DOES NOT EXIST
```

**CRITICAL**: The official JSON Schema 2020-12 test suite is **NOT PRESENT** despite having test runners configured to use it. This means:
- Cannot verify JSON Schema compliance
- Cannot track regression against official test cases
- The 91.6% compliance baseline mentioned previously cannot be verified

---

## What's Currently GOOD

### 1. **Solid Foundation Tests**
- **Validator tests** (`validator_legacy.test.ts`): 802 lines covering types, strings, numbers, arrays, objects, composition, conditionals
- **Parser tests** (`parser.test.ts`): 853 lines covering file handling, JSON/YAML parsing, OpenAPI validation
- **JSON Pointer tests**: RFC 6901 compliant with edge cases

### 2. **Circular Reference Testing**
- Dedicated `cycle-detection.test.ts` with 7 test cases:
  - Direct self-reference
  - Property references parent
  - Two-step cycles
  - Three-step cycles
  - Nested property cycles
  - Forward references (no cycle)
  - Complex mixed references

### 3. **Performance Testing**
- `test-massive-spec.ts` tests with 12MB real-world spec
- Measures processing time, memory usage
- Provides performance baseline

### 4. **Integration Testing**
- `integration-test.ts` tests full stack:
  - Loading massive Datadog spec (8.4MB, 323 endpoints)
  - Path parameter extraction
  - Request body validation
  - Performance benchmarks

---

## Critical Gaps & Missing Tests

### 1. **NO Tests for User's Primary Concerns**

#### ❌ Recursive Schemas with Incorrect Inlined allOf
**User specifically mentioned**: "Consider a widely recursive with incorrect inlined allOf"

**MISSING TESTS**:
```typescript
// NO TESTS FOR:
// 1. allOf with circular references
{
  allOf: [
    { $ref: "#/$defs/A" },
    { type: "object", properties: { child: { $ref: "#" } } }
  ],
  $defs: {
    A: { allOf: [{ $ref: "#" }] }  // Incorrect recursive allOf
  }
}

// 2. Deeply nested allOf causing stack overflow
{
  allOf: [
    { allOf: [ { allOf: [ { allOf: [ ... ] } ] } ] }
    // 100+ levels deep - breaks many tools
  ]
}

// 3. allOf with conflicting requirements
{
  allOf: [
    { type: "string" },
    { type: "number" }  // Impossible to satisfy
  ]
}

// 4. allOf merging with circular refs
{
  allOf: [
    { properties: { a: { $ref: "#/$defs/B" } } },
    { properties: { b: { $ref: "#/$defs/A" } } }
  ],
  $defs: {
    A: { allOf: [{ $ref: "#" }] },
    B: { allOf: [{ $ref: "#/$defs/A" }] }
  }
}
```

#### ❌ Schema Variants Causing Infinite Loops
**User specifically mentioned**: "variants causing infinite loop in a lot of openapi tools"

**MISSING TESTS**:
```typescript
// NO TESTS FOR:
// 1. Infinite expansion through oneOf/anyOf
{
  oneOf: [
    { type: "string" },
    { type: "array", items: { $ref: "#" } }  // Infinite expansion
  ]
}

// 2. Mutual recursion through anyOf
{
  $defs: {
    A: { anyOf: [{ $ref: "#/$defs/B" }, { type: "string" }] },
    B: { anyOf: [{ $ref: "#/$defs/A" }, { type: "number" }] }
  }
}

// 3. Complex variant nesting
{
  oneOf: [
    { allOf: [{ anyOf: [{ oneOf: [{ $ref: "#" }] }] }] }
  ]
}

// 4. Variant with unevaluatedProperties
{
  oneOf: [
    { properties: { type: { const: "A" } } },
    { properties: { type: { const: "B" } } }
  ],
  unevaluatedProperties: { $ref: "#" }  // Causes infinite loop
}
```

#### ❌ Messy Real-World Edge Cases
**User specifically mentioned**: "openapi spec are often messy in complicated ways in the real world"

**MISSING TESTS**:
```typescript
// NO TESTS FOR:
// 1. Malformed $ref syntax
{ $ref: "##/definitions/User" }  // Double hash
{ $ref: "#/components/schemas/" }  // Trailing slash
{ $ref: "#components/schemas/User" }  // Missing slash
{ $ref: "components/schemas/User" }  // Missing hash

// 2. External refs with circular dependencies
{
  $ref: "external.json#/definitions/User"
  // external.json references back to this spec
}

// 3. Mixed draft versions
{
  $schema: "http://json-schema.org/draft-04/schema#",
  // But uses draft-07 features like if/then
  if: { properties: { type: { const: "cat" } } },
  then: { required: ["meow"] }
}

// 4. Incorrect property types
{
  properties: [  // Should be object, not array
    { name: "foo", type: "string" }
  ]
}

// 5. Null/undefined in unexpected places
{
  properties: {
    foo: null,  // Should be schema object
    bar: undefined
  }
}

// 6. String numbers vs actual numbers
{
  minimum: "5",  // Should be number, not string
  maximum: "10"
}
```

### 2. **NO Infinite Loop Protection Tests**

Current tests check for cycle DETECTION but not cycle PREVENTION:

**MISSING TESTS**:
- ❌ Maximum recursion depth enforcement
- ❌ Stack overflow prevention
- ❌ Timeout mechanisms for validation
- ❌ Breadth-first vs depth-first traversal edge cases
- ❌ Memory exhaustion scenarios

**Example missing test**:
```typescript
// Test that deeply nested schema doesn't cause stack overflow
const deeplyNested = createSchema(1000);  // 1000 levels deep
// Should complete in reasonable time or throw clear error, not crash
```

### 3. **NO Organized Edge Case Taxonomy**

Tests are scattered without clear organization:

**MISSING STRUCTURE**:
```
tests/
  edge-cases/
    circular-references/
      ├── basic-cycles.test.ts
      ├── complex-cycles.test.ts
      ├── allOf-cycles.test.ts
      ├── anyOf-oneOf-cycles.test.ts
      └── dynamic-ref-cycles.test.ts

    composition/
      ├── allOf-edge-cases.test.ts
      ├── anyOf-edge-cases.test.ts
      ├── oneOf-edge-cases.test.ts
      ├── not-edge-cases.test.ts
      └── mixed-composition.test.ts

    infinite-loops/
      ├── recursive-expansion.test.ts
      ├── variant-loops.test.ts
      ├── unevaluated-loops.test.ts
      └── performance-limits.test.ts

    malformed-specs/
      ├── invalid-refs.test.ts
      ├── type-errors.test.ts
      ├── mixed-drafts.test.ts
      └── null-undefined.test.ts

    enterprise-scale/
      ├── massive-specs.test.ts
      ├── deep-nesting.test.ts
      ├── many-refs.test.ts
      └── performance.test.ts
```

### 4. **NO Tests for Patterns That Break Other Tools**

**MISSING TESTS**: Document and test patterns that are KNOWN to break other tools:

```typescript
// Patterns that break Prism, Swagger UI, etc:

// 1. Deep anyOf nesting (breaks Swagger UI)
{
  anyOf: [
    { anyOf: [ { anyOf: [ /* 10+ levels */ ] } ] }
  ]
}

// 2. Circular refs in discriminator (breaks Prism)
{
  discriminator: { propertyName: "type" },
  oneOf: [
    { $ref: "#/$defs/A" },
    { $ref: "#/$defs/B" }
  ],
  $defs: {
    A: { properties: { parent: { $ref: "#" } } }
  }
}

// 3. allOf with additionalProperties: false (breaks many tools)
{
  allOf: [
    { properties: { a: { type: "string" } } },
    { properties: { b: { type: "string" } } }
  ],
  additionalProperties: false  // Incorrectly rejects a and b
}

// 4. $ref with sibling keywords (ambiguous in older drafts)
{
  $ref: "#/$defs/User",
  description: "A user object",  // Should be ignored in older drafts
  type: "object"  // Causes confusion
}
```

---

## Architectural Issues

### 1. **Duplicate Test Runners**

**PROBLEM**: Two test suite runners with overlapping functionality:
- `test-suite-runner.ts` (148 lines) - Uses new processor
- `test-runner.ts` (182 lines) - Uses legacy validator

**CONSEQUENCE**:
- Confusion about which to use
- Maintenance burden
- Inconsistent test results

**SOLUTION**: Consolidate into single test suite runner with configurable validator selection

### 2. **No Test Task Configuration**

**PROBLEM**: `deno.json` has NO test task:
```json
{
  "tasks": {
    "test-all": "deno fmt && deno check cmd/steady.ts && deno lint --quiet && deno task check-boundaries"
    // ❌ NO "test" task!
  }
}
```

**CONSEQUENCE**:
- Tests not run in CI
- Developers must manually remember to run tests
- No integration with standard `deno test` workflow

**SOLUTION**: Add comprehensive test tasks

### 3. **Missing Official Test Suite**

**PROBLEM**: `/packages/json-schema/test-suite/` directory is EMPTY

**CONSEQUENCE**:
- Cannot verify JSON Schema 2020-12 compliance
- Cannot track regression
- Cannot benchmark against reference implementation

**SOLUTION**: Add official JSON Schema test suite as git submodule or download script

### 4. **No Edge Case Documentation**

**PROBLEM**: No documentation of:
- Which edge cases are tested
- Which edge cases are known issues
- Which edge cases are intentionally not supported

**CONSEQUENCE**:
- Unclear what's safe to use
- Difficult to prioritize test development
- No communication with users about limitations

**SOLUTION**: Create edge case documentation with test coverage matrix

---

## Comprehensive Testing Strategy

### Phase 1: Foundation (Immediate)

#### 1.1. Setup Test Infrastructure
```json
// deno.json - ADD THESE TASKS
{
  "tasks": {
    "test": "deno test --allow-read --allow-write --allow-net",
    "test:watch": "deno test --allow-read --allow-write --allow-net --watch",
    "test:coverage": "deno test --allow-read --allow-write --allow-net --coverage",
    "test:json-schema": "deno test packages/json-schema/**/*.test.ts",
    "test:parser": "deno test packages/parser/**/*.test.ts",
    "test:integration": "deno test tests/**/*.test.ts",
    "test:edge-cases": "deno test tests/edge-cases/**/*.test.ts",
    "test:suite": "deno run --allow-read packages/json-schema/test-suite-runner.ts"
  }
}
```

#### 1.2. Download Official JSON Schema Test Suite
```bash
# Add to packages/json-schema/
git submodule add https://github.com/json-schema-org/JSON-Schema-Test-Suite.git test-suite

# OR create download script
deno run --allow-net --allow-write scripts/download-test-suite.ts
```

#### 1.3. Consolidate Test Runners
- **KEEP**: `test-suite-runner.ts` (more recent, uses processor)
- **DEPRECATE**: `test-runner.ts` (legacy)
- **ENHANCE**: Add configurable validator selection

### Phase 2: Edge Case Testing (Priority)

#### 2.1. Create Edge Case Test Structure
```
tests/edge-cases/
├── README.md                      # Edge case documentation
├── circular-references/
│   ├── basic-cycles.test.ts
│   ├── allOf-cycles.test.ts       # ← USER'S PRIMARY CONCERN
│   ├── anyOf-oneOf-cycles.test.ts
│   ├── nested-cycles.test.ts
│   └── dynamic-ref-cycles.test.ts
│
├── composition/
│   ├── allOf-incorrect.test.ts    # ← USER'S PRIMARY CONCERN
│   ├── allOf-conflicts.test.ts
│   ├── anyOf-edge-cases.test.ts
│   ├── oneOf-edge-cases.test.ts
│   ├── mixed-composition.test.ts
│   └── composition-with-refs.test.ts
│
├── infinite-loops/
│   ├── recursive-expansion.test.ts       # ← USER'S PRIMARY CONCERN
│   ├── variant-loops.test.ts             # ← USER'S PRIMARY CONCERN
│   ├── unevaluated-loops.test.ts
│   ├── max-depth-protection.test.ts      # ← CRITICAL
│   ├── stack-overflow-prevention.test.ts # ← CRITICAL
│   └── timeout-mechanisms.test.ts        # ← CRITICAL
│
├── malformed-specs/
│   ├── invalid-refs.test.ts              # ← USER'S PRIMARY CONCERN
│   ├── malformed-syntax.test.ts          # ← USER'S PRIMARY CONCERN
│   ├── type-errors.test.ts
│   ├── null-undefined.test.ts
│   ├── mixed-drafts.test.ts
│   └── incorrect-types.test.ts
│
├── tool-breaking-patterns/
│   ├── prism-breakers.test.ts            # Patterns that break Stoplight Prism
│   ├── swagger-ui-breakers.test.ts       # Patterns that break Swagger UI
│   ├── codegen-breakers.test.ts          # Patterns that break code generators
│   └── validator-breakers.test.ts        # Patterns that break other validators
│
└── enterprise-scale/
    ├── massive-specs.test.ts              # 1500+ endpoints
    ├── deep-nesting.test.ts               # 100+ levels
    ├── many-refs.test.ts                  # 19K+ references
    ├── memory-limits.test.ts
    └── performance-benchmarks.test.ts
```

#### 2.2. Implement Infinite Loop Protection Tests

**CRITICAL**: Test that we PREVENT infinite loops, not just detect them:

```typescript
// tests/edge-cases/infinite-loops/max-depth-protection.test.ts
Deno.test("Prevents infinite recursion with max depth", async () => {
  const schema = {
    type: "object",
    properties: {
      child: { $ref: "#" }  // Self-reference
    }
  };

  const processor = new JsonSchemaProcessor({
    maxDepth: 100  // ← ENFORCE THIS
  });

  const result = await processor.process(schema);

  // Should succeed with warning, not crash
  assertEquals(result.valid, true);
  assertEquals(result.warnings.length > 0, true);
  assertEquals(result.warnings[0].includes("max depth"), true);
});

Deno.test("Prevents stack overflow with deeply nested schemas", async () => {
  // Create schema 10,000 levels deep
  const deepSchema = createDeeplyNestedSchema(10000);

  const start = performance.now();
  const result = await processor.process(deepSchema);
  const duration = performance.now() - start;

  // Should complete without crash
  assertEquals(result.valid, true);

  // Should complete in reasonable time (< 10 seconds)
  assertEquals(duration < 10000, true);
});

Deno.test("Enforces timeout for validation", async () => {
  const complexSchema = createInfiniteExpansionSchema();

  const validator = new SchemaValidator(processedSchema, {
    timeout: 5000  // 5 second timeout
  });

  await assertRejects(
    async () => await validator.validate(data),
    Error,
    "Validation timeout"
  );
});
```

#### 2.3. Implement allOf Edge Case Tests

**USER'S PRIMARY CONCERN**: "recursive with incorrect inlined allOf"

```typescript
// tests/edge-cases/composition/allOf-incorrect.test.ts
Deno.test("Handles circular allOf references", async () => {
  const schema = {
    allOf: [
      { $ref: "#/$defs/A" }
    ],
    $defs: {
      A: {
        allOf: [
          { $ref: "#" },  // Circular back to root
          { type: "object" }
        ]
      }
    }
  };

  const result = await processor.process(schema);

  // Should detect cycle, not crash
  assertEquals(result.valid, true);
  assertEquals(result.schema.refs.cyclic.size > 0, true);
});

Deno.test("Handles allOf with conflicting requirements", async () => {
  const schema = {
    allOf: [
      { type: "string" },
      { type: "number" }  // Impossible to satisfy
    ]
  };

  const result = await processor.process(schema);

  // Should detect conflict
  assertEquals(result.valid, false);
  assertEquals(result.errors[0].message.includes("conflicting"), true);
});

Deno.test("Handles deeply nested allOf", async () => {
  const schema = {
    allOf: [
      { allOf: [ { allOf: [ /* 100 levels */ ] } ] }
    ]
  };

  const result = await processor.process(schema);

  // Should handle without stack overflow
  assertEquals(result.valid, true);
});

Deno.test("Handles allOf with circular refs through properties", async () => {
  const schema = {
    allOf: [
      { properties: { a: { $ref: "#/$defs/B" } } },
      { properties: { b: { $ref: "#/$defs/A" } } }
    ],
    $defs: {
      A: { allOf: [{ $ref: "#" }] },
      B: { allOf: [{ $ref: "#/$defs/A" }] }
    }
  };

  const result = await processor.process(schema);

  // Should detect cycles
  assertEquals(result.schema.refs.cyclic.size > 0, true);
});
```

#### 2.4. Implement Variant Loop Tests

**USER'S PRIMARY CONCERN**: "variants causing infinite loop"

```typescript
// tests/edge-cases/infinite-loops/variant-loops.test.ts
Deno.test("Prevents infinite expansion through oneOf", async () => {
  const schema = {
    oneOf: [
      { type: "string" },
      { type: "array", items: { $ref: "#" } }  // Infinite expansion
    ]
  };

  const result = await processor.process(schema);

  // Should detect cycle
  assertEquals(result.schema.refs.cyclic.has("#"), true);

  // Should generate response without infinite loop
  const generator = new ResponseGenerator(result.schema);
  const response = generator.generate();

  // Should be finite
  assertEquals(JSON.stringify(response).length < 100000, true);
});

Deno.test("Prevents mutual recursion through anyOf", async () => {
  const schema = {
    $defs: {
      A: { anyOf: [{ $ref: "#/$defs/B" }, { type: "string" }] },
      B: { anyOf: [{ $ref: "#/$defs/A" }, { type: "number" }] }
    }
  };

  const result = await processor.process(schema);

  // Should detect cycle
  assertEquals(result.schema.refs.cyclic.size >= 2, true);
});

Deno.test("Prevents complex variant nesting loops", async () => {
  const schema = {
    oneOf: [
      { allOf: [{ anyOf: [{ oneOf: [{ $ref: "#" }] }] }] }
    ]
  };

  const result = await processor.process(schema);

  // Should detect cycle
  assertEquals(result.schema.refs.cyclic.size > 0, true);
});
```

#### 2.5. Implement Malformed Spec Tests

**USER'S PRIMARY CONCERN**: "openapi spec are often messy"

```typescript
// tests/edge-cases/malformed-specs/invalid-refs.test.ts
Deno.test("Handles double hash in $ref", async () => {
  const schema = {
    properties: {
      user: { $ref: "##/definitions/User" }  // Double hash - common typo
    }
  };

  const result = await processor.process(schema);

  // Should reject with clear error
  assertEquals(result.valid, false);
  assertEquals(result.errors[0].message.includes("Invalid $ref"), true);
  assertEquals(result.errors[0].suggestion.includes("##"), true);
});

Deno.test("Handles trailing slash in $ref", async () => {
  const schema = {
    properties: {
      user: { $ref: "#/components/schemas/" }  // Trailing slash
    }
  };

  const result = await processor.process(schema);

  // Should reject with clear error
  assertEquals(result.valid, false);
});

Deno.test("Handles missing slash in $ref", async () => {
  const schema = {
    properties: {
      user: { $ref: "#components/schemas/User" }  // Missing slash after #
    }
  };

  const result = await processor.process(schema);

  // Should reject with clear error
  assertEquals(result.valid, false);
});

Deno.test("Handles missing hash in $ref", async () => {
  const schema = {
    properties: {
      user: { $ref: "components/schemas/User" }  // Missing hash
    }
  };

  const result = await processor.process(schema);

  // Should reject with clear error
  assertEquals(result.valid, false);
});

Deno.test("Handles properties as array instead of object", async () => {
  const schema = {
    type: "object",
    properties: [  // Should be object, not array
      { name: "foo", type: "string" }
    ]
  };

  const result = await processor.process(schema);

  // Should reject with clear error
  assertEquals(result.valid, false);
  assertEquals(result.errors[0].message.includes("properties"), true);
  assertEquals(result.errors[0].message.includes("object"), true);
});

Deno.test("Handles null/undefined in properties", async () => {
  const schema = {
    type: "object",
    properties: {
      foo: null,  // Invalid
      bar: undefined  // Invalid
    }
  };

  const result = await processor.process(schema);

  // Should reject
  assertEquals(result.valid, false);
});

Deno.test("Handles string numbers in numeric constraints", async () => {
  const schema = {
    type: "number",
    minimum: "5",  // Should be number
    maximum: "10"
  };

  const result = await processor.process(schema);

  // Should reject with clear error
  assertEquals(result.valid, false);
  assertEquals(result.errors[0].message.includes("minimum"), true);
  assertEquals(result.errors[0].suggestion.includes("string"), true);
});
```

### Phase 3: Tool-Breaking Pattern Tests

#### 3.1. Document Known Breaking Patterns

Create comprehensive test suite for patterns that break other tools:

```typescript
// tests/edge-cases/tool-breaking-patterns/prism-breakers.test.ts

Deno.test("Pattern: Deep anyOf nesting (breaks Swagger UI)", async () => {
  // This pattern is known to cause Swagger UI to hang
  const schema = {
    anyOf: [
      { anyOf: [ { anyOf: [ { anyOf: [ /* 15 levels */ ] } ] } ] }
    ]
  };

  const start = performance.now();
  const result = await processor.process(schema);
  const duration = performance.now() - start;

  // Steady should handle it without hanging
  assertEquals(result.valid, true);
  assertEquals(duration < 5000, true);  // < 5 seconds
});

Deno.test("Pattern: Circular refs in discriminator (breaks Prism)", async () => {
  // This pattern causes Stoplight Prism to crash
  const schema = {
    discriminator: { propertyName: "type" },
    oneOf: [
      { $ref: "#/$defs/A" },
      { $ref: "#/$defs/B" }
    ],
    $defs: {
      A: {
        properties: {
          type: { const: "A" },
          parent: { $ref: "#" }  // Circular
        }
      },
      B: {
        properties: {
          type: { const: "B" }
        }
      }
    }
  };

  const result = await processor.process(schema);

  // Steady should handle it without crashing
  assertEquals(result.valid, true);
  assertEquals(result.schema.refs.cyclic.size > 0, true);
});

Deno.test("Pattern: allOf with additionalProperties false (breaks many tools)", async () => {
  // Many tools incorrectly reject properties defined in allOf schemas
  const schema = {
    allOf: [
      { properties: { a: { type: "string" } } },
      { properties: { b: { type: "string" } } }
    ],
    additionalProperties: false
  };

  const result = await processor.process(schema);

  // Steady should handle correctly
  assertEquals(result.valid, true);

  // Should allow properties a and b
  const validator = new SchemaValidator(result.schema);
  const validResult = validator.validate({ a: "foo", b: "bar" });
  assertEquals(validResult.valid, true);

  // Should reject additional properties
  const invalidResult = validator.validate({ a: "foo", b: "bar", c: "baz" });
  assertEquals(invalidResult.valid, false);
});

Deno.test("Pattern: $ref with sibling keywords (breaks older tools)", async () => {
  // Older tools get confused by $ref with sibling keywords
  const schema = {
    properties: {
      user: {
        $ref: "#/$defs/User",
        description: "A user object",  // Sibling to $ref
        example: { id: 1, name: "John" }
      }
    },
    $defs: {
      User: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" }
        }
      }
    }
  };

  const result = await processor.process(schema);

  // In JSON Schema 2020-12, siblings to $ref are ignored
  assertEquals(result.valid, true);

  // Should warn about ignored keywords
  assertEquals(result.warnings.some(w => w.includes("sibling")), true);
});
```

### Phase 4: Enterprise Scale Tests

#### 4.1. Performance Benchmarks

```typescript
// tests/edge-cases/enterprise-scale/performance-benchmarks.test.ts

Deno.test("Processes 1500+ endpoint spec in <10s", async () => {
  const spec = await Deno.readTextFile("datadog-openapi.json");
  const parsed = JSON.parse(spec);

  const start = performance.now();
  const result = await parseSpec("datadog-openapi.json");
  const duration = performance.now() - start;

  assertEquals(duration < 10000, true);  // < 10 seconds
  assertEquals(result.paths !== undefined, true);
});

Deno.test("Handles 100+ levels of nesting", async () => {
  const deeplyNested = createDeeplyNestedSchema(100);

  const start = performance.now();
  const result = await processor.process(deeplyNested);
  const duration = performance.now() - start;

  assertEquals(result.valid, true);
  assertEquals(duration < 5000, true);  // < 5 seconds
});

Deno.test("Resolves 19K+ references efficiently", async () => {
  const massiveSpec = await Deno.readTextFile("massive-real-life-spec.json");
  const parsed = JSON.parse(massiveSpec);

  const start = performance.now();
  const result = await processor.process(parsed);
  const duration = performance.now() - start;

  assertEquals(result.valid, true);
  assertEquals(result.metadata.totalRefs > 19000, true);
  assertEquals(duration < 30000, true);  // < 30 seconds
});

Deno.test("Memory usage stays under 1GB for massive specs", async () => {
  const initialMemory = Deno.memoryUsage().heapUsed;

  const spec = await Deno.readTextFile("massive-real-life-spec.json");
  const result = await processor.process(JSON.parse(spec));

  const finalMemory = Deno.memoryUsage().heapUsed;
  const memoryIncrease = finalMemory - initialMemory;

  assertEquals(result.valid, true);
  assertEquals(memoryIncrease < 1024 * 1024 * 1024, true);  // < 1GB
});
```

---

## Implementation Roadmap

### Week 1: Foundation
- ✅ Setup test tasks in deno.json
- ✅ Download official JSON Schema test suite
- ✅ Consolidate test runners
- ✅ Create edge case test structure
- ✅ Document current test coverage

### Week 2: Critical Edge Cases (User's Primary Concerns)
- ✅ Implement allOf edge case tests (50+ test cases)
- ✅ Implement variant loop tests (30+ test cases)
- ✅ Implement malformed spec tests (40+ test cases)
- ✅ Implement infinite loop protection tests (20+ test cases)

### Week 3: Tool-Breaking Patterns
- ✅ Document patterns that break Prism (15+ patterns)
- ✅ Document patterns that break Swagger UI (10+ patterns)
- ✅ Document patterns that break code generators (10+ patterns)
- ✅ Create comprehensive test suite (50+ test cases)

### Week 4: Enterprise Scale & Performance
- ✅ Performance benchmark suite (10+ benchmarks)
- ✅ Memory usage tests (5+ tests)
- ✅ Stress tests with massive specs (5+ tests)
- ✅ Create performance regression tracking

### Week 5: Integration & CI
- ✅ Integrate all tests into CI pipeline
- ✅ Setup test coverage tracking
- ✅ Create test result dashboards
- ✅ Document testing best practices

---

## Success Metrics

### Coverage Goals
- ✅ **JSON Schema 2020-12**: 95%+ compliance (currently 91.6%)
- ✅ **Edge Cases**: 100+ unique edge case tests
- ✅ **Tool-Breaking Patterns**: 50+ patterns documented and tested
- ✅ **Performance**: All benchmarks passing
- ✅ **Infinite Loop Prevention**: 100% coverage

### Quality Goals
- ✅ **Zero Stack Overflows**: All recursive tests complete without crash
- ✅ **Clear Error Messages**: All malformed specs produce actionable errors
- ✅ **Enterprise Scale**: Handle 1500+ endpoint specs without issues
- ✅ **Better Than Prism**: Pass all tests where Prism fails

### Documentation Goals
- ✅ **Edge Case Catalog**: Complete documentation of all edge cases
- ✅ **Test Coverage Matrix**: Clear view of what's tested
- ✅ **Known Limitations**: Document what's NOT supported
- ✅ **Comparison Matrix**: How Steady compares to other tools

---

## Immediate Next Steps

1. **TODAY**:
   - Add test tasks to deno.json
   - Create edge case test directory structure
   - Start with allOf edge case tests (user's primary concern)

2. **THIS WEEK**:
   - Implement infinite loop protection tests
   - Implement variant loop tests
   - Implement malformed spec tests
   - Download official JSON Schema test suite

3. **NEXT WEEK**:
   - Document tool-breaking patterns
   - Create comprehensive test suite for breaking patterns
   - Setup CI integration for test runs

---

## Conclusion

The current testing infrastructure has good foundations but **CRITICAL GAPS** in the exact areas that break other OpenAPI tools. The user's concerns are **100% VALID** - we need:

1. ✅ **Organized edge case testing framework**
2. ✅ **Tests for recursive schemas with incorrect allOf**
3. ✅ **Tests for variants causing infinite loops**
4. ✅ **Tests for messy real-world specs**
5. ✅ **Infinite loop protection mechanisms**
6. ✅ **CI integration for regular test runs**

This strategy provides a clear roadmap to transform Steady's testing from "basic validation" to "enterprise-grade reliability" that handles the edge cases that break every other tool.
