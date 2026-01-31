# Diagnostics Implementation Plan

## Core Insight

**The diagnostics are the product. The mock server is scaffolding.**

Steady answers one question: "Did this SDK correctly transport the request?"

Everything else—HTTP handling, response generation, logging—exists to serve that
question. The current architecture treats diagnostics as a side effect of
validation. That's backwards.

---

## First Principles

### What Steady Actually Does

1. Receives a request
2. Compares it against an OpenAPI spec
3. Determines what's wrong and whose fault it is
4. Reports findings

The mock response is a convenience so SDK tests can complete. The headers and
session reports are how diagnostics reach the consumer.

### The Transport Layer Model

An SDK is a transport layer. It packages data and sends it. It does NOT validate
semantic content—that's the server's job.

This creates two categories of validation:

| Category   | SDK Responsible | Examples                        |
| ---------- | --------------- | ------------------------------- |
| Structural | Yes             | type, required, shape, presence |
| Content    | No              | format, pattern, length, range  |

This distinction is **the core intellectual contribution** of Steady. Without
it, you're just another API validator that blames SDKs for user mistakes.

---

## Ideal Architecture

### Layer 1: DiagnosticEngine (The Core)

The engine takes a spec and a request. It returns diagnostics. That's it.

```
DiagnosticEngine
├── Input: (OpenAPISpec, Request)
├── Output: Diagnostic[]
└── Every diagnostic has:
    - E-code (stable identifier)
    - Category (sdk-issue | content-note | spec-issue | ambiguous)
    - Attribution with reasoning chain
```

The engine doesn't know about HTTP responses. It doesn't generate mocks. It
analyzes and reports.

### Layer 2: TransportModel (The Rules)

Defines what's structural vs content. This is configurable.

```typescript
interface TransportModel {
  // SDK packaging errors
  structural: Set<Keyword>; // type, required, properties, items, ...

  // Content issues (SDK just transports)
  content: Set<Keyword>; // format, pattern, minLength, minimum, ...

  // Needs context to determine
  ambiguous: Set<Keyword>; // oneOf, nullable, enum (sometimes), ...
}
```

The spec's taxonomy (Section 2.3) is the default. Users can override.

### Layer 3: AttributionEngine (The Intelligence)

Separate from validation. Takes validation results and determines
responsibility.

```
AttributionEngine
├── Input: ValidationResult[], TransportModel, Context
├── Output: Attribution for each result
└── Logic:
    1. Classify by keyword (structural → sdk-issue, content → content-note)
    2. Analyze patterns (consistent errors? composition failures?)
    3. Detect spec issues (impossible schemas? missing responses?)
    4. Build reasoning chains
```

This is where heuristics live. It can be sophisticated because it's isolated
from validation mechanics.

### Layer 4: SessionStore (First-Class Sessions)

Diagnostics are stored per-session, not globally.

```typescript
interface Session {
  id: string;
  created: Date;
  requests: RequestRecord[];

  // Pre-aggregated by category
  diagnostics: {
    sdk_issues: Diagnostic[];
    content_notes: Diagnostic[];
    spec_issues: Diagnostic[];
    ambiguous: Diagnostic[];
  };

  summary: {
    total_requests: number;
    structurally_valid: number;
    structurally_invalid: number;
  };
}
```

Sessions enable parallel test isolation and clean SDK framework integration.

### Layer 5: MockServer (Thin Scaffolding)

The HTTP server is plumbing. Its only jobs:

1. Receive HTTP requests
2. Feed them to DiagnosticEngine
3. Store results in SessionStore
4. Generate mock response (if routing succeeded)
5. Add X-Steady-\* headers
6. Return response

```typescript
class MockServer {
  async handle(req: Request): Promise<Response> {
    const sessionId = req.headers.get("X-Steady-Session") || "default";

    // THE CORE - everything else is plumbing
    const diagnostics = await this.engine.analyze(this.spec, req);

    // Store
    this.sessions.record(sessionId, req, diagnostics);

    // Generate and return
    const response = this.generator.generate(req, diagnostics);
    return this.addHeaders(response, diagnostics);
  }
}
```

~50 lines of actual logic. The server is disposable.

---

## Data Flow

```
HTTP Request
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ DiagnosticEngine                                        │
│                                                         │
│  1. Parse request                                       │
│  2. Match route → E2xxx if fails                        │
│  3. Validate each point:                                │
│     - Run schema validation                             │
│     - For each failure, identify keyword                │
│     - Look up keyword in TransportModel                 │
│     - Assign preliminary category                       │
│  4. Run AttributionEngine                               │
│     - Pattern analysis                                  │
│     - Spec issue detection                              │
│     - Build reasoning chains                            │
│  5. Return Diagnostic[]                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ SessionStore                                            │
│                                                         │
│  Store under session_id                                 │
│  Aggregate by category                                  │
│  Update summary stats                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ ResponseGenerator                                       │
│                                                         │
│  Routing succeeded? → Mock + headers                    │
│  Routing failed? → 404/405 + headers                    │
│  Headers ALWAYS present                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
    │
    ▼
HTTP Response
```

---

## The Diagnostic Type

```typescript
interface Diagnostic {
  // Identification
  code: string; // "E3007" - stable, documentable
  severity: "error" | "warning" | "info";

  // Category (the key insight)
  category: "sdk-issue" | "content-note" | "spec-issue" | "ambiguous";

  // Location
  requestPath: string; // "body.email", "query.limit"
  specPointer: string; // "#/components/schemas/User/properties/email"

  // Details
  message: string;
  expected?: unknown;
  actual?: unknown;

  // Attribution (how we determined category)
  attribution: {
    category: IssueCategory;
    confidence: number; // 0.0-1.0
    reasoning: string[]; // Chain of logic, not single string
  };

  // Actionable
  suggestion?: string;
}
```

---

## E-Code Registry

Single source of truth for all codes.

```typescript
const CODES = {
  // E1xxx - Spec Issues
  E1001: {
    title: "Invalid syntax",
    severity: "error",
    fatal: true,
    context: "startup",
    category: "spec-issue",
  },
  E1010: {
    title: "Missing responses object",
    severity: "warning",
    fatal: false,
    context: "both", // startup AND runtime
    category: "spec-issue",
  },

  // E2xxx - Routing
  E2001: {
    title: "Path not found",
    severity: "error",
    category: "sdk-issue", // or ambiguous depending on context
  },
  E2002: {
    title: "Method not allowed",
    severity: "error",
    category: "sdk-issue",
  },

  // E3xxx - Transport (Structural)
  E3007: {
    title: "Missing required field",
    severity: "error",
    category: "sdk-issue",
    keywords: ["required"],
  },
  E3008: {
    title: "Field type mismatch",
    severity: "error",
    category: "sdk-issue",
    keywords: ["type"],
  },

  // E4xxx - Content
  E4001: {
    title: "Format mismatch",
    severity: "info",
    category: "content-note",
    keywords: ["format"],
  },
  E4002: {
    title: "Pattern mismatch",
    severity: "info",
    category: "content-note",
    keywords: ["pattern"],
  },

  // E5xxx - Ambiguous
  E5001: {
    title: "Null for non-nullable field",
    severity: "warning",
    category: "ambiguous",
  },
} as const;
```

This enables:

- `steady --explain E3007` for detailed docs
- Consistent categorization across codebase
- Stable API for SDK test frameworks

---

## Key Differences From Current Implementation

### Current

```
Request → RequestValidator → ValidationIssue[] → Server decides
                │
                └── Attribution assigned late, inconsistently
                    Category inferred from keyword name (fragile)
                    No content-note category
```

Validation and attribution are mixed. The server has too much responsibility.

### Ideal

```
Request → DiagnosticEngine → Diagnostic[] (fully attributed)
                │
                ├── RouteAnalyzer (E2xxx)
                ├── SchemaValidator (mechanics only)
                ├── TransportModel (structural vs content)
                ├── AttributionEngine (determines category)
                └── SpecIssueDetector (E1xxx at runtime)
```

Each component has one job. Categories assigned at the right place.

### Current Session Handling

```
DiagnosticCollector has basic stats
No session ID support
No isolation between parallel tests
```

### Ideal Session Handling

```
SessionStore is first-class
X-Steady-Session header creates/uses session
GET /_steady/sessions/{id} returns full report
Sessions are isolated, pre-aggregated by category
```

### Current Response Behavior

```
Strict mode: 400 on validation failure
Relaxed mode: Mock response
Headers: minimal (X-Steady-Mode, X-Steady-Matched-Path)
```

### Ideal Response Behavior

```
Routing succeeded: ALWAYS mock + headers (regardless of validation)
Routing failed: 404/405 + headers
Headers: X-Steady-Valid, X-Steady-Error-Count, X-Steady-Error-N-*, etc.
Optional: --reject-on-sdk-error for strict CI mode
```

---

## Implementation Principles

### 1. Diagnostics First

Design every component asking "how does this serve diagnostics?" not "how do we
add diagnostics to this?"

### 2. Category at Source

The TransportModel determines category based on keyword. This happens during
validation, not after. Don't try to infer category from error messages later.

### 3. Reasoning Chains

Attribution includes an array of reasoning steps, not a single string. This
enables debugging complex cases like oneOf composition failures.

### 4. Sessions Are Real

Sessions aren't an afterthought. They're how SDK test frameworks consume
diagnostics. Design for them from the start.

### 5. Mock Is Default

When routing succeeds, return a mock. Always. Validation failures go in headers
and sessions, not HTTP status codes. SDK tests need to complete to be useful.

### 6. E-Codes Are The API

The E-code is the stable identifier. Message text can change. The code is the
contract with SDK test frameworks, documentation, and `--explain`.

---

## File Structure (Suggested)

```
src/
├── engine/
│   ├── diagnostic-engine.ts    # The core
│   ├── transport-model.ts      # Structural vs content rules
│   ├── attribution-engine.ts   # Determines responsibility
│   └── spec-analyzer.ts        # Runtime E1xxx detection
│
├── codes/
│   ├── registry.ts             # E-code definitions
│   ├── e1xxx.ts                # Spec issue codes
│   ├── e2xxx.ts                # Routing codes
│   ├── e3xxx.ts                # Transport codes
│   ├── e4xxx.ts                # Content codes
│   └── e5xxx.ts                # Ambiguous codes
│
├── session/
│   ├── store.ts                # Session storage
│   ├── types.ts                # Session, SessionReport
│   └── endpoints.ts            # /_steady/sessions/* handlers
│
├── server/
│   ├── server.ts               # Thin HTTP handling
│   ├── headers.ts              # X-Steady-* header logic
│   └── generator.ts            # Mock response generation
│
├── validation/                 # Mechanics only, no attribution
│   ├── schema-validator.ts
│   ├── route-matcher.ts
│   └── param-parser.ts
│
└── output/
    ├── cli.ts                  # Terminal formatting
    ├── ci.ts                   # CI log formatting
    └── json.ts                 # JSON/NDJSON output
```

---

## What This Document Is

This is a **north star** for implementation. It describes the ideal
architecture, not a migration plan from the current code.

The current codebase has:

- Good validation mechanics (RuntimeValidator, SchemaRegistry)
- Good OpenAPI parsing
- Basic diagnostic collection

What it needs:

- DiagnosticEngine as the organizing principle
- TransportModel for structural/content distinction
- content-note as fourth category
- First-class sessions
- E-code registry
- Mock-first response behavior

The implementation can be incremental, but the architecture should be clear.
Every change should move toward this design, not patch the current one.
