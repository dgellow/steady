# Steady

OpenAPI 3 mock server built with Deno. Validates SDKs against OpenAPI specs with
clear error attribution (SDK bug vs spec issue).

## Commands

**ALWAYS use the scripts in `scripts/` directory.

```bash
./scripts/bootstrap   # Install dependencies, setup environment
./scripts/test        # Run all tests
./scripts/lint        # Lint code
./scripts/format      # Format code
```

These scripts handle all the necessary flags and environment setup
automatically.

## Project Structure

```
steady/
├── cmd/steady.ts              # CLI entry point
├── src/                       # Main server
│   ├── server.ts              # HTTP server, request matching
│   ├── validator.ts           # Request/response validation
│   └── errors.ts              # Error types
├── packages/
│   ├── json-pointer/          # RFC 6901 implementation
│   │   ├── json-pointer.ts    # resolve(), set(), escape/unescape
│   │   ├── rfc6901-validator.ts # Syntax validation
│   │   └── resolver.ts        # Document reference resolver
│   ├── json-schema/           # JSON Schema 2020-12
│   │   ├── processor.ts       # Schema analysis
│   │   ├── runtime-validator.ts # Data validation
│   │   ├── response-generator.ts # Mock response generation
│   │   └── ref-resolver.ts    # $ref resolution
│   ├── parser/                # OpenAPI 3.x parser
│   │   └── parser.ts          # YAML/JSON parsing
│   └── shared/                # Common utilities
│       └── logger.ts          # Request logging
├── tests/edge-cases/          # Edge case tests
└── test-fixtures/
    └── openapi-directory/     # Git submodule: 1970 real-world specs (99.5% pass)
```

**Submodule**: Run `git submodule update --init` to fetch test fixtures.

## Key Technical Details

**Stack**: Deno 2.x, TypeScript strict mode, no frameworks

**JSON Pointer (RFC 6901)**:

- Only `~0` (tilde) and `~1` (slash) escaping - NO percent encoding
- Percent-decoding happens at URI fragment layer (ref-resolver.ts:171)
- Array indices must be exact: "0", "1", "10" - reject "01", "1.5", "-1"

**JSON Schema**: 91.6% compliance (1151/1257 tests). Missing:
unevaluatedProperties, unevaluatedItems, dynamicRef.

**$ref Resolution**: Handles URI fragment encoding. `#/$defs/User%20Name`resolves
to key`"User
Name"` (percent-decoded before JSON Pointer parsing).

## Code Rules

1. **Read before modify** - Never change code you haven't read
2. **No type hacks** - No `as`, no `!` assertions to silence errors
3. **No silent failures** - Never swallow errors or return fake success
4. **Test with red-green** - Write failing test first, then fix
5. **Fail loudly** - Invalid input = error, not silent pass
6. **No hacky solutions** - Use standard libraries (e.g., `@std/cli` for arg
   parsing), don't reinvent the wheel with brittle manual implementations

## Testing Approach

**RED-GREEN TESTING IS MANDATORY**: Always write a failing test BEFORE fixing a
bug.

1. Write a test that exposes the bug (should fail - RED)
2. Run the test to confirm it fails
3. Fix the bug
4. Run the test to confirm it passes (GREEN)
5. Run all tests to ensure no regressions

```bash
# Run all tests
./scripts/test

# Run specific test file
./scripts/test packages/json-pointer/json-pointer.test.ts

# Run with filter
./scripts/test --filter "RFC 6901"
```

Tests must pass before committing. Use `./scripts/test` to verify.

## Error Messages

Errors must include:

- WHAT failed (specific validation/parsing error)
- WHERE (file:line or JSON path)
- WHY (root cause)
- HOW to fix (actionable suggestion)

## Commit Style

```
fix: Description of bug fix
feat: New feature
docs: Documentation only
test: Test additions/changes
refactor: Code restructuring
```

## Current Status

Working:

- HTTP server with path matching
- JSON Schema validation (runtime-validator.ts)
- Response generation from schemas/examples
- RFC 6901 JSON Pointer operations
- OpenAPI 3.x parsing

Test coverage gaps:

- response-generator.ts (limited tests)
