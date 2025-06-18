# Steady - The Reliable OpenAPI 3 Mock Server

## Project Overview

Steady is an OpenAPI 3 mock server built with Deno that prioritizes reliability,
clarity, and developer experience above all else. Where other mock servers fail
with cryptic errors and unpredictable behavior, Steady provides rock-solid
stability with crystal-clear feedback.

## Core Philosophy (Zig Zen Principles)

1. **Communicate intent precisely** - Every error message tells you exactly what
   went wrong and how to fix it
2. **Edge cases matter** - Handle malformed specs, missing examples, and partial
   definitions gracefully
3. **Favor reading code over writing code** - Simple, obvious implementation
   that's easy to understand
4. **Only one obvious way to do things** - No confusing configuration options or
   multiple ways to achieve the same result
5. **Runtime crashes are better than bugs** - Fail fast and loud rather than
   silently misbehaving
6. **Compile errors are better than runtime crashes** - TypeScript's type system
   prevents errors before they happen
7. **Reduce the amount one must remember** - Sensible defaults, minimal
   configuration
8. **Together we serve the users** - Developer experience is paramount

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

### 2. Brilliant Error Messages

When something goes wrong, tell the developer:

- WHAT went wrong
- WHERE it went wrong (file, line number, path)
- WHY it went wrong
- HOW to fix it

Example:

```
ERROR: Missing example for response

  In spec: api.yaml:47
  Path: GET /users/{id}
  Response: 200

  Your OpenAPI spec defines a 200 response but doesn't include an example.

  Add an example to your spec:
    responses:
      200:
        content:
          application/json:
            example:
              id: 123
              name: "John Doe"
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

## Quality Requirements

### Reliability

- Zero crashes in normal operation
- Handle malformed requests gracefully
- Recover from spec parsing errors
- Clear shutdown on SIGTERM/SIGINT

### Performance

- Start up in < 100ms
- Respond to requests in < 10ms
- Minimal memory footprint
- No memory leaks

### Developer Experience

- Install with single command: `deno install -g https://steady.dev/cli.ts`
- Zero configuration for basic use
- Helpful defaults for everything
- Progressive disclosure of advanced features

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

1. A developer can mock an API in 30 seconds
2. Error messages are so good they never need documentation
3. It never crashes or behaves unpredictably
4. The code is so simple anyone can contribute
5. It becomes the obvious choice over Prism

## Development Principles

1. **Start simple** - Get basic request/response working first
2. **Fail loudly** - Never swallow errors or hide problems
3. **Test everything** - Especially edge cases
4. **Document through code** - Self-explanatory > comments
5. **Optimize for humans** - Developer time > computer time

Remember: We're building a tool that developers will use when they're already
frustrated with their integration. Make their day better, not worse.
