# Changelog

## 0.15.1

### Chores

- More fixes (#86) <details><summary>Details</summary>
  * fix: return {} for void responses when client accepts JSON<br>
  Previously returned Content-Type: application/json with empty body,
  causing JSON parse errors. Now returns {} when client accepts JSON,
  or no body when they don't. Skips for 204/304 per HTTP spec.<br>
  * fix: skip readOnly properties in required validation<br>
  Per OpenAPI spec, readOnly properties are server-provided and should
  not be required in request bodies.<br>
  * fix: handle empty JSON body gracefully instead of crashing<br>
  * ci: add Node.js and pnpm for TypeScript SDK tests<br>
  * chore: formatting
</details>


## 0.15.0

### Features

- skip pytest's skip markers in api_resources tests (#78)
  <details><summary>Details</summary> Inject a conftest.py hook that removes
  @pytest.mark.skip and @pytest.mark.skipif markers at collection time for tests
  in tests/api_resources. This ensures all SDK tests run against the mock
  server, even tests that would normally be skipped.<br> Based on:
  https://github.com/pytest-dev/pytest/discussions/13311<br> Co-authored-by:
  Claude &lt;noreply@anthropic.com&gt;

</details>

### Bug Fixes

- correctly resolve ref for validation context (#85)
  <details><summary>Details</summary>
  - fix: correctly resolve for validation context<br>
  - test: make missing responses and duplicate param tests fail properly

</details>

### Tests

- add cursed spec for missing responses (failing test) (#84)
  <details><summary>Details</summary>
  - test: add cursed spec for missing responses (failing test)<br> Add test
    fixture and failing test for endpoints with no responses object. Per OAS
    3.1.0 Section 4.8.16: "The Responses Object MUST contain at least one
    response code."<br>
  * Empty responses `{}` correctly rejected at parse time
  * Missing responses field incorrectly accepted (BUG)<br> Test will pass once
    parser validates required responses field.<br>
    https://claude.ai/code/session_01BAstPdGCPN9Un7dwsDmFvS<br>
  - test: add cursed spec for duplicate path parameter names<br> Add
    `/users/{id}/posts/{id}` - same param name twice in path. OAS 3.1.0 Section
    4.8.9.1: "Each parameter MUST have a unique name within the path
    template."<br> Currently: Steady silently accepts (BUG) Expected: Should
    reject or warn<br>
    https://claude.ai/code/session_01BAstPdGCPN9Un7dwsDmFvS<br>
  - chore: format CHANGELOG.md<br>
    https://claude.ai/code/session_01BAstPdGCPN9Un7dwsDmFvS<br> ---------<br>
    Co-authored-by: Claude &lt;noreply@anthropic.com&gt;

</details>

## 0.14.0

### Features

- add SDK test regression reporting to CI <details><summary>Details</summary>
  - Add JSON output mode to test-sdks.ts with --json and --output flags
  - Upload SDK test results as artifacts (retained for 90 days)
  - Download baseline from main branch on PRs for comparison
  - Post PR comment showing regressions, improvements, and new SDKs
  - Fail CI if any SDK regresses from passing to failing
  - Show vs main diff in summary table<br> The PR comment includes:
  - Summary table with total/passed/failed counts
  - Regressions section (passing on main, now failing)
  - Improvements section (failing on main, now passing)
  - New SDKs section (not in baseline)
  - Full results in collapsible details

</details>

### Bug Fixes

- only generate required properties in response generator
  <details><summary>Details</summary> Remove random inclusion of optional
  properties (previously 50% chance). This ensures consistent, minimal responses
  and avoids flaky SDK tests where pagination responses would randomly omit
  `items` arrays.<br> Added TODO comment to revisit optional property generation
  strategy. Updated tests that relied on optional properties being generated.

</details>

- support paths with same pattern but different methods
  <details><summary>Details</summary> When an OpenAPI spec defines multiple
  paths with the same URL structure but different parameter names and HTTP
  methods (e.g., DELETE on /secrets/{secret_id} and POST on
  /secrets/{secret_key}), Steady now:<br>
  1. Matches requests correctly at runtime by continuing to search through
     pattern routes when a path structure matches but the method doesn't exist
     on that particular path definition.<br>
  2. Emits a warning at startup that these paths violate OpenAPI 3.0.3
     ("Templated paths with the same hierarchy but different templated names
     MUST NOT exist as they are identical").<br> The warning is informational -
     both paths remain fully functional for their respective methods. This
     ensures accurate error attribution: the spec has a validity issue, but
     Steady handles it gracefully.<br> Implementation details:
  - PathAnalyzer detects duplicate patterns using normalized base paths
  - Handles Steady's query-param routing extension (/path?key=val)
  - Runtime matching tracks first path match for "method not allowed" errors
  - All paths remain separate in data structures for correct diagnostics

</details>

### Tests

- add ArcadeAI SDK to integration tests <details><summary>Details</summary>
  ArcadeAI (arcade-py) is a Stainless-generated Python SDK with the same
  structure as OpenAI, Anthropic, etc. Their spec triggered the
  duplicate-path-patterns issue that led to this branch's fix.

</details>

### Chores

- add cursed-specs collection for invalid OAS patterns
  <details><summary>Details</summary> Move the duplicate-path-patterns spec to
  test-fixtures/cursed-specs/ with documentation explaining:
  - What violation it demonstrates
  - Real-world source (ArcadeAI)
  - How different tools handle it
  - Why Steady supports it gracefully<br> This starts a collection for testing
    Steady against real-world invalid specs that other tools struggle with.

</details>

### Styles

- format code

## 0.13.1

### Bug Fixes

- handle SIGTERM/SIGHUP for graceful server shutdown
  <details><summary>Details</summary>
  - Server handles common shutdown signals (SIGINT, SIGTERM, SIGHUP, SIGQUIT)
  - npm wrapper forwards all signals to child (transparent wrapper)
  - Added bash test script for process cleanup (tests both deno and npm)

</details>

## 0.13.0

### Features

- log request body with --log-bodies flag <details><summary>Details</summary>
  The validator now returns the parsed request body in ValidationResult, which
  is then passed to the logger for display when --log-bodies is set.<br>
  Changes:
  - Add requestBody field to ValidationResult in validator.ts
  - Return parsed body from validateRequestBodyFromRequest
  - Pass request body through logRequestEvent to the event

</details>

## 0.12.1

### Bug Fixes

- pass response body to logger for --log-bodies to work
  <details><summary>Details</summary> The previous fix added the logBodies
  option to loggers but the response body was never passed to logRequestEvent.
  This change:<br>
  - Updates generateResponse to return { response, body }
  - Passes responseBody to logRequestEvent
  - Adds body to the RequestEvent for logging

</details>

## 0.12.0

### Features

- add --version flag to CLI <details><summary>Details</summary> Print version
  number and exit when --version is passed.

</details>

### Bug Fixes

- --log-bodies flag now correctly shows request/response bodies
  <details><summary>Details</summary> The logBodies option was defined in config
  but never passed to loggers.<br> Changes:
  - Add logBodies to LoggerOptions interface
  - Add shouldShowBodies() helper to BaseLogger
  - Pass logBodies from ServerConfig to all logger constructors
  - Update TextLogger, TuiLogger, JsonLogger to use shouldShowBodies()
  - Add tests for logBodies behavior in summary mode

</details>

### Tests

- add comprehensive tests for file extension paths
  <details><summary>Details</summary> Verify path matching works correctly with
  file extensions:
  - Literal paths (/openapi.json)
  - Parameterized paths with extension suffix (/{filename}.json)
  - Multi-segment paths (/files/{name}.json)
  - Multiple dots (/{name}.min.js)
  - Dots in prefixes (/api.v{version}/users)
  - Extension mismatches and edge cases

</details>

## 0.11.0

### Features

- add descriptive server startup message <details><summary>Details</summary>
  Display "Steady server listening on &lt;url&gt; (&lt;mode&gt; mode)" on
  startup for clearer feedback when the server begins accepting connections.

</details>

Version changed from 0.10.0-alpha.0 to 0.10.0

Version changed from 0.9.0 to 0.10.0-alpha.0

## 0.9.0

### Features

- add undocumented 'debug' as alias for 'full' log level
- add undocumented -v and --verbose CLI flags as aliases for --log-level

## 0.8.1

### Chores

- Log fatal error message before shutdown <details><summary>Details</summary>
  Print something simple to parse

</details>

## 0.8.0

### Features

- support query strings in OpenAPI path definitions
  <details><summary>Details</summary> Some APIs (like Anthropic) define paths
  with embedded query strings (e.g., /files?beta=true) to distinguish between
  different API versions.<br>
  - Parse query strings from paths during route compilation
  - Match routes based on both path and required query params
  - Pass consumed query params to validator to avoid false "unknown param"
    errors
  - Add tests for query string in path matching

</details>

- add form data format options and fix allOf schema merging
  <details><summary>Details</summary>
  - Add CLI flags for form data array/object formats
    (--validator-form-array-format, --validator-form-object-format) matching
    existing query param format options
  - Extract shared param-format.ts module for array/object serialization logic
  - Fix form data double-wrapping bug where arrays like
    `include: [["logprobs"]]` were generated instead of `include: ["logprobs"]`
  - Fix allOf schema merging in response generator - now properly merges schemas
    before generating, instead of generating from each subschema separately
  - Add tests for allOf with nullable, form data formats, and bracket notation

</details>

- add --host CLI flag to fix IPv4/IPv6 binding issue
  <details><summary>Details</summary> The server was binding to "localhost"
  which on macOS resolves to IPv6 only, causing connection refused errors when
  SDKs connect to 127.0.0.1.<br>
  - Add --host flag to specify bind address (default: localhost)
  - Update test script to use --host 0.0.0.0 for dual-stack support
  - Fix test script to actually start mock server before running tests

</details>

### Bug Fixes

- extract types from anyOf/oneOf/allOf for query param parsing
  <details><summary>Details</summary> When a query parameter schema uses
  anyOf/oneOf (e.g., `anyOf: [{type: "integer"}, {type: "null"}]`), the
  validator wasn't recognizing the types and defaulted to string. This caused
  values like `limit=0` to fail validation because "0" was kept as a string
  instead of being parsed as an integer.<br>
  - Add `getSchemaTypes()` helper to extract types from composition schemas
  - Update `isArraySchema()` and `parseParamValue()` to use the helper
  - Update `addNestedPropertyKeys()` to use `getObjectSchemaFromComposition()`
  - Add diagnostic when schema types cannot be determined

</details>

- add rye to CI for SDK tests
- remove maxDepth limit from response generator
  <details><summary>Details</summary> The maxDepth limit was causing null values
  to be generated for deeply nested schemas (like OpenAI's Response schema with
  11+ levels). The cycle detection via the visited set is sufficient - maxDepth
  was redundant and harmful for legitimate deep schemas.<br> Changes:
  - Remove maxDepth field and parameter from RegistryResponseGenerator
  - Remove depth parameter from generateFromSchema, generateArray,
    generateObject
  - Update all call sites to remove depth argument
  - Add test for deeply nested anyOf in array items

</details>

### Code Refactoring

- merge SDK test scripts into single TypeScript implementation
  <details><summary>Details</summary>
  - Combine test-stainless-sdks.sh and test-sdks.ts into one unified script
  - Add light wrapper ./scripts/test-sdks for convenience
  - Use exit codes instead of parsing output text for pass/fail detection
  - Update CI to run all SDK tests (Go + Python) instead of just Go
  - Add Python 3.12 and uv setup to CI workflow

</details>

### Chores

- update OpenAPI fixtures and test-suite submodule

## 0.7.1

### Chores

- Potential fix for code scanning alert no. 7: Incomplete string escaping or
  encoding <details><summary>Details</summary> Co-authored-by: Copilot Autofix
  powered by AI
  &lt;62310815+github-advanced-security[bot]@users.noreply.github.com&gt;

</details>

## 0.7.0

### Features

- add CLI flags for streaming defaults <details><summary>Details</summary> Add
  --stream-count and --stream-interval CLI flags to set server-wide defaults for
  streaming responses. Headers still override per-request.<br>
  - Add StreamingConfig interface to types.ts
  - Add --stream-count=&lt;n&gt; (default: 5, max: 1000)
  - Add --stream-interval=&lt;n&gt; (default: 100ms, max: 10000ms)
  - Add getEffectiveStreamingOptions() to merge config with headers
  - Document in CLI help under "Streaming Options"

</details>

- add warn function to logging and use for invalid NDJSON examples
  <details><summary>Details</summary>
  - Add warn() function to logging/mod.ts for general warnings
  - Use warn() in streaming.ts when NDJSON example is invalid
  - Warning includes yellow color and [Steady] prefix

</details>

- add NDJSON example support for multiline strings and arrays
  <details><summary>Details</summary> Add support for spec examples in
  JSONL/NDJSON streaming responses:
  - Array of objects: each object is streamed as a JSON line
  - Multiline string: each line is parsed as JSON and streamed<br> Unlike
    schema-generated NDJSON, example-based responses do not include _stream
    metadata, preserving the exact example content.<br> New exports:
  - isNDJSONExample(): detects valid NDJSON examples
  - parseNDJSONExample(): parses multiline strings or arrays

</details>

### Code Refactoring

- redesign logging system with unified event model
  <details><summary>Details</summary>
  - Replace old loggers with Logger interface and implementations (TextLogger,
    JsonLogger, TuiLogger)
  - Add complete validation context: path, specPointer, keyword, expected,
    actual, attribution, suggestion
  - Schema analyzer now reports per-schema complexity/nesting with specific
    pointers instead of useless global metrics
  - Add --log-format flag for text/json output selection
  - Fix SIGINT handling: server owns shutdown in all modes
  - Exclude test-fixtures/openapi-directory from deno commands

</details>

### Documentation

- add streaming headers to CLI help output <details><summary>Details</summary>
  Document X-Steady-Stream-Count and X-Steady-Stream-Interval-Ms headers in the
  CLI help for consistency with other per-request override headers.

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
