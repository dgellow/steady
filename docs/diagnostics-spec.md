# Steady Diagnostics System Specification

Version: 0.1 (Draft)

---

## 1. Purpose

Steady validates SDKs against OpenAPI specifications. The diagnostics system
answers one question:

> **Can this SDK be trusted to correctly transport requests to the API?**

Steady is not a general-purpose API validator. It specifically evaluates whether
an SDK correctly implements the structural contract defined by an OpenAPI spec.

**Confidence: 95%** — This framing is core to Steady's value proposition.

---

## 2. Core Model: SDK as Transport Layer

### 2.1 The Transport Layer Concept

An SDK is a transport layer. Its responsibilities are:

1. Accept data from the developer
2. Package it correctly (method, path, headers, body structure)
3. Send it to the server

The SDK is **not** responsible for validating the semantic content of
user-provided data. That is the server's job.

**Confidence: 95%** — This is the foundational insight that differentiates
Steady from generic API testing tools.

### 2.2 Structural vs Content Validation

All validation constraints fall into two categories:

| Category       | SDK Responsible | Examples                                         |
| -------------- | --------------- | ------------------------------------------------ |
| **Structural** | Yes             | type, required, object shape, path construction  |
| **Content**    | No              | format, pattern, minLength, minimum, enum values |

**Structural constraints** define the shape and types of data. The SDK controls
these through its API design and serialization logic.

**Content constraints** validate the semantic meaning of values. The user
provides these values; the SDK merely transports them.

**Confidence: 90%** — The classification is sound. Edge cases exist (enum
values, nullable) that require judgment.

### 2.3 Validation Taxonomy

```
STRUCTURAL (SDK's responsibility)
  • HTTP method selection
  • Path/URL construction
  • Required fields present
  • Data types (integer vs string vs object)
  • Object structure (shape matches schema)
  • Required headers

CONTENT (Server validates, SDK transports)
  • format (email, uri, uuid, date-time)
  • pattern (regex)
  • minLength / maxLength
  • minimum / maximum
  • minItems / maxItems
  • enum (when user-provided)
  • multipleOf

CONTEXT-DEPENDENT (May require judgment)
  • null for non-nullable field
  • enum values (depends on SDK API design)
  • additionalProperties (when spec is silent)
```

**Confidence: 85%** — The categories are correct. The context-dependent list may
grow as we encounter more edge cases.

---

## 3. Attribution System

### 3.1 Issue Categories

Every validation issue is assigned to one of three categories:

| Category         | Meaning                                      | Affects Pass/Fail |
| ---------------- | -------------------------------------------- | ----------------- |
| **SDK Issue**    | Structural failure — SDK must fix            | Yes               |
| **Content Note** | Content validation — informational only      | No                |
| **Ambiguous**    | Could be SDK, spec, or user — needs judgment | Configurable      |

**Confidence: 90%** — Categories are correct. Whether ambiguous affects
pass/fail is a policy decision (see Section 6).

### 3.2 Attribution Rules

**SDK Issue (high confidence):**

- Wrong HTTP method
- Path parameter type mismatch
- Missing required field
- Wrong data type in body
- Missing required header
- additionalProperties violation (when explicitly `false`)

**Content Note (not SDK's fault):**

- Format validation failure
- Pattern mismatch
- String length violation
- Numeric range violation
- Array size violation

**Ambiguous (requires judgment):**

- Null sent for non-nullable field (spec might be incomplete)
- Enum value invalid (SDK might expose typed enum or pass-through)
- Additional properties when spec doesn't set `additionalProperties`

**Confidence: 85%** — Rules are sound. Specific cases may be reclassified as we
learn from real-world usage.

### 3.3 The Spec Might Be Wrong

Steady validates against the spec, but the spec may not accurately describe the
real API. When validation fails, possible causes are:

1. SDK is wrong (doesn't follow spec)
2. Spec is wrong (doesn't describe real API)
3. User data is wrong (invalid input to SDK)
4. Multiple parties wrong (ambiguous)

Resolution requires testing against the real API. Steady cannot determine which
party is wrong from the spec alone.

**Confidence: 95%** — This is fundamental to correct interpretation of results.

### 3.4 SDK-Generated Content

When the SDK **generates** content (not user-provided), content validation
applies to the SDK:

| SDK Generates     | SDK Responsible |
| ----------------- | --------------- |
| Request ID (UUID) | Yes             |
| Timestamps        | Yes             |
| Signatures/HMAC   | Yes             |

Note: OpenAPI `default` values are a server-side concept. A spec default means
"server uses this if client omits the field" — it does not obligate the SDK to
generate or send that value. The field is simply optional from the client's
perspective.

Steady cannot automatically distinguish SDK-generated from user-provided values.
Default behavior: assume all content is user-provided (conservative — avoids
false SDK blame).

**Confidence: 75%** — The principle is correct. Detection mechanism is
unresolved. Options:

1. Assume all content is user-provided (current default)
2. Allow SDK tests to mark SDK-generated fields via headers
3. Heuristics (same value every request = likely SDK-generated)

**Decision: Defer.** Start with option 1. Revisit if users request detection.

---

## 4. Error Code System

### 4.1 Design Principles

Error codes are:

1. **Stable** — Once assigned, a code's meaning doesn't change
2. **Extensible** — New codes can be added in any category
3. **Self-describing** — Category visible in the code itself
4. **Documented** — Each code has a detailed explanation

Error codes are NOT:

1. **Exhaustive** — The initial set is a starting point
2. **Immutable** — Codes may be deprecated (not removed or reassigned)
3. **Sequential** — Gaps in numbering are expected and intentional

**Confidence: 95%** — These principles ensure long-term stability.

### 4.2 Code Format

Format: `E` + 4 digits

First digit encodes category (attribution):

```
E1xxx — Spec       (spec author's problem, found at startup)
E2xxx — Routing    (SDK hitting wrong endpoint)
E3xxx — Transport  (SDK packaging data wrong)
E4xxx — Content    (not SDK's fault — server validates)
E5xxx — Ambiguous  (needs human judgment)
```

**Confidence: 90%** — Format is stable. Categories align with attribution model.

### 4.3 Initial Error Codes

These are the initial codes. The list will grow over time.

**E1xxx — Spec Diagnostics**

Fatal errors prevent server startup (exit 3). Non-fatal errors are reported but
the server continues.

| Code  | Title                           | Severity | Fatal |
| ----- | ------------------------------- | -------- | ----- |
| E1001 | Invalid syntax                  | error    | yes   |
| E1002 | Unsupported OpenAPI version     | error    | yes   |
| E1003 | Missing required spec field     | error    | no    |
| E1004 | Unresolved reference            | error    | yes   |
| E1005 | Circular reference              | warning  | no    |
| E1006 | Invalid schema definition       | error    | yes   |
| E1007 | Keywords alongside $ref ignored | warning  | no    |
| E1008 | Duplicate path patterns         | warning  | no    |

Note on E1003: Missing `openapi`, `info.title`, or `info.version` is clearly an
error but Steady can assume reasonable defaults (3.1.0, "Untitled", "unknown")
and continue. The spec author should fix this, but it doesn't prevent serving.

**E2xxx — Routing**

| Code  | Title                        | Severity |
| ----- | ---------------------------- | -------- |
| E2001 | Path not found               | error    |
| E2002 | Method not allowed           | error    |
| E2003 | Undocumented query parameter | warning  |

**E3xxx — Transport Failures**

| Code  | Title                             |
| ----- | --------------------------------- |
| E3001 | Path parameter type mismatch      |
| E3002 | Missing required query parameter  |
| E3003 | Query parameter type mismatch     |
| E3004 | Missing required header           |
| E3005 | Missing request body              |
| E3006 | Wrong Content-Type                |
| E3007 | Missing required field            |
| E3008 | Field type mismatch               |
| E3009 | Additional property not allowed   |
| E3010 | Invalid array item type           |
| E3011 | Invalid discriminator value       |
| E3012 | Schema composition mismatch       |
| E3013 | Required field in optional parent |

**E4xxx — Content Validation Notes**

| Code  | Title                   |
| ----- | ----------------------- |
| E4001 | Format mismatch         |
| E4002 | Pattern mismatch        |
| E4003 | String length violation |
| E4004 | Numeric range violation |
| E4005 | Array size violation    |
| E4006 | Enum value not in list  |
| E4007 | Multiple-of violation   |

**E5xxx — Ambiguous**

| Code  | Title                               |
| ----- | ----------------------------------- |
| E5001 | Null for non-nullable field         |
| E5002 | Enum value from SDK                 |
| E5003 | Additional properties (spec silent) |

**Confidence: 70%** — Initial codes are reasonable. Expect additions and
possibly deprecations as real-world usage reveals gaps.

### 4.4 Code Documentation

Each error code has detailed documentation accessible via `steady --explain`.

Documentation includes:

- Attribution category and reasoning
- Example showing the error
- Why it's categorized this way (transport layer reasoning)
- How to fix (SDK and/or spec changes)

**Confidence: 90%** — The explain system is valuable. Exact content will evolve.

---

## 5. Output Contexts

### 5.1 Output Destinations

Steady diagnostics appear in three contexts:

| Context           | Consumer           | Design Goals                           |
| ----------------- | ------------------ | -------------------------------------- |
| **CLI**           | Human at terminal  | Colors, visual markers, full detail    |
| **CI logs**       | Automated pipeline | Grep-able prefixes, actionable summary |
| **HTTP response** | SDK test framework | Programmatic access via headers/body   |

**Confidence: 95%** — These cover the primary use cases.

### 5.2 CLI Output

CLI output uses compiler-style formatting inspired by Rust/Elm:

- Visual markers (arrows, underlines) pointing to exact locations
- Expected vs actual clearly separated
- Spec reference with JSON pointer
- Actionable fix suggestions

Output respects `NO_COLOR` environment variable.

**Confidence: 85%** — Visual style is well-understood. Exact formatting will be
refined through usage.

### 5.3 CI Output

CI output prioritizes:

- Clear delimiters (stand out in noisy logs)
- Grep-able prefixes (`STEADY:`, `[FAIL]`, etc.)
- Summary first, details after
- Machine-readable annotations where supported (GitHub Actions `::error::`)

**Confidence: 80%** — Principles are correct. Integration with specific CI
systems may require iteration.

### 5.4 HTTP Response Output

When validation fails, diagnostics are available via:

1. **Response headers** — Summary for quick programmatic access
2. **Response body** — Full details in JSON

Header design principles:

- Prefix all headers with `X-Steady-`
- Keep individual headers small (for proxy compatibility)
- Provide full diagnostics in body, not headers

**Confidence: 75%** — Principles are sound. Exact header names and structure
need refinement. Current sketch:

```http
X-Steady-Valid: false
X-Steady-Error-Count: 2
X-Steady-Error-1-Code: E3008
X-Steady-Error-1-Path: body.email
X-Steady-Error-1-Message: expected string, got integer
```

Full diagnostics in response body:

```json
{
  "error": "Validation failed",
  "steady": {
    "valid": false,
    "errors": [
      {
        "code": "E3008",
        "path": "body.email",
        "message": "expected string, got integer",
        "spec_pointer": "#/paths/~1users/post/..."
      }
    ]
  }
}
```

**Decision: Defer exact header format.** Implement basic version, iterate based
on SDK test framework integration experience.

### 5.5 Output Formats

Steady supports two output formats:

| Format   | Use Case                     |
| -------- | ---------------------------- |
| **Text** | Human-readable (default)     |
| **JSON** | Machine-readable for tooling |

**Confidence: 95%** — These cover the needs. No other formats planned.

---

## 6. Control Surface

### 6.1 Design Principles

Control mechanisms are:

1. **Orthogonal** — Each control affects one dimension
2. **Explicit** — No hidden modes or implicit behavior changes
3. **Layered** — CLI flags set defaults, request headers override per-request

**Confidence: 90%** — Principles are sound.

### 6.2 Validation Response Behavior

Controls what HTTP response Steady returns when validation fails.

| Setting              | Behavior                                       |
| -------------------- | ---------------------------------------------- |
| `--on-error=respond` | Return mock response, log diagnostic (default) |
| `--on-error=reject`  | Return 400 with diagnostic in body             |

Per-request override via header:

```http
X-Steady-On-Error: reject
```

**Confidence: 85%** — Replaces strict/relaxed with focused control. The two
modes cover the primary use cases:

- Development: want responses even with bugs (`respond`)
- CI/certification: want hard failures (`reject`)

### 6.3 Content Validation

Controls whether content validation runs at all.

| Setting                    | Behavior                                          |
| -------------------------- | ------------------------------------------------- |
| `--content-validation=on`  | Run content validation, report as notes (default) |
| `--content-validation=off` | Skip content validation entirely                  |

**Confidence: 70%** — Useful for users who find content notes distracting. May
not be necessary if output formatting handles it well.

**Decision: Defer.** Implement content validation always. Add flag if users
request suppression.

### 6.4 Exit Code Behavior

Controls what issues affect the exit code.

| Exit Code | Meaning                                        |
| --------- | ---------------------------------------------- |
| 0         | Passed — No SDK issues                         |
| 1         | Failed — SDK has structural issues             |
| 3         | Error — Steady itself failed (bad spec, crash) |

**Note:** Exit code 2 (ambiguous/review) from the design doc is **removed**.
Ambiguous issues are reported but do not warrant a special exit code. Users who
want stricter behavior can use `--fail-on-ambiguous`.

| Flag                  | Behavior                                        |
| --------------------- | ----------------------------------------------- |
| `--fail-on-ambiguous` | Ambiguous issues cause exit code 1              |
| `--fail-on-warnings`  | Warnings (E2003, E1005, etc.) cause exit code 1 |

**Confidence: 85%** — Simpler than original design. Flags provide strictness for
users who want it.

### 6.5 Output Verbosity

Controls detail level in output.

| Level     | Behavior                             |
| --------- | ------------------------------------ |
| `summary` | Counts and top issues only           |
| `details` | Full issue descriptions (default)    |
| `full`    | All data including all sample values |

**Confidence: 90%** — Standard verbosity levels.

---

## 7. Session Reporting

### 7.1 Session Summary

At session end (server shutdown), Steady produces a summary report:

- Total requests processed
- Structural validity rate
- Issue breakdown by category
- Top issues by frequency
- Endpoint coverage

**Confidence: 90%** — Core reporting features.

### 7.2 Issue Aggregation

Issues are aggregated by:

- Endpoint (method + path pattern)
- Error code
- Request location (path.id, body.email, etc.)

This groups "same issue, different requests" together.

**Confidence: 90%** — Standard aggregation approach.

### 7.3 Endpoint Coverage

Reports which spec endpoints were exercised:

```
Tested:   30/50 endpoints (60%)
Untested: 20 endpoints
```

**Confidence: 80%** — Useful feature. Exact presentation may vary.

---

## 8. Diagnostic Data Model

### 8.1 Core Types

```typescript
type IssueCategory = "sdk-issue" | "content-note" | "ambiguous";
type Severity = "error" | "warning" | "info";

interface Diagnostic {
  code: string; // E3008
  category: IssueCategory;
  severity: Severity;

  // Location
  requestPath: string; // body.email, path.id
  specPointer: string; // JSON pointer into spec

  // Details
  message: string;
  expected: unknown;
  actual: unknown;

  // Help
  suggestion?: string;
}
```

**Confidence: 85%** — Core structure is stable. Fields may be added.

### 8.2 Request Record

```typescript
interface RequestRecord {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  pathPattern: string;

  structurallyValid: boolean;
  diagnostics: Diagnostic[];
}
```

**Confidence: 85%** — Tracks what's needed for reporting.

### 8.3 Session Report

```typescript
interface SessionReport {
  result: "passed" | "failed";

  summary: {
    total: number;
    valid: number;
    invalid: number;
  };

  issues: {
    sdk: AggregatedIssue[];
    contentNotes: AggregatedIssue[];
    ambiguous: AggregatedIssue[];
  };

  coverage: {
    total: number;
    tested: number;
    endpoints: string[];
  };
}
```

**Confidence: 80%** — Structure supports planned features.

---

## 9. Open Questions

### 9.1 Resolved

| Question                | Decision                                              |
| ----------------------- | ----------------------------------------------------- |
| Strict vs relaxed mode  | Replaced with `--on-error` flag                       |
| Exit code for ambiguous | Removed (exit 2). Use `--fail-on-ambiguous` if needed |
| JUnit XML output        | Not supported. JSON covers machine-readable needs     |

### 9.2 Deferred

| Question                      | Status                                               |
| ----------------------------- | ---------------------------------------------------- |
| SDK-generated field detection | Start with "assume user-provided". Revisit if needed |
| Content validation toggle     | Implement always-on. Add flag if users request       |
| Historical comparison         | Out of scope for v1                                  |
| Per-endpoint report cards     | Out of scope for v1                                  |

### 9.3 Open

| Question                  | Considerations                                           |
| ------------------------- | -------------------------------------------------------- |
| Flaky issue detection     | Same issue appearing intermittently — track consistency? |
| Mid-session fix detection | Issue stops appearing — note in report?                  |

---

## 10. Non-Goals

The following are explicitly out of scope:

1. **Response validation** — Steady validates requests, not responses
2. **Load testing** — Steady is not a performance tool
3. **API documentation** — Use existing OpenAPI tools
4. **Code generation** — Steady validates SDKs, doesn't generate them
5. **Multi-spec support** — One spec per Steady instance

**Confidence: 95%** — Clear boundaries help focus development.

---

## Appendix A: Scenario Reference

The following scenarios illustrate the specification in practice. They are
informative, not normative.

### A.1 Happy Path

All requests valid → exit 0, report shows 100% pass rate.

### A.2 Clear SDK Bug

Path parameter type mismatch → E3001, SDK issue, exit 1.

### A.3 Content Validation

Email doesn't match pattern → E4002, content note, exit 0. SDK passed because it
correctly transported the user's string.

### A.4 Ambiguous: Null Handling

Null for non-nullable → E5001, ambiguous. Could be spec (missing nullable), SDK
design, or user error. Requires testing against real API to resolve.

### A.5 Required Field in Optional Parent

Address included but incomplete → E3013, SDK issue. Once parent is present,
required children must be included.

### A.6 Discriminator Mismatch

Unknown discriminator value → E3011, SDK issue. Discriminators are structural
(schema selection), not content.

### A.7 Fatal Spec Error

Spec cannot be loaded at all → exit 3, no server started.

Examples of fatal errors:

- Invalid YAML/JSON syntax (E1001)
- Unresolved `$ref` that prevents schema resolution (E1004)
- Unsupported OpenAPI version like Swagger 2.0 (E1002)
- Invalid schema that cannot be processed (E1006)

```
$ steady serve broken-spec.yaml

error[E1004]: Unresolved reference
 --> #/paths/~1users/get/responses/200/content/application~1json/schema
  |
  |  schema:
  |    $ref: '#/components/schemas/UserResponse'
  |          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  |          Target does not exist
  |
  = components/schemas contains: User, Error, Pagination
  = Did you mean: #/components/schemas/User?

Steady cannot load this spec. Fix the error and retry.
Exit code: 3
```

The server does not start. There is nothing to serve.

### A.8 Non-Fatal Spec Error

Spec violates OpenAPI specification but Steady can still operate → report
error/warning at startup, continue running.

**Example 1: Missing metadata (E1003)**

```yaml
# No openapi version, no info block
paths:
  /users:
    get:
      responses:
        "200":
          description: OK
```

```
$ steady serve minimal.yaml

error[E1003]: Missing required spec field
  |
  |  Missing: openapi, info.title, info.version
  |
  = Assuming OpenAPI 3.1.0
  = Using "Untitled API" as title

Loaded: 1/1 endpoints (1 error)
Ready to accept requests on http://localhost:3000
```

Steady serves the spec with defaults. The error is clear; the spec author should
fix it.

**Example 2: Duplicate path patterns (E1008)**

```yaml
paths:
  /secrets/{secret_id}:
    delete:
      operationId: deleteSecret
  /secrets/{secret_key}:
    post:
      operationId: createSecret
```

Per OpenAPI 3.0.3: "Templated paths with the same hierarchy but different
templated names MUST NOT exist as they are identical."

Real-world occurrence: ArcadeAI API spec.

```
$ steady serve cursed-spec.yaml

warning[E1008]: Duplicate path patterns
 --> paths
  |
  |  /secrets/{secret_id}  (DELETE)
  |  /secrets/{secret_key} (POST)
  |           ^^^^^^^^^^^^
  |           Same URL pattern as {secret_id}
  |
  = This violates OpenAPI 3.0.3 path templating rules
  = Steady handles this gracefully, but other tools may not
  = Consider using a single path with both methods

Loaded: 15/15 endpoints (1 warning)
Ready to accept requests on http://localhost:3000
```

The server starts and operates correctly. Both endpoints work for their
respective methods. The warning ensures the spec author knows about the
violation — attribution is clear (spec issue, not SDK issue).

This approach reflects Steady's philosophy: be maximally useful while providing
clear diagnostics. Real-world specs are often imperfect.

---

## Appendix B: Design Rationale

### B.1 Why Transport Layer?

The transport layer model exists because:

1. **SDKs don't know user intent** — User passes "abc" as email, SDK can't know
   if that's intentional test data or a mistake
2. **Validation is duplicated** — Server validates anyway, SDK validation is
   redundant for content
3. **Clear responsibility** — SDK ensures shape, server ensures semantics
4. **Matches reality** — Most SDKs work this way already

### B.2 Why Not Full Validation?

Full request validation (structural + content) would:

1. Blame SDKs for user mistakes
2. Require SDKs to implement server-side business logic
3. Create false negatives when specs are incomplete
4. Conflate transport correctness with data correctness

### B.3 Why Error Codes?

Error codes provide:

1. **Stability** — Message text can change, codes don't
2. **Searchability** — Users can search for E3008 across docs/issues
3. **Filtering** — Programmatic handling by code
4. **Documentation** — Each code links to detailed explanation

---

## Changelog

- 0.1: Initial draft specification
