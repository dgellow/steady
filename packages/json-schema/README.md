# JSON Schema Processor

JSON Schema 2020-12 processor for OpenAPI validation.

## Status

- JSON Schema 2020-12 compliance is measured by `test-suite.test.ts` against the
  official JSON Schema Test Suite (the `test-suite` submodule). The pass count
  and every failing case are in `__snapshots__/test-suite.test.ts.snap`.
- `deno task test:suite` prints the same result with details per failing case.
- Not validated: `if`/`then`/`else`, `dependentRequired`, `dependentSchemas`,
  `contains`, `minContains`, `maxContains`, `propertyNames`,
  `unevaluatedProperties`, `unevaluatedItems`, `$dynamicRef`, remote `$ref`.

## Dependencies

- `@steady/json-pointer`
