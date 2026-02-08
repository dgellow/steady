# Diagnostics Implementation Plan

> Design: [diagnostics-spec.md](diagnostics-spec.md)

**This plan describes the ideal implementation.** The existing codebase may be
used for inspiration and reused where already good, but iterating on existing
code is not a goal. Implementation effort is not a constraint. The goal is the
right system, not the cheapest path from what exists.

## The Problem

Steady is an OpenAPI mock server focused on improving the developer experience
when validation issues arise between HTTP clients and API specs.

When a request doesn't match the spec, developers need actionable context: what
failed, where, whose responsibility it is, and what to do about it.

```
POST /audio/transcriptions
Body: { "model": "whisper-1" }

Schema expects oneOf:
  - FileVariant: { required: [file, model] }
  - UrlVariant: { required: [url, model] }
```

Both variants fail. Missing `file` AND missing `url`. A naive validator reports
"required field missing" — but that doesn't help the developer fix anything.
They need to know:

- Is this an SDK bug? (Should have included one of them)
- Is the test data incomplete? (User didn't provide file or url)
- Is it a spec issue? (Maybe neither should be required)

Attribution — determining whose responsibility each issue is — provides this
context. It's what turns a raw validation error into a useful diagnostic.

---

## Core Insight

**The diagnostics are the product. The mock server is scaffolding.**

When something goes wrong, the diagnostic should give the developer enough
context to understand the issue and act on it. That means answering: what
happened, where, whose responsibility it is, and what to do about it.

The key to answering "whose responsibility" is understanding what an SDK
actually does. An SDK is a transport layer. It packages data and sends it. It
does NOT validate semantic content — that's the server's job.

| Category   | SDK Responsible | Examples                                            |
| ---------- | --------------- | --------------------------------------------------- |
| Structural | Yes             | type, required, shape, enum, const, encoding format |
| Content    | No              | pattern, minLength, minimum, value-level format     |

This structural/content distinction is what makes Steady's diagnostics
meaningful. Without it, every validation error looks like an SDK bug — which is
often wrong and wastes the developer's time.

---

## Architecture: 3 Layers

We explored 5 layers (DiagnosticEngine, TransportModel, AttributionEngine,
SessionStore, MockServer) and rejected it — TransportModel gets bypassed for
complex cases, two components doing attribution means unclear responsibility.

We then explored a 2-phase model (leaf attribution, then composition pattern
analysis). It was better, but had a fundamental flaw: **attribution decisions
were made at the wrong level.** Phase 1 attributed leaves without composition
context. Phase 2 then overrode those decisions — creating diagnostics only to
throw them away.

Worse, the two-phase model can't correctly evaluate composition keywords under
the transport layer model (see "Structural Match" below).

### The 3-Layer Design

```
Layer 1: DiagnosticEngine
         └── Recursive interpretation of validation results
         └── Delegates to SchemaValidator (pure, no attribution knowledge)

Layer 2: E-Code Registry
         └── Source of truth for code definitions
         └── Provides default category, engine may override

Layer 3: SessionStore + MockServer
         └── Infrastructure: storage and HTTP plumbing
```

---

## Recursive Interpretation

### The Key Insight: Structural Match

Standard JSON Schema evaluates oneOf by checking if exactly one variant fully
validates. All keyword failures are equal — a type mismatch and a format
violation both mean "variant doesn't match."

Steady's transport layer model disagrees. A format violation is a content note,
not a structural failure. An SDK that sends the right fields but wrong format
values has **structurally matched** the variant.

This changes how composition keywords must be evaluated.

**Example:**

```
POST /payments
Body: { "card_number": "abc" }

Schema oneOf:
  - CardPayment: { required: [card_number],
                    properties: { card_number: { pattern: "^\\d+$" } } }
  - BankPayment: { required: [account_number] }
```

**Standard JSON Schema**: Both variants fail. CardPayment fails (pattern).
BankPayment fails (missing required). oneOf: 0 matched.

**Steady's interpretation**:

- CardPayment: `card_number` present (structural: OK), pattern fails (content) →
  **structurally matches**
- BankPayment: `account_number` missing (structural failure) → **does not
  structurally match**

Result: CardPayment is the structural match. Report E4002 content-note for the
pattern. The SDK transported the card number. The value being non-numeric is a
content issue, not the SDK's fault.

**A post-processing approach misses this.** If attribution happens after
validation, the engine sees "oneOf: 0 matched" (the validator's judgment) and
applies composition patterns to determine responsibility. But one variant DID
match structurally — the engine can't see this because the validator only
reports JSON Schema validity, not structural validity.

The recursive model solves this by propagating structural match up the tree:

```typescript
interface InterpretResult {
  diagnostics: Diagnostic[];
  structurallyValid: boolean;
  structuralFailureCount: number;
}
```

At each tree node, the interpreter returns diagnostics, whether the subtree
structurally matches, and how many structural failures occurred.
`structurallyValid` is the boolean (does this subtree structurally match?).
`structuralFailureCount` is the count (how many individual structural
failures?).

Composition nodes use `structurallyValid` — not JSON Schema validity — to decide
which variant matched. When no variant matches, `structuralFailureCount` is used
for variant identification (fewer structural failures = more likely intended).

### Structural Match vs Attribution

Two independent questions about each validation error:

1. **Structural match**: Does this failure mean the variant's structure doesn't
   match the request? (Used for oneOf/anyOf evaluation)
2. **Attribution**: Whose fault is this error? (Reported in diagnostics)

Structural match is determined by **keyword type**. Attribution is determined by
**E-code and context**. They are independent.

The spec's validation taxonomy (Section 2.3) defines which keywords are
structural. But the classification isn't a simple keyword lookup — some keywords
depend on their value or context:

```
ALWAYS STRUCTURAL (failure = variant doesn't match):
  type, required, additionalProperties (when false),
  enum, const

SPLIT BY VALUE:
  format:
    binary, byte → structural (encoding, SDK's responsibility)
    email, uri, uuid, date-time, ... → content (value validation)

ALWAYS CONTENT (failure = variant still matches):
  pattern, minLength, maxLength, minimum, maximum,
  minItems, maxItems, multipleOf, minProperties, maxProperties,
  uniqueItems

CONTEXT-DEPENDENT:
  additionalProperties (structural when false, ambiguous when spec silent)
```

Note: This list only includes keywords that produce leaf validation errors.
Applicator keywords (`properties`, `items`, `patternProperties`) are flattened
by the validator — they don't appear as nodes in the tree. Their child errors
surface directly with full paths (e.g., `body.address.street`).

At each leaf node:

```
structurallyValid = !isStructural(node.keyword, schema)
```

This is a function, not a table. `isStructural("format", schema)` checks the
format value — `binary` returns true, `email` returns false. `isStructural`
encodes design decisions about what SDKs are responsible for.

Structural match is independent of attribution. An E5001 (null for non-nullable,
attributed as ambiguous) has keyword `type` → structural → variant doesn't
match. An E4001 (email format mismatch, attributed as content-note) has keyword
`format` with value `email` → content → variant still matches.

The keyword + schema determines structural match. The E-code determines
attribution. Same error, two different questions, two different answers
possible.

### The Full Flow

```
DiagnosticEngine.analyze(doc, req):
  // doc is the OpenAPI document from packages/openapi/

  1. Route matching
     └── If fails → routing diagnostic (E2xxx) with enrichment
     └── If matches → continue

  2. Runtime spec issues for matched endpoint (E1xxx)

  3. Parameter validation (query, header, path, cookie)
     └── For each required parameter: check presence → E3002/E3004 if missing
     └── For each present parameter: validate value against schema,
         interpret(tree, doc, "query", paramValue)

  4. Body validation
     └── SchemaValidator produces ValidationTree
     └── interpret(tree, doc, "body", requestBody) produces Diagnostic[]

  5. Return all diagnostics
```

### How interpret() Works

```
interpret(node, spec, location, data) → InterpretResult:

  if node.valid:
    return { diagnostics: [], structurallyValid: true, structuralFailureCount: 0 }

  if node.children:
    childResults = node.children.map(c => interpret(c, spec, location, data))
    if node.keyword is oneOf|anyOf|allOf:
      schema = spec.resolve(node.schemaPath)
      nodeData = resolveDataAtPath(data, node.path, location)
      context = { path: node.path, schemaPath: node.schemaPath, schema, data: nodeData }
      return attributeComposition(node.keyword, childResults, context)
    // Container (root node, variant wrapper): merge children
    return {
      diagnostics: childResults.flatMap(c => c.diagnostics),
      structurallyValid: childResults.every(c => c.structurallyValid),
      structuralFailureCount: sum(childResults.map(c => c.structuralFailureCount))
    }

  // Leaf error
  schema = spec.resolve(node.schemaPath)
  diagnostic = attributeLeaf(node, schema, location)
  structural = isStructural(node.keyword, schema)
  return {
    diagnostics: [diagnostic],
    structurallyValid: !structural,
    structuralFailureCount: structural ? 1 : 0
  }
```

The branching question is: does the node have children?

- **Children + composition keyword** → composition-specific logic (oneOf variant
  selection, allOf merge, anyOf matching)
- **Children, no composition keyword** → container node (root, variant wrapper)
  — merge children's results as the natural default
- **No children** → leaf error — attribute and classify

**Parameters:**

- `spec` is the full OpenAPI document, passed through unchanged. Schema context
  is resolved via `node.schemaPath` only where needed.
- `data` is the value being validated (e.g., the request body for body
  validation, a parameter value for parameter validation). It is threaded
  through unchanged. At composition nodes, `resolveDataAtPath` navigates `data`
  using the node's `path` to get the value at that level — this is what the
  discriminator and property overlap analysis need.

Applicator keywords (`properties`, `items`) are flattened by the validator —
they don't appear as nodes. The `path` field carries nesting context (e.g.,
`body.address.street`).

Bottom-up: leaves are classified first, container nodes merge their children's
results, and composition nodes use structural match to decide which variant
matched. The right decision is made at the right level.

**`structurallyValid` vs `structuralFailureCount`**: Both propagate upward, but
they answer different questions. `structurallyValid` is a boolean: does this
subtree structurally match? Used by composition nodes to decide which variant
matched. `structuralFailureCount` is a number: how many individual structural
failures occurred? Used by variant identification to pick the closest variant
when none match.

Note: `structurallyValid` at the leaf is determined by keyword type, NOT by the
diagnostic's category. The diagnostic might say "ambiguous" (E5001), but the
structural match says "doesn't match" (keyword = type). These are different
questions.

### CompositionContext

Composition handlers receive a context object alongside the child results:

```typescript
interface CompositionContext {
  path: string; // Node's request path (e.g., "body" or "body.payment")
  schemaPath: string; // Node's spec pointer (e.g., "#/.../oneOf")
  schema: Schema; // Resolved schema for the composition node
  data: unknown; // Request data at this path (for discriminator, property overlap)
}
```

This gives composition handlers everything they need: schema access for pitfall
detection, request data for discriminator evaluation and property overlap, and
path info for diagnostic locations.

---

## Composition Logic

### oneOf

```
attributeOneOf(childResults, context):

  // 1. Discriminator — deterministic variant selection
  if context.schema has discriminator:
    return handleDiscriminator(childResults, context)

  structuralMatches = childResults.filter(c => c.structurallyValid)

  // 2. One structural match → variant identified
  if structuralMatches.length === 1:
    return structuralMatches[0]
    // Its diagnostics (content-notes, etc.) are reported
    // No composition diagnostic needed

  // 3. Zero structural matches → variant identification
  if structuralMatches.length === 0:
    return analyzeAllFailed(childResults, context)

  // 4. Multiple structural matches → ambiguous
  if structuralMatches.length > 1:
    return analyzeMultipleMatches(childResults, context)
```

Case 1: When a discriminator is present, it is **the** way to select a variant.
No structural matching needed — the discriminator value deterministically
identifies the variant (see "Discriminator Present" in Pattern Catalog below).

Case 2 is the key improvement for the non-discriminator path. The transport
layer distinction naturally resolves many oneOf cases that would otherwise be
ambiguous composition failures.

### allOf

```
attributeAllOf(childResults, context):

  allDiagnostics = childResults.flatMap(c => c.diagnostics)
  structurallyValid = childResults.every(c => c.structurallyValid)
  structuralFailureCount = sum(childResults.map(c => c.structuralFailureCount))

  // Pitfall: contradictory types (impossible schema) — check first
  if context.schema.allOf members have conflicting type constraints:
    return { diagnostics: [E1012, ...allDiagnostics], structurallyValid: false,
             structuralFailureCount }

  // Pitfall: additionalProperties: false rejecting sibling properties
  if allDiagnostics has E3009:
    for each E3009 diagnostic:
      if rejected property exists in a sibling allOf member's schema:
        re-attribute to spec-issue
        add reasoning: "allOf + additionalProperties pitfall"
        suggest unevaluatedProperties

  return { diagnostics: allDiagnostics, structurallyValid, structuralFailureCount }
```

allOf requires ALL children to match. Structural match is the AND of all
children. Unlike oneOf, there's no variant selection — every child's diagnostics
are reported. The pitfall checks run on the merged result.

### anyOf

```
attributeAnyOf(childResults, context):

  structuralMatches = childResults.filter(c => c.structurallyValid)

  // 1. One or more structural matches → success
  if structuralMatches.length >= 1:
    return {
      diagnostics: structuralMatches.flatMap(c => c.diagnostics),
      structurallyValid: true,
      structuralFailureCount: 0
    }

  // 2. Zero structural matches → same analysis as oneOf
  return analyzeAllFailed(childResults, context)
```

anyOf differs from oneOf in one key way: multiple structural matches are fine.
When one or more variants structurally match, merge their diagnostics and report
as structurally valid. When none match, use the same analysis as oneOf's
zero-match case (variant identification, then E3012 if no clear variant).

---

## Leaf Attribution

For each leaf error, (keyword, location, schema context) determines E-code:

```
Structural (E3xxx):
(type, path)                             → E3001 (Path parameter type mismatch)
(required, query)                        → E3002 (Missing required query parameter)
(type, query)                            → E3003 (Query parameter type mismatch)
(required, header)                       → E3004 (Missing required header)
(required, body)                         → E3007 (Missing required field)
(type, body)                             → E3008 (Field type mismatch)
(additionalProperties, explicitly false) → E3009 (Additional property not allowed)
(type, array item)                       → E3010 (Invalid array item type)
(enum, any)                              → E3016 (Invalid enum value)
(const, any)                             → E3017 (Const value mismatch)
(format, any, format=binary|byte)        → E3018 (Encoding format mismatch)

Content (E4xxx):
(format, any, format=email|uri|...)      → E4001 (Value-validation format mismatch)
(pattern, any)                           → E4002 (Pattern mismatch)
(minLength|maxLength, any)               → E4003 (String length violation)
(minimum|maximum, any)                   → E4004 (Numeric range violation)
(minItems|maxItems, any)                 → E4005 (Array size violation)
(multipleOf, any)                        → E4007 (Multiple-of violation)

Ambiguous (E5xxx):
(type, body, value=null, no nullable)    → E5001 (Null for non-nullable field)
(additionalProperties, spec silent)      → E5003 (Additional properties, spec silent)
```

Note: Missing required parameters (E3002, E3004) are detected during parameter
presence checking (step 3 of the flow), not through schema validation. They
produce diagnostics directly, without going through the interpreter.

Category comes from the E-code registry. Some E-codes need schema context:

- `format` maps to E3018 (structural, sdk-issue) for encoding formats (`binary`,
  `byte`) but E4001 (content-note) for value-validation formats (`email`, `uri`,
  `uuid`, etc.)
- `additionalProperties` maps to E3009 when spec says `false`, E5003 when spec
  is silent
- `type` maps to E3008 normally, E5001 when value is null and schema isn't
  nullable

The `isStructural()` function and the E-code lookup share the same design
judgment about SDK responsibility — encoding and value constraints are the SDK's
job, content validation is the server's.

---

## Routing Diagnostics

Routing diagnostics are created during route matching, outside the recursive
interpretation (there's no validation tree when routing fails).

Pattern enrichment happens inline during diagnostic creation:

```
createRoutingDiagnostic(route, req):
  diag = E2001 or E2002 (default confidence 0.7)

  // Detect double-? pattern
  for param in req.queryParams:
    if param.value.includes('?'):
      diag.confidence = 0.95
      diag.reasoning.push(
        "Query parameter value contains '?' — likely URL construction bug",
        "SDK may be appending '?params' to a URL already containing '?'"
      )

  return diag
```

No separate pattern detection step. Routing diagnostics are created once, with
enrichment applied at creation time.

---

## Pattern Catalog

Patterns are recognized during recursive interpretation, inside the composition
logic. They are not a separate processing step.

### oneOf: All Variants Fail Structurally

**When**: `structuralMatches.length === 0` (no variant structurally matches)

**Analysis** (`analyzeAllFailed(childResults, context)`):

1. Check for variant identification (see below) using `context.data` and each
   child's `structuralFailureCount`.
2. If no clear variant → E3012 with `requestPath: context.path`,
   `specPointer: context.schemaPath`, and reasoning chain listing each variant's
   structural failures.

**Output**: E3012 (ambiguous, confidence 0.5)

### oneOf: Variant Identification

**Goal**: When no variant structurally matches, determine which variant the
request was intended for. Identification, not guessing.

Both steps below use `context.data` (the request data at the composition level)
and `structuralFailureCount` from each child's `InterpretResult`.

**Steps** (in order):

1. **Property overlap**: Compare the keys in `context.data` against each
   variant's `properties` (from `context.schema.oneOf[i]`). If one variant has
   clearly higher overlap (e.g., request has `card_number` which only exists in
   CardPayment's schema), that's the intended variant.

2. **Structural failure count**: If property names don't distinguish, compare
   `structuralFailureCount` across variants. One structural failure vs three →
   the one-failure variant is likely intended. This uses the count propagated up
   through the tree, not the diagnostic's category — structural classification
   and attribution are independent.

3. **No clear variant**: If neither method resolves it, report all variant
   failures. No forced match.

**Output**:

- Variant identified → diagnostics against that variant with higher confidence
- Not identified → E3012 with per-variant details in reasoning chain,
  `requestPath` and `specPointer` from `context`

### oneOf: Discriminator Present

**When**: `context.schema` has a `discriminator` property.

**Analysis**: The discriminator is **the** way to select a variant when present.
No structural matching is needed — the discriminator property value in the
request deterministically identifies which variant was intended. This is the
whole point of discriminators.

```
handleDiscriminator(childResults, context):
  propertyName = context.schema.discriminator.propertyName
  value = context.data[propertyName]   // Read from request data

  // 1. Discriminator property missing
  if value is undefined:
    → E3007 (missing required field, confidence 0.95)
    Discriminator properties are implicitly required.

  // 2. Map value to variant index
  variantIndex = resolveVariant(context.schema, value)
  if variantIndex is null:
    → E3011 (invalid discriminator value, confidence 0.95)

  // 3. Valid discriminator — return that variant's results
  return childResults[variantIndex] with confidence boosted to 0.95
  and reasoning: "Discriminator selected variant {variantIndex}"
```

`resolveVariant` uses the discriminator's `mapping` if present, otherwise
matches `value` against `const` or enum values in each variant's schema for the
discriminator property.

**Output**:

- Discriminator property missing → E3007 (missing required field, high
  confidence — discriminator properties are implicitly required)
- Invalid discriminator value → E3011 (sdk-issue)
- Valid discriminator, variant errors → that variant's diagnostics with high
  confidence

### allOf: additionalProperties Pitfall

A well-known JSON Schema pitfall. Consider:

```yaml
allOf:
  - $ref: "#/components/schemas/BaseUser" # defines: name, email
  - type: object
    properties:
      role: { type: string }
    additionalProperties: false
```

Request `{ "name": "Alice", "email": "a@b.com", "role": "admin" }` is
intuitively correct. But `additionalProperties: false` in the second allOf
member only sees ITS properties (`role`). `name` and `email` are "additional"
from its perspective.

**Detection**: The interpreter sees E3009 for properties that exist in a sibling
allOf member. This requires schema access — the validation tree shows the error,
the schema reveals the sibling relationship.

**Output**: Re-attribute E3009 from sdk-issue to spec-issue. Reasoning explains
the allOf interaction. Suggest `unevaluatedProperties` instead.

**Note**: When the sibling has required fields that will always be rejected by
`additionalProperties: false`, the schema is impossible — detectable at startup
as E1012. When the sibling's fields are optional, the schema is satisfiable (by
omitting those fields) but likely not what the spec author intended — this is a
spec-issue warning, not E1012.

### allOf: Impossible Schema

**When**: allOf children have contradictory constraints (e.g., `type: string`
AND `type: number`).

**Analysis**: No valid input exists. Spec issue.

**Output**: E1012 (spec-issue), regardless of request content.

---

## The Validation Tree

SchemaValidator returns a tree, not a flat list. The tree preserves composition
structure while flattening everything else.

### Why

Flat list loses composition context:

```
[
  { keyword: "required", path: "body.file" },
  { keyword: "required", path: "body.url" }
]
// Which variant did each error come from?
```

The recursive interpreter needs composition structure to evaluate each variant's
structural match independently. But it doesn't need applicator nesting — the
`path` field carries that context.

### Design

The tree has three kinds of nodes:

1. **Composition nodes**: `oneOf`, `anyOf`, `allOf` — have `children`, trigger
   composition-specific logic in the interpreter
2. **Container nodes**: root node, variant wrappers — have `children` but no
   composition keyword, interpreter merges their children's results
3. **Leaf nodes**: keyword failures (`type`, `required`, `enum`, etc.) — no
   children

Applicator keywords (`properties`, `items`, `patternProperties`) are
transparent. The validator evaluates their subschemas but doesn't create tree
nodes for them. Errors from nested properties surface as leaf nodes with full
paths.

```typescript
interface ValidationNode {
  keyword?: string; // Absent on variant wrapper nodes (see example below)
  path: string;
  schemaPath: string; // JSON pointer into the spec — used by interpreter
  // to resolve schema context (format value, sibling
  // schemas, additionalProperties setting, etc.)
  valid: boolean;

  // Leaf errors
  message?: string;
  field?: string; // Keyword-specific detail (e.g., field name for "required")
  expected?: unknown;
  actual?: unknown;

  // Composition nodes
  children?: ValidationNode[];
  variantIndex?: number; // Present on oneOf/anyOf variant wrapper nodes
}
```

`schemaPath` is how the interpreter accesses schema context. The interpreter
receives the full spec document and resolves `schemaPath` when it needs to check
format values, sibling schemas, or other schema-level details.

### Example

For the oneOf case:

```
{
  keyword: "oneOf",
  path: "body",
  schemaPath: "#/requestBody/content/application~1json/schema/oneOf",
  valid: false,
  children: [
    {
      variantIndex: 0,
      valid: false,
      children: [
        { keyword: "required", path: "body", field: "file", valid: false,
          schemaPath: "#/.../FileVariant/required" }
      ]
    },
    {
      variantIndex: 1,
      valid: false,
      children: [
        { keyword: "required", path: "body", field: "url", valid: false,
          schemaPath: "#/.../UrlVariant/required" }
      ]
    }
  ]
}
```

For a flat (non-composition) object with nested errors:

```
{
  valid: false,
  children: [
    { keyword: "type", path: "body.email", expected: "string", actual: "integer",
      schemaPath: "#/.../properties/email/type", valid: false },
    { keyword: "required", path: "body", field: "name",
      schemaPath: "#/.../required", valid: false }
  ]
}
```

No `properties` node. The path says `body.email`, the schemaPath points to the
specific schema. The validator flattened the applicator structure.

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

  suggestion?: string;
}
```

The reasoning chain carries all detail — including composition information like
which variants failed and why. No structured `composition` field. The E-code
tells test frameworks WHAT happened, the category tells them WHO's responsible,
and the reasoning tells developers WHY. If programmatic access to variant
details proves necessary, an optional field can be added without breaking
changes.

Note: `expected` and `actual` are optional. Not every diagnostic has meaningful
values — E2001 "Path not found" or E1010 "Missing responses" don't fit the
expected/actual pattern.

**Spec differences** (implementation plan takes precedence, spec to be updated):

- `category` is top-level here; spec (Section 8.1) nests it under `attribution`.
  Top-level is better for ergonomics (`diagnostic.category` for filtering and
  pass/fail decisions).
- `expected`/`actual` are optional here; spec has them as required.

---

## E-Code Registry

Source of truth for code metadata. The registry below shows representative codes
— the full set is defined in the spec (Section 4.3). The registry is designed to
be extended: adding new E-codes requires only a new entry here and the
corresponding logic in leaf attribution or composition handling. No structural
changes to the engine.

```typescript
interface ECodeDefinition {
  title: string;
  severity: "error" | "warning" | "info";
  category: IssueCategory; // Default category
  fatal?: boolean;
  context?: "startup" | "runtime" | "both";
}

const CODES: Record<string, ECodeDefinition> = {
  // E1xxx - Spec Issues (representative subset)
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

  // E3xxx - Transport (representative subset)
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
  E3009: {
    title: "Additional property not allowed",
    severity: "error",
    category: "sdk-issue",
  },
  E3012: {
    title: "Schema composition mismatch",
    severity: "warning",
    category: "ambiguous",
  },
  E3016: {
    title: "Invalid enum value",
    severity: "error",
    category: "sdk-issue",
  },
  E3017: {
    title: "Const value mismatch",
    severity: "error",
    category: "sdk-issue",
  },
  E3018: {
    title: "Encoding format mismatch",
    severity: "error",
    category: "sdk-issue",
  },

  // E4xxx - Content (representative subset)
  E4001: {
    title: "Value-validation format mismatch",
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
  E5003: {
    title: "Additional properties (spec silent)",
    severity: "warning",
    category: "ambiguous",
  },
};
```

Registry provides DEFAULT category. The recursive interpreter may override based
on context (e.g., E3009 re-attributed to spec-issue when caused by allOf +
additionalProperties pitfall).

---

## Open Questions

These can be resolved during implementation.

### 1. oneOf with Multiple Structural Matches

The interpreter may find multiple structurally-matching variants. This is
possible when the only failing keywords are content keywords (e.g., two variants
differ only by format constraints).

Options:

- Report all as ambiguous
- Use content validation as tiebreaker (closest to full match)
- Report the ambiguity with per-variant details

May need a new E-code (E5xxx) or can reuse E3012 with reasoning.

### 2. Pattern Catalog Completeness

Five patterns identified. Need to discover:

- Deeply nested compositions: What patterns emerge from oneOf inside allOf?
- `if`/`then`/`else` schemas: How to attribute? Are these composition keywords?
- `not` schemas: If `not` fails (data DOES match negated schema), what does that
  mean for attribution?
- Other routing patterns beyond double-`?`

### 3. Pattern Priority

What if multiple patterns apply during interpretation?

- Discriminator should take priority (it's deterministic)
- But can discriminator + impossible schema co-occur?
- Need to define precedence rules or prove they're unnecessary

### 4. Confidence Calibration

Attribution has confidence (0.0-1.0). Need to define:

- What 0.5 means in practice
- How to calibrate against real outcomes
- Whether confidence affects behavior (below threshold → ambiguous?)

### 5. Runtime Spec Issue Detection

Most E1xxx detected at startup. Some only surface at runtime:

- E1010 when endpoint without responses is hit
- Impossible schemas only discovered when that schema is validated against

These are created in step 2 of the flow ("Runtime spec issues for matched
endpoint"). Need to define: which spec issues are detectable at startup vs.
runtime? Can startup detection be exhaustive enough that runtime detection is
rare?

### 6. Structural Match for additionalProperties When Spec Silent

E5003 is ambiguous for attribution. But does it affect structural match? Extra
properties mean the structure doesn't match the schema's expectations, which
suggests yes — but the spec didn't explicitly forbid them.

Leaning yes (structural), but needs validation against real specs.

### 7. Custom/Unknown Formats

Default to content (conservative). Should there be a way to register custom
structural formats? Low priority — address if real-world specs need it.

### Resolved

| Question                      | Resolution                                                                |
| ----------------------------- | ------------------------------------------------------------------------- |
| Validation tree structure     | Designed from scratch — see "The Validation Tree" section                 |
| Schema access                 | `schemaPath` on every node; interpreter resolves against full spec        |
| Structural keyword list       | `isStructural(keyword, schema)` — see "Structural Match" section          |
| enum/const classification     | Structural (SDK constrains inputs)                                        |
| format split                  | binary/byte structural, email/uri/etc content                             |
| expected/actual optionality   | Optional in impl; spec (Section 8.1) to be updated                        |
| Diagnostic category placement | Top-level in impl; spec (Section 8.1) to be updated                       |
| Request data access           | `data` parameter on `interpret()`, passed through to `CompositionContext` |
| Structural failure counting   | `structuralFailureCount` on `InterpretResult`, not derived from category  |
| Composition handler context   | `CompositionContext` with path, schemaPath, schema, data                  |

---

## Project Structure

Dependencies flow one way: `src/` → `packages/openapi/` →
`packages/json-schema/` → `packages/json-pointer/`. Each layer adds concepts. No
layer reaches into a higher layer.

### packages/

```
packages/
├── json-pointer/              # RFC 6901 — pointer parsing, resolution, escaping
│
├── json-schema/               # Pure JSON Schema 2020-12
│   ├── validator.ts           # Tree-returning validator + ValidationNode type
│   ├── processor.ts           # Schema analysis, indexing
│   ├── schema-registry.ts     # Document-centric schema resolution
│   ├── ref-resolver.ts        # $ref resolution
│   ├── response-generator.ts  # Generate valid data from a schema
│   └── types.ts               # Schema types
│
└── openapi/                   # OpenAPI 3.x
    ├── parser.ts              # YAML/JSON parsing
    ├── document.ts            # Structured spec access (operations, parameters)
    ├── paths.ts               # Path templates, pattern matching
    └── types.ts               # OpenAPI types
```

`packages/json-schema/` is pure JSON Schema — no OpenAPI concepts, no Steady
concepts. The tree-returning validator lives here: `ValidationNode` is a JSON
Schema concept (keywords, paths, composition nesting). It knows nothing about
E-codes, attribution, or structural match.

`packages/openapi/` provides structured access to the spec. The engine asks
"what are the required parameters for this operation?" — it doesn't parse raw
spec objects. Path matching, parameter definitions, content types, and
discriminator metadata live here.

### src/

```
src/
├── diagnostic.ts              # Core Diagnostic, IssueCategory, Severity types
│
├── engine/
│   ├── diagnostic-engine.ts   # Top-level analyze() flow
│   ├── interpreter.ts         # Recursive interpret() + InterpretResult
│   ├── types.ts               # ValidationNode, InterpretResult, CompositionContext, SpecResolver
│   ├── leaf-attribution.ts    # (keyword, location, schema) → E-code
│   ├── structural.ts          # isStructural(keyword, schema) classification
│   ├── spec-analyzer.ts       # Startup E1xxx detection
│   ├── composition/
│   │   ├── one-of.ts          # oneOf: discriminator, structural match, multiple matches
│   │   ├── all-of.ts          # allOf: merge + pitfall detection
│   │   ├── any-of.ts          # anyOf: structural match, zero-match fallback
│   │   └── variant-analysis.ts # Shared: analyzeAllFailed, variant identification
│   └── routing.ts             # Route matching + diagnostic enrichment
│
├── codes/
│   ├── registry.ts            # E-code definitions
│   └── explain.ts             # --explain documentation
│
├── output/
│   ├── cli.ts                 # Compiler-style terminal output (colors, markers)
│   ├── ci.ts                  # Grep-able CI output (prefixes, annotations)
│   └── json.ts                # Machine-readable JSON output
│
├── session/
│   ├── store.ts               # Per-session diagnostic storage
│   └── endpoints.ts           # /_steady/sessions/* API
│
└── server/
    ├── server.ts              # HTTP server
    └── headers.ts             # X-Steady-* response headers
```

### cmd/

```
cmd/
└── steady.ts                  # CLI entry point — arg parsing, wiring, exit codes
```

`cmd/steady.ts` wires everything together: parses CLI args (including
`--explain`, `--reject-on-sdk-error`, `--fail-on-ambiguous`, output format),
loads the spec through `packages/openapi/`, creates the engine, starts the
server, and handles exit codes (0/1/3).

---

## Summary

| Decision                 | Choice                | Rationale                                                       |
| ------------------------ | --------------------- | --------------------------------------------------------------- |
| Architecture             | 3 layers              | TransportModel/AttributionEngine add complexity without value   |
| Interpretation           | Recursive             | Structural match must propagate for correct composition eval    |
| Structural match         | Keyword-based         | Independent of attribution category; type=structural regardless |
| Validator output         | Tree                  | Flat list loses composition structure                           |
| Category source          | E-code registry       | Single source, interpreter can override based on context        |
| Composition eval         | Transport-layer-aware | Standard JSON Schema validity ≠ Steady structural match         |
| Diagnostic type          | No composition field  | Reasoning chains carry detail; add structured field if needed   |
| Request data threading   | `data` on interpret() | Discriminator + property overlap need the actual request values |
| Structural failure count | On InterpretResult    | Category ≠ structural classification; need independent count    |
| Discriminator priority   | Primary selector      | When present, discriminator IS the variant selection method     |

The diagnostics are the product. Everything else is plumbing.
