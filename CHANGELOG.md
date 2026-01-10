# Changelog

## 0.7.0

### Features

- add CLI flags for streaming defaults <details><summary>Details</summary>
  Add --stream-count and --stream-interval CLI flags to set server-wide
  defaults for streaming responses. Headers still override per-request.<br>
  - Add StreamingConfig interface to types.ts
  - Add --stream-count=&lt;n&gt; (default: 5, max: 1000)
  - Add --stream-interval=&lt;n&gt; (default: 100ms, max: 10000ms)
  - Add getEffectiveStreamingOptions() to merge config with headers
  - Document in CLI help under "Streaming Options"
</details>

- add warn function to logging and use for invalid NDJSON examples <details><summary>Details</summary>
  - Add warn() function to logging/mod.ts for general warnings
  - Use warn() in streaming.ts when NDJSON example is invalid
  - Warning includes yellow color and [Steady] prefix
</details>

- add NDJSON example support for multiline strings and arrays <details><summary>Details</summary>
  Add support for spec examples in JSONL/NDJSON streaming responses:
  - Array of objects: each object is streamed as a JSON line
  - Multiline string: each line is parsed as JSON and streamed<br>
  Unlike schema-generated NDJSON, example-based responses do not include
  _stream metadata, preserving the exact example content.<br>
  New exports:
  - isNDJSONExample(): detects valid NDJSON examples
  - parseNDJSONExample(): parses multiline strings or arrays
</details>


### Code Refactoring

- redesign logging system with unified event model <details><summary>Details</summary>
  - Replace old loggers with Logger interface and implementations
    (TextLogger, JsonLogger, TuiLogger)
  - Add complete validation context: path, specPointer, keyword,
    expected, actual, attribution, suggestion
  - Schema analyzer now reports per-schema complexity/nesting with
    specific pointers instead of useless global metrics
  - Add --log-format flag for text/json output selection
  - Fix SIGINT handling: server owns shutdown in all modes
  - Exclude test-fixtures/openapi-directory from deno commands
</details>


### Documentation

- add streaming headers to CLI help output <details><summary>Details</summary>
  Document X-Steady-Stream-Count and X-Steady-Stream-Interval-Ms headers
  in the CLI help for consistency with other per-request override headers.
</details>


## 0.6.0

### Features

- add streaming support for NDJSON and SSE responses
  <details><summary>Details</summary> Adds streaming response support for:
  - NDJSON formats: application/x-ndjson, application/jsonl,
    application/json-seq
  - Server-Sent Events: text/event-stream<br> Features:
  - Schema-based streaming generates items from JSON Schema
  - Example-based SSE supports event sequences with different event types
  - OpenAI-style SSE pattern (data-only events like [DONE])
  - Configurable stream count and interval via headers
  - Auto-appends done event for SSE stream completion
  - Deterministic streaming with seeded RNG<br> Headers:
  - X-Steady-Stream-Count: Number of items (default: 5, max: 1000)
  - X-Steady-Stream-Interval-Ms: Delay between items (default: 100ms)

</details>

## 0.5.1

### Bug Fixes

- remove non-standard $id basename matching
- address issues found in codebase review

### Documentation

- clarify red-green testing applies to all fixes, not just bugs

### Tests

- add tests for RNG determinism and $id lookup behavior

## 0.5.0

### Features

- Add form data parsing for request body validation
- Support full OpenAPI query parameter serialization matrix

### Documentation

- Add investigation standards to CLAUDE.md

### Tests

- Add parameter suite for comprehensive edge case testing

### CI

- Add TypeScript SDK integration test runner

## 0.4.4

### Bug Fixes

- remove bin field from platform-specific npm packages
- update repository URL to dgellow/steady for npm provenance

## 0.4.3

### Documentation

- add deno run example to installation
- update installation section with npx usage

### Chores

- revert npm publish to OIDC auth with provenance

## 0.4.2

### Chores

- switch npm publish to token auth (temporary)

## 0.4.1

### Chores

- update npm to latest in publish workflow

## 0.4.0

### Features

- add version file for pls sync
- Add npm publishing with platform-specific packages

### Chores

- disable Deno caching for release workflows
- always use latest pls version in CI workflows
- update CI workflows and manifest for new pls
