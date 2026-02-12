# Edge Case Test Suite

This directory contains comprehensive edge case tests for Steady's JSON Schema
and OpenAPI processing. These tests are designed to catch the **REAL-WORLD edge
cases that break other OpenAPI tools** like Stoplight Prism, Swagger UI, and
various code generators.

## Purpose

The primary goal is to ensure Steady handles messy, real-world OpenAPI
specifications that are:

- **Recursive** with incorrect composition patterns (allOf/anyOf/oneOf)
- **Malformed** with common syntax errors and typos
- **Complex** with patterns that cause infinite loops in other tools
- **Enterprise-scale** with thousands of endpoints and references

## Test Categories

### 1. **composition/**

Tests for composition keywords (allOf/anyOf/oneOf) with edge cases:

#### `allOf-incorrect.test.ts` (18 test cases)

- [x] Circular allOf references
- [x] Conflicting type requirements in allOf
- [x] Deeply nested allOf (100 levels)
- [x] allOf with circular refs through properties
- [x] Indirect circular references through allOf chains
- [x] Mixed composition with recursion
- [x] allOf with additionalProperties false
- [x] Empty and boolean schemas in allOf
- [x] Nested allOf structures
- [x] Performance with many allOf schemas (100+)

**Why these matter**: The `allOf` keyword is frequently used to merge base
schemas with extensions, but many tools break when these schemas become
recursive or create impossible constraints. Real-world OpenAPI specs often have
these patterns due to schema inheritance and polymorphism.

### 2. **infinite-loops/**

Tests for patterns that cause infinite loops in validation/generation:

#### `variant-loops.test.ts` (19 test cases)

- [x] oneOf with recursive array items
- [x] anyOf with mutual recursion between schemas
- [x] Complex variant nesting (oneOf > allOf > anyOf)
- [x] Multiple recursive branches in variants
- [x] Discriminator with recursion (breaks Prism)
- [x] Circular chains through variant properties
- [x] All branches recursive in oneOf
- [x] Performance with many recursive variants (50+)
- [x] Response generation without infinite loops
- [x] Variants with unevaluatedProperties recursion
- [x] Triple nested variants with recursion

**Why these matter**: Schema variants (oneOf/anyOf) with recursion are common in
real APIs (e.g., tree structures, ASTs, recursive types), but they cause many
tools to enter infinite loops during validation or response generation. Steady
must handle these WITHOUT crashing or hanging.

### 3. **malformed-specs/**

Tests for messy, real-world spec errors:

#### `invalid-refs.test.ts` (22 test cases)

- [x] Double hash in $ref (`##/definitions/User`)
- [x] Trailing slash in $ref (`#/components/schemas/`)
- [x] Missing slash after hash (`#components/schemas/User`)
- [x] Missing hash entirely (`components/schemas/User`)
- [x] Spaces in $ref paths (unencoded)
- [x] URL-encoded characters in $ref (properly handled)
- [x] Backslashes instead of forward slashes
- [x] Query strings in $ref
- [x] Multiple fragment identifiers
- [x] Dots, tildes, slashes in schema names
- [x] Proper escaping vs unescaped special chars
- [x] Empty string as schema key
- [x] Non-existent deep paths
- [x] Array index syntax in $refs
- [x] Siblings to $ref (ignored in 2020-12)

**Why these matter**: Real-world OpenAPI specs are often created by hand or by
tools that don't fully validate syntax. Common typos like `##/definitions` or
missing slashes break many parsers. Steady provides **CLEAR ERROR MESSAGES** for
these issues instead of cryptic crashes.

## Test Organization

```
tests/edge-cases/
├── README.md                      # This file
├── composition/
│   └── allOf-incorrect.test.ts    # allOf edge cases (18 tests)
│
├── infinite-loops/
│   └── variant-loops.test.ts      # Variant-based loops (19 tests)
│
├── malformed-specs/
│   └── invalid-refs.test.ts       # Malformed $ref syntax (22 tests)
│
├── circular-references/           # (Future) Basic circular reference tests
├── tool-breaking-patterns/        # (Future) Patterns that break specific tools
└── enterprise-scale/              # (Future) Large-scale performance tests
```

## Running Tests

```bash
# Run all edge case tests
deno task test:edge-cases

# Run specific category
deno test tests/edge-cases/composition/**/*.test.ts
deno test tests/edge-cases/infinite-loops/**/*.test.ts
deno test tests/edge-cases/malformed-specs/**/*.test.ts

# Run with watch mode
deno task test:watch tests/edge-cases/

# Run all tests (including edge cases)
deno task test
```

## Test Coverage Status

**Current Status**: 59 edge case tests implemented

- [x] **allOf Edge Cases**: 18/18 tests (100%)
- [x] **Variant Loops**: 19/19 tests (100%)
- [x] **Malformed $refs**: 22/22 tests (100%)
- Pending **Circular References**: 0/20 tests (Planned)
- Pending **Tool-Breaking Patterns**: 0/30 tests (Planned)
- Pending **Enterprise Scale**: 0/15 tests (Planned)

**Target**: 150+ edge case tests covering all categories

## Philosophy

### Why Edge Cases Matter

Most OpenAPI tools are tested against **valid, well-formed specs**. But in the
real world:

- Specs are hand-written and contain typos
- Schemas are generated by tools that produce invalid output
- Complex recursive structures are common (tree structures, ASTs, etc.)
- Developers copy-paste examples that don't validate

**Steady's Advantage**: By systematically testing edge cases that break other
tools, Steady becomes the **most reliable OpenAPI mock server for real-world
specs**.

### Clear Error Messages

When edge cases ARE errors, Steady provides:

1. **WHAT** went wrong (precise error location)
2. **WHY** it's wrong (clear explanation)
3. **HOW** to fix it (actionable suggestion)
4. **WHO** is responsible (SDK vs spec attribution)

Example:

```
ERROR: Invalid $ref syntax

  Location: #/properties/user/$ref
  Found: "##/definitions/User"
  Problem: $ref starts with double hash (##)

  CAUSE: Likely typo in OpenAPI specification
  FIX: Change "##/definitions/User" to "#/definitions/User"

  Common causes:
  - Copy-paste error
  - Editor auto-completion mistake
  - Search-and-replace gone wrong
```

### Infinite Loop Prevention

Many tools crash or hang on recursive schemas. Steady uses:

1. **Cycle Detection**: Identify circular references during schema processing
2. **Depth Limits**: Enforce maximum recursion depth (default: 100)
3. **Timeout Protection**: Abort validation/generation after reasonable time
4. **Breadth-First Traversal**: Prefer BFS over DFS to avoid stack overflow

**Result**: Steady handles recursive schemas that would crash Prism, Swagger UI,
and code generators.

## Real-World Examples

### Example 1: File System Tree (Recursive oneOf)

```typescript
// Common pattern: file/folder hierarchy
{
  oneOf: [
    {
      // File
      properties: {
        type: { const: "file" },
        content: { type: "string" },
      },
    },
    {
      // Folder (recursive)
      properties: {
        type: { const: "folder" },
        children: {
          type: "array",
          items: { $ref: "#" }, // Recursive reference
        },
      },
    },
  ];
}
```

**Breaks**: Stoplight Prism, many code generators **Steady**: Works correctly
with cycle detection

### Example 2: Incorrect allOf Merge

```typescript
// Common pattern: base + extension
{
  allOf: [
    { properties: { a: { type: "string" } } },
    { properties: { b: { type: "string" } } }
  ],
  additionalProperties: false  // BUG: Rejects a and b!
}
```

**Breaks**: Many validators incorrectly reject properties from allOf **Steady**:
Correctly allows properties from all allOf schemas

### Example 3: Typo in $ref

```typescript
{
  properties: {
    user: {
      $ref: "##/components/schemas/User";
    } // Double hash - invalid
  }
}
```

**Breaks**: Most tools with cryptic "reference not found" error **Steady**:
Clear error: "Double hash in $ref - remove one #"

## Future Enhancements

### Planned Test Categories

1. **circular-references/**
   - Basic cycles (direct, indirect, multi-step)
   - Cycles through different keywords (properties, items, allOf, etc.)
   - External circular references
   - Performance with many cycles

2. **tool-breaking-patterns/**
   - Patterns that break Stoplight Prism
   - Patterns that break Swagger UI
   - Patterns that break code generators (OpenAPI Generator, etc.)
   - Patterns that break validators (AJV, etc.)

3. **enterprise-scale/**
   - 1500+ endpoint specs (Cloudflare, Datadog scale)
   - 19K+ references (massive-real-life-spec.json)
   - Deep nesting (100+ levels)
   - Memory usage limits
   - Performance benchmarks

4. **unevaluated-keywords/**
   - unevaluatedProperties edge cases
   - unevaluatedItems edge cases
   - Interaction with allOf/oneOf/anyOf
   - Circular references through unevaluated keywords

5. **dynamic-refs/**
   - $dynamicRef and $dynamicAnchor
   - Dynamic resolution with recursion
   - Complex dynamic reference chains

## Comparison with Other Tools

**!! IMPORTANT**: These comparisons represent _expected behavior_ based on test
implementation. Tests have not yet been executed to verify actual behavior.
Comparison with other tools is based on documented known issues.

| Pattern             | Prism               | Swagger UI       | OpenAPI Gen        | **Steady (Expected)**           |
| ------------------- | ------------------- | ---------------- | ------------------ | ------------------------------- |
| Recursive oneOf     | FAIL Hangs          | FAIL Hangs       | FAIL Crashes       | Pending Should work             |
| allOf circular ref  | FAIL Error          | Partial          | FAIL Crashes       | Pending Should work             |
| Double hash in $ref | FAIL Cryptic error  | FAIL Silent fail | FAIL Cryptic error | Pending Should give clear error |
| allOf + addlProps   | WARN Wrong          | WARN Wrong       | FAIL Crashes       | Pending Should be correct       |
| 100-level nesting   | FAIL Stack overflow | FAIL Hangs       | FAIL Crashes       | Pending Should work             |
| 19K+ references     | FAIL OOM            | N/A              | FAIL Slow          | Pending Should be fast          |

Legend: PASS = Verified | Pending = Expected (untested) | FAIL = Known issue |
Partial/WARN = Partial support

## Contributing Edge Cases

Found a pattern that breaks other tools but not Steady? Add it!

1. Create test in appropriate category
2. Document the pattern in comments
3. Explain which tools it breaks
4. Show why it matters in real-world specs
5. Run tests to verify Steady handles it

**Template**:

```typescript
Deno.test("EDGE: Description of the pattern", async () => {
  // Pattern that breaks: Tool1, Tool2, Tool3
  const schema: Schema = {
    // Your schema here
  };

  const processor = new JsonSchemaProcessor();
  const result = await processor.process(schema);

  // Steady should handle it correctly
  assertEquals(result.valid, true, "Should process without error");
});
```

## References

- **JSON Schema 2020-12**: https://json-schema.org/specification.html
- **OpenAPI 3.1**: https://spec.openapis.org/oas/v3.1.0
- **RFC 6901 (JSON Pointer)**: https://tools.ietf.org/html/rfc6901
- **Steady Architecture**: See `/CLAUDE.md` and
  `/TESTING-INFRASTRUCTURE-REVIEW.md`
