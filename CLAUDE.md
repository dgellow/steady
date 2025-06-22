# Steady - The World-Class OpenAPI 3 Mock Server

## Project Overview

Steady is the definitive OpenAPI 3 mock server built with Deno - designed to be
the best of its kind in the world. While other mock servers fail with cryptic 
errors, break on complex specs, or can't handle enterprise scale, Steady excels
where it matters most: **SDK validation workflows** in CI/production environments.

Steady is purpose-built for validating generated SDKs against OpenAPI specifications,
providing surgical precision in distinguishing between SDK bugs and spec issues.
It handles the most complex real-world specs (1500+ endpoints like major cloud
providers) with bulletproof reliability and crystal-clear error attribution.

## Core Philosophy (Zig Zen Principles)

1. **Communicate intent precisely** - Every error message tells you exactly what
   went wrong, where, and how to fix it - with clear attribution between SDK vs spec issues
2. **Edge cases matter** - Handle malformed specs, circular references, massive schemas,
   and enterprise complexity gracefully without breaking
3. **Favor reading code over writing code** - Simple, obvious implementation
   that's easy to understand and maintain at scale
4. **Only one obvious way to do things** - No confusing configuration options or
   multiple ways to achieve the same result
5. **Runtime crashes are better than bugs** - Fail fast and loud rather than
   silently misbehaving, especially in CI environments
6. **Compile errors are better than runtime crashes** - TypeScript's type system
   prevents errors before they happen
7. **Reduce the amount one must remember** - Sensible defaults, minimal
   configuration, works out of the box
8. **Together we serve the users** - Developer experience is paramount, especially
   for SDK validation workflows

## Technical Requirements

### Stack

- **Runtime**: Deno 2.x (latest stable)
- **Language**: TypeScript with strict mode
- **HTTP Server**: Deno's native HTTP server (no frameworks needed)
- **YAML Parser**: Use Deno-compatible YAML parser for OpenAPI specs
- **No external dependencies** except what's absolutely necessary

### Project Structure

```
steady/
├── cli.ts           # CLI entry point
├── server.ts        # HTTP server implementation
├── parser.ts        # OpenAPI spec parser
├── matcher.ts       # Request/route matcher
├── responder.ts     # Response generator
├── validator.ts     # Request/response validator
├── errors.ts        # Custom error types with helpful messages
├── types.ts         # TypeScript type definitions
└── tests/           # Comprehensive test suite
```

## Core Features

### 1. Simple CLI Interface

```bash
# Start with an OpenAPI spec
steady api.yaml

# That's it. No flags, no config files, just works.
# Automatically detects port from spec or uses 3000
# Shows a beautiful, informative startup message
```

### 2. World-Class Error Attribution

When something goes wrong, tell the developer:

- WHAT went wrong (with surgical precision)
- WHERE it went wrong (exact location in spec or request)
- WHY it went wrong (root cause analysis)
- WHO is responsible (SDK bug vs spec issue)
- HOW to fix it (actionable steps)

Example spec validation error:

```
ERROR: Invalid schema in OpenAPI spec

  In spec: api.yaml:47
  Path: GET /users/{id}
  Schema: response.200.content.application/json.schema.properties.email

  The email field schema is invalid:
    Expected: string with format constraint
    Found: type="email" (invalid type)

  CAUSE: OpenAPI spec error
  FIX: Change 'type: email' to 'type: string, format: email'
```

Example request validation error:

```
ERROR: Request validation failed

  Endpoint: POST /users
  Content-Type: application/json
  
  Schema violation in request body:
    Field: user.email  
    Expected: string with format "email"
    Received: "not-an-email"
    Location: $.user.email

  CAUSE: SDK bug - invalid email validation
  FIX: Check the SDK's user creation method for email validation
```

### 3. Request Matching

1. Parse incoming request
2. Find matching path (with path parameters)
3. Validate request against schema
4. Return appropriate response based on:
   - Response examples (preferred)
   - Generated data from schema (fallback)
   - Clear error if neither available

### 4. Response Selection

Priority order:

1. If multiple examples exist, return them in sequence (deterministic)
2. If single example exists, always return it
3. If only schema exists, generate valid response
4. If neither exists, return helpful error (not 500!)

### 5. Validation Modes

Two modes, set via header `X-Steady-Mode`:

- `strict` (default): Validate everything, fail on any mismatch
- `relaxed`: Log warnings but don't fail requests

### 6. Development Features

- **Live reload**: Watch spec file and restart on changes
- **Request logging**: Beautiful, readable request/response logs
- **Validation reports**: Show what matched/didn't match
- **Health endpoint**: `/_x-steady/health` returns server status
- **Spec endpoint**: `/_x-steady/spec` returns the loaded OpenAPI spec

## Implementation Guidelines

### Parser (parser.ts)

```typescript
// Parse OpenAPI spec with excellent error handling
export async function parseSpec(path: string): Promise<OpenAPISpec> {
  // 1. Check file exists
  // 2. Parse YAML/JSON
  // 3. Validate it's valid OpenAPI 3
  // 4. Return typed spec object
  // Every error includes context and fix suggestions
}
```

### Matcher (matcher.ts)

```typescript
// Match incoming requests to OpenAPI operations
export function findOperation(
  request: Request,
  spec: OpenAPISpec,
): Operation | MatchError {
  // 1. Parse URL path
  // 2. Find matching path pattern
  // 3. Extract path parameters
  // 4. Match HTTP method
  // 5. Return operation or detailed error
}
```

### Responder (responder.ts)

```typescript
// Generate responses from OpenAPI definitions
export function generateResponse(
  operation: Operation,
  request: Request,
): Response {
  // 1. Select appropriate response code
  // 2. Find example or generate from schema
  // 3. Set correct content-type
  // 4. Add any defined headers
  // 5. Return Response object
}
```

### Error Handling (errors.ts)

```typescript
// Custom error classes with helpful context
export class SteadyError extends Error {
  constructor(
    message: string,
    public context: ErrorContext,
    public suggestion: string,
  ) {
    super(message);
  }

  // Beautiful error formatting for console
  format(): string {
    // Colorized, structured error output
  }
}
```

## Enterprise-Grade Requirements

### Scalability & Resource Efficiency

- **Handle massive specs**: 1500+ endpoints (Cloudflare-scale) without OOM
- **Efficient recursion handling**: Complex schema references without stack overflow
- **Resource-efficient algorithms**: Smart memory usage, not minimal usage
- **Fast startup**: < 100ms even with complex specs
- **Responsive operation**: < 10ms request processing
- **Memory conscious**: No memory leaks, efficient garbage collection

### Bulletproof Reliability

- **Zero crashes in CI**: Must work flawlessly in automated environments
- **Graceful degradation**: Handle malformed specs without breaking completely
- **Circular reference handling**: Detect and handle recursive schemas safely
- **Enterprise complexity**: Support the most complex real-world specs
- **Clear shutdown**: Proper cleanup on SIGTERM/SIGINT

### World-Class Developer Experience

- **Zero configuration**: Works perfectly out of the box with any valid OpenAPI spec
- **One command install**: `deno install -g https://steady.dev/cli.ts`
- **CI-optimized**: Structured output, clear exit codes, reliable operation
- **SDK validation focus**: Built specifically for generated SDK testing workflows
- **Error attribution**: Instantly know if issues are in SDK code or OpenAPI spec
- **Enterprise-ready**: Replace Stoplight Prism and other tools that break at scale

### Testing

- Unit tests for every module
- Integration tests for common scenarios
- Property-based tests for parser
- Benchmarks for performance-critical paths

## Example Usage

```yaml
# api.yaml
openapi: 3.0.0
info:
  title: User API
  version: 1.0.0
servers:
  - url: http://localhost:3000
paths:
  /users/{id}:
    get:
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        200:
          content:
            application/json:
              example:
                id: 123
                name: "Alice Smith"
                email: "alice@example.com"
```

```bash
# Start the server
$ steady api.yaml

🚀 Steady Mock Server v1.0.0
📄 Loaded spec: User API v1.0.0
🔗 Server running at http://localhost:3000

Available endpoints:
  GET /users/{id}

Press Ctrl+C to stop
```

```bash
# Make a request
$ curl http://localhost:3000/users/123
{
  "id": 123,
  "name": "Alice Smith",
  "email": "alice@example.com"
}
```

## Advanced Features (Future)

These can be added after MVP:

- Response delays simulation
- Webhook testing
- State management between requests
- GraphQL support
- WebSocket support
- Authentication simulation
- Middleware system

## Success Criteria

Steady is successful when:

1. **SDK teams choose Steady over all alternatives** for their CI/validation workflows
2. **Enterprise companies migrate from Prism** because Steady handles their complex specs
3. **Error messages eliminate debugging time** - developers instantly know what's wrong and how to fix it
4. **Zero crashes in production CI** - completely reliable even with massive, complex specs
5. **The code is maintainable at scale** - simple enough for anyone to contribute and extend
6. **Resource efficiency enables broad adoption** - works in constrained environments without compromise

## Development Principles

1. **Start simple** - Get basic request/response working first
2. **Fail loudly** - Never swallow errors or hide problems
3. **Test everything** - Especially edge cases
4. **Document through code** - Self-explanatory > comments
5. **Optimize for humans** - Developer time > computer time

Remember: We're building a tool that developers will use when they're already
frustrated with their integration. Make their day better, not worse.

# JSON Schema Processor - Enterprise-Scale Implementation Plan

## Project Vision

Transform Steady's JSON Schema capabilities from a basic validator into a world-class, enterprise-scale schema processor that can handle the most complex real-world OpenAPI specifications while providing surgical error attribution for SDK validation workflows.

## Current State Analysis

### Package Structure Assessment
The current split makes good sense:
- **`json-pointer/`** - RFC 6901 implementation (solid foundation)
- **`json-schema/`** - JSON Schema processor (needs major redesign)
- **`parser/`** - OpenAPI parser (needs JSON Schema integration)
- **`shared/`** - Common utilities (appropriate)
- **`oas-extract/`** - Separate concern (good isolation)

### Current Issues

1. **`json-schema/` is currently a validator, not a processor**
   - Only validates data against schemas
   - Doesn't validate schemas themselves
   - Missing enterprise-scale capabilities
   - No proper error attribution

2. **`parser/` doesn't use `json-schema/`**
   - Comment shows intended integration: `// import { JsonSchemaValidator }`
   - Missing schema validation in OpenAPI parsing
   - No way to distinguish spec vs SDK issues

3. **Missing the core processor we need**
   - No schema analysis/indexing
   - No response generation capabilities
   - No enterprise-scale reference handling

## High-Level Design

### Core Architecture Principles

1. **Three-Phase Processing**:
   ```
   Raw Object → Schema Analysis → Runtime Operations
   ```

2. **Clear Separation of Concerns**:
   - **Schema Analysis**: Parse, validate, index schemas once
   - **Data Validation**: Fast runtime validation against analyzed schemas
   - **Response Generation**: Create mock data from schemas

3. **Enterprise-Scale Design**:
   - Memory-efficient algorithms for massive specs
   - Circular reference detection without stack overflow
   - Smart caching and indexing for 19K+ references

### Updated Package Responsibilities

#### `json-schema/` - Complete JSON Schema Processor
```typescript
// Core API
export class JsonSchemaProcessor {
  process(schemaObject: unknown): SchemaProcessResult
}

export interface SchemaProcessResult {
  valid: boolean
  schema?: ProcessedSchema
  errors: SchemaError[]
  warnings: SchemaWarning[]
  metadata: SchemaMetadata
}

// Runtime APIs
export class SchemaValidator {
  validate(data: unknown): ValidationResult
}

export class ResponseGenerator {
  generate(): unknown
}
```

#### `parser/` - OpenAPI Parser with Schema Integration
```typescript
export interface ParsedOpenAPISpec {
  spec: OpenAPISpec
  schemas: Map<string, ProcessedSchema>  // All schemas indexed
  endpoints: EndpointInfo[]             // Fast endpoint lookup
  errors: ParseError[]
  warnings: ParseWarning[]
}
```

## Implementation Plan

### Phase 1: Schema Processor Foundation
**Goal**: Transform `json-schema/` into a complete schema processor

**Deliverables**:
1. **`SchemaProcessor`** - Validates and analyzes schema objects
2. **Enterprise-scale reference handling** - Efficient resolution without stack overflow
3. **Schema indexing** - Fast lookups for massive specs
4. **Error attribution** - Distinguish schema issues from data issues

**Validation**: Test with massive-real-life-spec.json (12MB, 19K+ refs)

### Phase 2: Data Validation Engine
**Goal**: Fast runtime validation against processed schemas

**Deliverables**:
1. **`SchemaValidator`** - Runtime data validation
2. **Detailed error context** - Location, cause, fix suggestions
3. **Performance optimization** - <10ms validation for typical requests

**Validation**: SDK test scenarios with clear error attribution

### Phase 3: Response Generation
**Goal**: Generate realistic mock responses from schemas

**Deliverables**:
1. **`ResponseGenerator`** - Create valid data from schemas
2. **Example prioritization** - Use explicit examples when available
3. **Schema-driven generation** - Realistic data from constraints

**Validation**: Generate responses for all endpoints in massive spec

### Phase 4: OpenAPI Integration
**Goal**: Integrate schema processor into OpenAPI parser

**Deliverables**:
1. **Schema extraction** - Pull all schemas from OpenAPI spec
2. **Endpoint indexing** - Fast request routing
3. **Error attribution** - Spec issues vs implementation issues

**Validation**: Parse massive-real-life-spec.json with full schema analysis

## Technical Trade-offs

### Memory vs Speed
**Decision**: Optimize for memory efficiency over raw speed
**Reasoning**: Enterprise specs are memory-constrained, not CPU-constrained
**Implementation**: Lazy loading, efficient indexing, smart caching

### Compilation vs Interpretation
**Decision**: Hybrid approach - analyze once, interpret at runtime
**Reasoning**: Maintains schema context for great error messages while avoiding interpretation overhead
**Implementation**: Pre-process schemas, keep structured representation for runtime

### Error Detail vs Performance
**Decision**: Prioritize error detail
**Reasoning**: Primary use case is debugging SDK issues - clear errors save more time than faster validation
**Implementation**: Rich error context with precise location tracking

## Success Metrics

1. **Enterprise Scale**: Handle 12MB specs with 19K+ references without OOM
2. **Startup Time**: Process massive specs in <10 seconds 
3. **Runtime Performance**: <10ms request validation
4. **Error Quality**: Clear attribution between SDK and spec issues
5. **Memory Efficiency**: Reasonable memory usage even with complex specs

## Current Baseline

- **JSON Schema 2020-12 Compliance**: 91.6% (1151/1257 tests passing)
- **Major remaining work**: unevaluatedProperties (35), unevaluatedItems (19), dynamicRef (18)
- **Test spec**: 12MB enterprise spec with 19K+ references available for validation

# Steady Complete Implementation Plan

## Overall Project Architecture

Steady is built as a modular system with clear separation of concerns:

```
steady/
├── src/              # Main server implementation 
└── packages/
    ├── json-pointer/ # RFC 6901 JSON Pointer (foundation)
    ├── json-schema/  # JSON Schema processor (analysis + validation + generation)
    ├── parser/       # OpenAPI spec parser with schema integration
    └── shared/       # Common utilities and logging
```

## Package Responsibilities

### `json-pointer/` - JSON Pointer Foundation
- **Purpose**: RFC 6901 JSON Pointer implementation
- **Status**: Complete and solid
- **Dependencies**: None
- **Used by**: json-schema, parser

### `json-schema/` - Enterprise JSON Schema Processor
- **Purpose**: Complete JSON Schema analysis, validation, and response generation
- **Status**: Needs major redesign (currently just validator)
- **Key capabilities**:
  - Schema validation against metaschema
  - Enterprise-scale reference resolution (19K+ refs)
  - Runtime data validation with rich error context
  - Response generation from schemas
  - Error attribution (SDK vs spec issues)
- **Dependencies**: json-pointer
- **Used by**: parser, src

### `parser/` - OpenAPI Parser
- **Purpose**: Parse and validate OpenAPI 3.x specifications
- **Status**: Basic implementation, needs JSON Schema integration
- **Key capabilities**:
  - YAML/JSON parsing with clear error messages
  - OpenAPI structure validation
  - Schema extraction and indexing
  - Endpoint discovery and indexing
- **Dependencies**: json-pointer, json-schema
- **Used by**: src

### `shared/` - Common Utilities
- **Purpose**: Shared logging, types, and utilities
- **Status**: Basic implementation
- **Key capabilities**:
  - Structured logging for CI environments
  - Common error types
  - Utility functions
- **Dependencies**: None
- **Used by**: All packages

### `src/` - Main Server Implementation
- **Purpose**: HTTP server, request matching, response generation
- **Status**: Complete implementation
- **Key capabilities**:
  - HTTP server implementation
  - Request routing and matching
  - Response selection and generation
  - Validation modes (strict/relaxed)
  - Error reporting with attribution
  - Health and diagnostic endpoints
- **Dependencies**: packages/parser, packages/json-schema, packages/shared

## Implementation Roadmap

### Phase 1: JSON Schema Processor Foundation
**Timeline**: Current focus
**Goal**: Transform json-schema into enterprise-scale processor

**Tasks**:
1. Schema validation against metaschema
2. Enterprise-scale reference handling
3. Schema indexing and analysis
4. Error attribution system

**Validation**: Handle massive-real-life-spec.json without issues

### Phase 2: Data Validation Engine
**Goal**: Fast runtime validation with excellent error messages

**Tasks**:
1. Runtime data validation against processed schemas
2. Detailed error context with location and suggestions
3. Performance optimization for <10ms validation
4. SDK vs spec error attribution

**Validation**: Clear error messages for SDK testing scenarios

### Phase 3: Response Generation
**Goal**: Generate realistic mock responses

**Tasks**:
1. Response generation from schemas
2. Example prioritization (explicit examples first)
3. Schema-driven data generation
4. Content-type handling

**Validation**: Generate responses for all massive-spec endpoints

### Phase 4: OpenAPI Integration
**Goal**: Complete OpenAPI parser with schema integration

**Tasks**:
1. Integrate json-schema processor into parser
2. Schema extraction from OpenAPI specs
3. Endpoint indexing for fast routing
4. Complete error attribution

**Validation**: Parse massive spec with full schema analysis

### Phase 5: Server Integration
**Goal**: Integrate enhanced JSON Schema processor into existing server

**Tasks**:
1. Update path parameter matching in src/server.ts
2. Enable request body validation in src/validator.ts
3. Integrate JSON Schema processor into src/parser.ts
4. Add proper error attribution throughout
5. Optimize performance for enterprise specs

**Validation**: Full SDK testing workflows

### Phase 6: Advanced Features
**Goal**: Enterprise-grade capabilities

**Tasks**:
1. Live reload on spec changes
2. Interactive logging and debugging
3. Webhook support
4. Performance monitoring
5. CI integration optimizations

**Validation**: Production deployment scenarios

## Success Criteria by Phase

### Phase 1-2: Foundation
- Handle 12MB specs without memory issues
- Process 19K+ references efficiently
- 91.6%+ JSON Schema compliance maintained
- Clear error attribution working

### Phase 3-4: Integration
- Generate responses for all spec endpoints
- Parse massive specs in <10 seconds
- Complete OpenAPI + JSON Schema integration
- SDK testing workflows functional

### Phase 5-6: Production Ready
- <10ms request processing
- Zero crashes in CI environments
- Better than Prism for enterprise specs
- Comprehensive error messages that eliminate debugging time

## Technical Principles

### Resource Efficiency
- Memory-efficient algorithms for massive specs
- Smart caching and indexing
- Lazy loading where appropriate
- No memory leaks or unbounded growth

### Error Excellence
- Surgical error attribution (SDK vs spec)
- Precise location information
- Actionable fix suggestions
- Rich context for debugging

### Enterprise Scale
- Handle 1500+ endpoint specs
- Complex schema recursion support
- Circular reference detection
- Production CI reliability

### Developer Experience
- Zero configuration required
- Clear, beautiful error messages
- Fast feedback loops
- Obvious behavior

This plan ensures Steady becomes the definitive OpenAPI mock server that enterprises choose when they need something that actually works at scale.

# important-instruction-reminders

Do what has been asked; nothing more, nothing less. NEVER create files unless
they're absolutely necessary for achieving your goal. ALWAYS prefer editing an
existing file to creating a new one. NEVER proactively create documentation
files (*.md) or README files. Only create documentation files if explicitly
requested by the User.

## Code Quality Standards

- NEVER TAKE SHORTCUTS FOR ANYTHING. PERIOD.
- NEVER use type assertions (as, !) as shortcuts for type incompatibilities
- NEVER take shortcuts when fixing TypeScript errors - fix the root cause
- NEVER take shortcuts when refactoring - do it properly
- NEVER take shortcuts when debugging - understand the actual problem
- Fix type system issues properly by unifying types or using correct interfaces
- Don't rush - take time to understand and properly resolve issues at their
  source
- When there are type conflicts between packages, align the types properly
  rather than casting
- Do the work correctly the first time instead of patching over problems

# CRITICAL: NO FALLBACKS OR FAKE DATA

- NEVER create fallback results when operations fail
- NEVER fake test data or make up results
- NEVER silently substitute one result for another
- When something fails, report the actual error - don't mask it with fake
  success
- When LLM analysis fails, don't create fake "KEEP_SEPARATE" decisions
- When naming fails, don't fall back to auto-generated names - use the actual
  LLM suggestions
- Fail loudly and clearly rather than producing incorrect results
- If you can't get real data, say so explicitly - don't fabricate alternatives
- ALWAYS preserve and use LLM-provided semantic names, never override with
  location-based names
