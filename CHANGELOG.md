# Changelog

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
