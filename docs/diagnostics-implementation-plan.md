# Diagnostics Implementation Plan

## The Problem

Steady validates SDK requests against OpenAPI specs. The hard part isn't
validation—it's **attribution**: determining whose fault each error is.

```
POST /audio/transcriptions
Body: { "model": "whisper-1" }

Schema expects oneOf:
  - FileVariant: { required: [file, model] }
  - UrlVariant: { required: [url, model] }
```

Both variants fail. Missing `file` AND missing `url`. Whose fault?

- SDK bug? (Should have included one of them)
- Test data incomplete? (User didn't provide file or url)
- Spec issue? (Maybe neither should be required)

A naive validator says "required field missing" and blames the SDK. But that's
often wrong. Attribution requires understanding the structure of the failure.

---

## Core Insight

**The diagnostics are the product. The mock server is scaffolding.**

Steady answers: "Did this SDK correctly transport the request?"

An SDK is a transport layer. It packages data and sends it. It does NOT validate
semantic content—that's the server's job.

| Category   | SDK Responsible | Examples                        |
| ---------- | --------------- | ------------------------------- |
| Structural | Yes             | type, required, shape, presence |
| Content    | No              | format, pattern, length, range  |

This distinction is Steady's core intellectual contribution. Without it, you're
just another API validator that blames SDKs for user mistakes.

---

## Architecture Decision: 3 Layers

We explored 5 layers:

```
DiagnosticEngine → TransportModel → AttributionEngine → SessionStore → MockServer
```

And rejected it. Here's why.

### The TransportModel Problem

TransportModel maps keywords to categories:

```
required → structural → sdk-issue
format → content → content-note
```

But for composition failures (oneOf, anyOf), the keyword alone doesn't determine
category. A `required` error inside a failed oneOf might be ambiguous, not
sdk-issue.

TransportModel gets bypassed for the hard cases. If it's bypassed when it
matters most, why have it?

### The AttributionEngine Problem

AttributionEngine was supposed to analyze patterns and determine responsibility.
But it needs the same context DiagnosticEngine already has: the validation tree,
the schema structure, the request.

Two components doing attribution means unclear responsibility and redundant
context-passing.

### The 3-Layer Design

```
Layer 1: DiagnosticEngine
         └── Two-phase attribution, owns the decision
         └── Delegates to SchemaValidator (pure, no attribution knowledge)

Layer 2: E-Code Registry
         └── Source of truth for code definitions
         └── Provides default category, engine may override

Layer 3: SessionStore + MockServer
         └── Infrastructure: storage and HTTP plumbing
```

DiagnosticEngine does attribution in two phases, not two components.

---

## Two-Phase Attribution

The key design. Attribution happens in two phases within DiagnosticEngine:

### Phase 1: Leaf Attribution

For simple errors, (keyword, location) determines E-code:

```
(required, query)  → E3002 (Missing required query parameter)
(required, header) → E3004 (Missing required header)
(required, body)   → E3007 (Missing required field)
(type, body)       → E3008 (Field type mismatch)
(format, body)     → E4001 (Format mismatch)
```

Category from E-code registry. Handles ~80% of cases. Fast.

### Phase 2: Composition Analysis

For complex cases, analyze the pattern of failures:

```
Input: ValidationTree showing oneOf with 2 variants, both failed on "required"

Phase 1 produced:
  E3007 (sdk-issue, confidence 0.9) for missing 'file'
  E3007 (sdk-issue, confidence 0.9) for missing 'url'

Phase 2 recognizes pattern "all-variants-fail-required":
  All variants failed on same structural keyword
  → Could be SDK, test data, or spec issue
  → Replace with E3012 (ambiguous, confidence 0.5)
  → Reasoning chain explains what happened
```

Phase 2 may merge, replace, or re-categorize Phase 1 diagnostics.

### Why This Works

| Alternative                                 | Problem                             |
| ------------------------------------------- | ----------------------------------- |
| Single-pass keyword lookup                  | No context for composition failures |
| Separate TransportModel + AttributionEngine | Attribution split, TM gets bypassed |
| Attribution during validation               | Couples validator to E-codes        |

Two-phase keeps:

- Simple cases simple (lookup)
- Complex cases get full context (tree analysis)
- One component owns the decision

---

## The Validation Tree

SchemaValidator must return a tree, not a flat list.

### Why

Flat list loses context:

```
[
  { keyword: "required", path: "body.file" },
  { keyword: "required", path: "body.url" }
]
// Which variant did each error come from?
```

Phase 2 needs to ask: "Did all oneOf variants fail on required?" Can't answer
without tree structure.

### Structure

```typescript
interface ValidationNode {
  keyword: string;
  path: string;
  schemaPath: string;
  valid: boolean;

  // Leaf errors
  message?: string;
  expected?: unknown;
  actual?: unknown;

  // Composition nodes
  children?: ValidationNode[];
  variantIndex?: number;
}
```

Example for the oneOf case:

```
{
  keyword: "oneOf",
  path: "body",
  valid: false,
  children: [
    {
      variantIndex: 0,
      valid: false,
      children: [{ keyword: "required", path: "body", field: "file" }]
    },
    {
      variantIndex: 1,
      valid: false,
      children: [{ keyword: "required", path: "body", field: "url" }]
    }
  ]
}
```

---

## Composition Patterns

Phase 2 pattern catalog. Each pattern has:

- Trigger condition
- Analysis logic
- Output transformation

### Pattern: All Variants Fail Same Way

**Trigger**: oneOf/anyOf where all `children.valid === false` AND all failed on
same keyword type (all structural or all content)

**Analysis**:

- All structural failures → ambiguous (SDK might not know which variant)
- All content failures → content-note (SDK transported correctly)

**Output**: E3012, confidence 0.5, reasoning chain listing each variant's
failure

### Pattern: One Variant Almost Matches

**Trigger**: oneOf where one variant has significantly fewer errors than others

**Analysis**: Likely the intended variant. Errors more attributable to SDK.

**Output**: Diagnostics for closest variant with higher confidence

### Pattern: Discriminator Present

**Trigger**: oneOf with discriminator, discriminator value in request

**Analysis**: Discriminator selects variant. Errors in that variant are SDK's.

**Output**: E3011 if discriminator invalid, else errors from selected variant
with high confidence

### Pattern: Impossible Schema

**Trigger**: allOf with contradictory constraints (type: string AND type:
number)

**Analysis**: No valid input exists. Spec issue.

**Output**: E1012 (spec-issue), regardless of request content

---

## The Diagnostic Type

```typescript
interface Diagnostic {
  code: string; // "E3007"
  severity: "error" | "warning" | "info";
  category: "sdk-issue" | "content-note" | "spec-issue" | "ambiguous";

  // Location
  requestPath: string; // "body.email"
  specPointer: string; // "#/components/schemas/User/..."

  // Details
  message: string;
  expected?: unknown;
  actual?: unknown;

  // Attribution
  attribution: {
    confidence: number; // 0.0-1.0
    reasoning: string[]; // ["oneOf failed", "Variant 0: missing file", ...]
  };

  // For composition failures
  composition?: {
    keyword: "oneOf" | "anyOf" | "allOf";
    variants: Array<{
      index: number;
      schemaRef?: string;
      errors: string[];
    }>;
  };

  suggestion?: string;
}
```

The `composition` field preserves detail when Phase 2 merges multiple leaf
errors into one composition diagnostic.

---

## E-Code Registry

Source of truth for code metadata.

```typescript
const CODES = {
  // E1xxx - Spec Issues
  E1001: {
    title: "Invalid syntax",
    severity: "error",
    category: "spec-issue",
    fatal: true,
  },
  E1010: {
    title: "Missing responses object",
    severity: "warning",
    category: "spec-issue",
  },
  E1012: {
    title: "Impossible schema constraint",
    severity: "error",
    category: "spec-issue",
  },

  // E2xxx - Routing
  E2001: { title: "Path not found", severity: "error", category: "sdk-issue" },
  E2002: {
    title: "Method not allowed",
    severity: "error",
    category: "sdk-issue",
  },

  // E3xxx - Transport
  E3002: {
    title: "Missing required query parameter",
    severity: "error",
    category: "sdk-issue",
  },
  E3004: {
    title: "Missing required header",
    severity: "error",
    category: "sdk-issue",
  },
  E3007: {
    title: "Missing required field",
    severity: "error",
    category: "sdk-issue",
  },
  E3008: {
    title: "Field type mismatch",
    severity: "error",
    category: "sdk-issue",
  },
  E3012: {
    title: "Schema composition mismatch",
    severity: "warning",
    category: "ambiguous",
  },

  // E4xxx - Content
  E4001: {
    title: "Format mismatch",
    severity: "info",
    category: "content-note",
  },
  E4002: {
    title: "Pattern mismatch",
    severity: "info",
    category: "content-note",
  },

  // E5xxx - Ambiguous
  E5001: {
    title: "Null for non-nullable field",
    severity: "warning",
    category: "ambiguous",
  },
};
```

Registry provides DEFAULT category. DiagnosticEngine may override based on
context (e.g., E3007 inside failed oneOf → ambiguous via E3012).

---

## Open Questions

These are the roadmap for future design work.

### 1. ValidationTree Structure

Draft type is a starting point. Need to resolve:

- Nested compositions (oneOf inside allOf): How deep does the tree go?
- Leaf-to-parent references: Should leaves know their composition context?
- "Almost matched" representation: How to detect closest variant?

### 2. Pattern Catalog

Four patterns identified. Need to discover:

- Deeply nested compositions: What patterns emerge?
- `if`/`then`/`else` schemas: How to attribute?
- `not` schemas: If `not` fails, what does that mean?
- `$ref` cycles: When do we give up?

### 3. Pattern Priority

Multiple patterns may match. Need to define:

- Priority order: Does discriminator beat all-variants-fail?
- Conflict resolution: What if patterns disagree?
- Explicit ordering vs. specificity-based selection

### 4. Confidence Calibration

Attribution has confidence (0.0-1.0). Need to define:

- What 0.5 means in practice
- How to calibrate against real outcomes
- Whether confidence affects behavior (below threshold → ambiguous?)

### 5. Adapting RuntimeValidator

Current `runtime-validator.ts` returns flat errors. Options:

| Approach                     | Tradeoff                    |
| ---------------------------- | --------------------------- |
| Modify to return tree        | Invasive, but clean result  |
| Wrap with tree reconstructor | Hacky, may lose information |
| Rewrite                      | Effort, but starts fresh    |

Need to assess: How much composition context does current validator preserve?

### 6. Runtime Spec Issue Detection

Most E1xxx detected at startup. Some only surface at runtime:

- E1010 when endpoint without responses is hit
- Impossible schemas only discovered during validation

How does DiagnosticEngine detect these? Part of Phase 2? Separate analysis?

### 7. Phase 2 Implementation

Options explored:

| Approach                   | Tradeoff                                  |
| -------------------------- | ----------------------------------------- |
| Pattern matching (if/else) | Explicit but verbose                      |
| Rule engine                | Declarative but needs priority handling   |
| Visitor pattern            | Clean but awkward for cross-node analysis |

Leaning toward: Start with pattern matching, refactor to rules if patterns
proliferate.

---

## File Structure

```
src/
├── engine/
│   ├── diagnostic-engine.ts    # Orchestrates two-phase attribution
│   ├── phase1.ts               # Leaf: (keyword, location) → E-code
│   ├── phase2.ts               # Composition pattern matching
│   └── patterns/               # Individual pattern implementations
│
├── codes/
│   ├── registry.ts             # E-code definitions
│   └── explain.ts              # --explain documentation
│
├── validation/
│   ├── schema-validator.ts     # Pure validation, returns tree
│   └── validation-tree.ts      # ValidationNode types
│
├── session/
│   ├── store.ts                # Per-session diagnostic storage
│   └── endpoints.ts            # /_steady/sessions/* API
│
└── server/
    ├── server.ts               # HTTP plumbing
    └── headers.ts              # X-Steady-* headers
```

---

## Summary

| Decision         | Choice             | Rationale                                                     |
| ---------------- | ------------------ | ------------------------------------------------------------- |
| Architecture     | 3 layers           | TransportModel/AttributionEngine add complexity without value |
| Attribution      | Two-phase          | Simple cases fast, complex cases get context                  |
| Validator output | Tree               | Flat list loses composition structure                         |
| Category source  | E-code registry    | Single source, engine can override                            |
| Pattern handling | Catalog in Phase 2 | Explicit patterns, not heuristics                             |

The diagnostics are the product. Everything else is plumbing.
