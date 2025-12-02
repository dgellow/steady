# Diagnostic System Design

## Overview

Steady's diagnostic system provides comprehensive analysis and error attribution across the full API mock server lifecycle. The key differentiator is **attribution** - helping SDK developers instantly know if an issue is a spec problem or an SDK bug.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         STARTUP (Static Analysis)                        │
│                                                                          │
│  OpenAPI Spec → DocumentAnalyzer → Diagnostic[]                         │
│                                                                          │
│  • Spec quality issues                                                   │
│  • Schema problems                                                       │
│  • Mock server readiness                                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         RUNTIME (Request/Response)                       │
│                                                                          │
│  Request → RequestValidator → Diagnostic[]                              │
│  Response → ResponseValidator → Diagnostic[]                            │
│                                                                          │
│  • Request validation errors (SDK bugs)                                  │
│  • Response generation issues (spec gaps)                                │
│  • Attribution for debugging                                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         REPORTING                                        │
│                                                                          │
│  • Startup display (console)                                             │
│  • Request logs (per-request)                                            │
│  • Error responses (HTTP)                                                │
│  • Aggregated report (session summary)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Types

### Diagnostic

The universal diagnostic type - works for both static and runtime issues:

```typescript
interface Diagnostic {
  // Identification
  code: DiagnosticCode;
  severity: "error" | "warning" | "info" | "hint";

  // Location - JSON Pointer in spec
  pointer: string;

  // Runtime context (optional)
  context?: DiagnosticContext;

  // Description
  message: string;

  // Attribution (Steady's differentiator)
  attribution: Attribution;

  // Actionability
  suggestion?: string;
  documentation?: string;

  // Related locations
  related?: RelatedDiagnostic[];
}
```

### Attribution

Every diagnostic has attribution with confidence scoring:

```typescript
interface Attribution {
  type: "spec-issue" | "sdk-issue" | "ambiguous";
  confidence: number;  // 0.0 - 1.0
  reasoning: string;   // Explanation for attribution
}
```

### Diagnostic Codes

Organized by phase:

**Static (Startup)**
- `ref-unresolved` - $ref points to non-existent target
- `ref-cycle` - Reference cycle detected
- `ref-deep-chain` - Very deep reference chain
- `schema-ref-siblings` - $ref has sibling keywords (JSON Schema 2020-12)
- `schema-complexity` - Very high complexity score
- `schema-nesting` - Very deep nesting
- `mock-no-example` - No example, will generate from schema
- `mock-no-schema` - No schema, can't generate response

**Runtime (Request)**
- `request-path-not-found` - No matching path in spec
- `request-method-not-allowed` - Path exists but method doesn't
- `request-missing-param` - Required parameter missing
- `request-invalid-param` - Parameter doesn't match schema
- `request-invalid-body` - Body doesn't match schema
- `request-wrong-content-type` - Wrong content type

**Runtime (Response)**
- `response-generation-failed` - Couldn't generate response
- `response-no-schema` - No schema defined

## Static Analyzers

### RefAnalyzer

Uses `RefGraph` to detect reference issues:

| Code | Severity | Attribution | When |
|------|----------|-------------|------|
| `ref-unresolved` | error | spec-issue (1.0) | $ref points to non-existent path |
| `ref-cycle` | warning | spec-issue (0.9) | Circular reference detected |
| `ref-deep-chain` | info | spec-issue (0.6) | Reference chain > 10 levels |

### SchemaAnalyzer

Checks JSON Schema quality:

| Code | Severity | Attribution | When |
|------|----------|-------------|------|
| `schema-ref-siblings` | warning | spec-issue (1.0) | $ref with sibling keywords |
| `schema-complexity` | info | spec-issue (0.7) | Complexity score > 1000 |
| `schema-nesting` | info | spec-issue (0.6) | Nesting depth > 20 |

### MockAnalyzer

Checks mock server readiness:

| Code | Severity | Attribution | When |
|------|----------|-------------|------|
| `mock-no-example` | info | spec-issue (0.5) | Response has schema but no example |
| `mock-no-schema` | warning | spec-issue (0.9) | Response has no schema |

## Runtime Attribution Rules

| Code | Attribution | Confidence | Reasoning |
|------|-------------|------------|-----------|
| `request-invalid-body` | sdk-issue | 0.8 | Request body doesn't match schema |
| `request-missing-param` | sdk-issue | 0.9 | SDK should include required params |
| `request-path-not-found` | ambiguous | 0.6 | Could be SDK or spec issue |
| `response-generation-failed` | spec-issue | 0.8 | Schema couldn't generate response |
| `response-no-schema` | spec-issue | 1.0 | Spec doesn't define schema |

## File Structure

```
packages/json-schema/
├── diagnostics/
│   ├── types.ts           # Diagnostic, Attribution, DiagnosticCode
│   ├── attribution.ts     # Attribution rules and logic
│   └── formatter.ts       # Format diagnostics for display
├── analyzers/
│   ├── ref-analyzer.ts    # Reference analysis
│   ├── schema-analyzer.ts # Schema quality checks
│   └── mock-analyzer.ts   # Mock server readiness
├── document-analyzer.ts   # Orchestrates all analyzers
└── openapi-document.ts    # getDiagnostics() integration

src/
├── diagnostics/
│   ├── request-validator.ts   # Runtime request validation
│   ├── collector.ts           # Collects diagnostics per session
│   └── reporter.ts            # Formats for console/HTTP/logs
└── server.ts                  # Integrates diagnostics
```

## Display Examples

### Startup

```
🚀 Steady Mock Server v1.0.0
📄 Loaded spec: Cloudflare API v4.0.0
🔗 Server running at http://localhost:3000

Schema Analysis:
  Total refs: 4421
  Cyclic refs: 0

⚠️  Diagnostics: 2 warnings, 15 info

  warning: schema-ref-siblings (3 occurrences)
    Schemas have $ref with sibling keywords that will be ignored

  info: mock-no-example (12 occurrences)
    Responses will use generated data instead of examples
```

### Error Response

```json
{
  "error": {
    "code": "request-invalid-body",
    "message": "Request body validation failed",
    "attribution": {
      "type": "sdk-issue",
      "confidence": 0.8,
      "reasoning": "Request body doesn't match schema"
    },
    "details": [{
      "pointer": "/user/email",
      "message": "Expected format 'email'"
    }]
  }
}
```

### Session Summary

```
Session Summary:
  Requests handled: 147

  Runtime Issues:
    SDK issues:  23 (request validation failures)
    Spec issues:  3 (response generation problems)

  Top Issues:
    1. request-invalid-body at POST /users (15 times)
    2. request-missing-param at GET /accounts/{id} (8 times)
```

## Design Principles

1. **Unified types** - Same Diagnostic structure for static and runtime
2. **Attribution required** - Every diagnostic must explain who's responsible
3. **Actionable** - Every diagnostic has a suggestion
4. **Lazy evaluation** - Static analysis runs on first access
5. **Composable** - Easy to add new analyzers
