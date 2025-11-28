# Steady - The World-Class OpenAPI 3 Mock Server

The definitive OpenAPI 3.0/3.1 mock server designed to be the best of its kind
in the world. Built specifically for **SDK validation workflows** in CI and
production environments, Steady excels where other tools fail: handling
enterprise-scale specs with surgical error attribution.

## Features

- **Enterprise-Scale Support** - Handle massive specs (1500+ endpoints) without
  breaking
- **Surgical Error Attribution** - Instantly distinguish SDK bugs from spec
  issues
- **Zero Crashes in CI** - Bulletproof reliability in automated environments
- **Resource Efficient** - Smart algorithms that scale without memory issues
- **World-Class Error Messages** - Precise location, root cause, and fix
  instructions
- **SDK Testing Focus** - Built specifically for generated SDK validation
  workflows
- **Complex Schema Handling** - Circular references, deep nesting, massive
  complexity
- **Zero Configuration** - Works perfectly out of the box

## Installation

```bash
deno install -g --allow-read --allow-net --allow-env --allow-write \
  https://raw.githubusercontent.com/dgellow/steady/main/cmd/steady.ts
```

## Quick Start

```bash
# Start mock server with your OpenAPI spec
steady api.yaml

# Validate a spec file
steady validate api.yaml

# Enable interactive TUI logging
steady api.yaml --interactive

# Auto-reload on spec changes
steady api.yaml --auto-reload
```

## Usage

### Basic Usage

Create an OpenAPI specification file (e.g., `api.yaml`):

```yaml
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

Start the mock server:

```bash
steady api.yaml
```

Make requests:

```bash
curl http://localhost:3000/users/123
```

### Command Line Options

```
steady [options] <spec-file>

Options:
  --auto-reload, -r     Watch spec file and restart on changes
  --log-level <level>   Set log level: summary, details, or full (default: summary)
  --log-bodies          Include request/response bodies in logs
  --no-log              Disable request logging
  --strict              Use strict validation mode (default)
  --relaxed             Use relaxed validation mode
  --interactive, -i     Enable interactive TUI logger

Commands:
  steady validate <spec-file>   Check if an OpenAPI spec is valid
```

### Interactive TUI Logger

The interactive logger provides a rich terminal interface for exploring
requests:

```bash
steady api.yaml --interactive
```

**Keyboard shortcuts:**

- `↑/↓` or `j/k` - Navigate requests
- `Enter` - Toggle request details
- `/` - Filter requests
- `#` - Jump to request by hex ID
- `c` - Clear all requests
- `Esc` - Exit filter/jump mode
- `q` or `Ctrl+C` - Quit

## SDK Validation Workflows

Steady excels at validating generated SDKs against OpenAPI specifications:

### CI Integration

```bash
# Run SDK tests with Steady mock server
steady api.yaml --ci-mode &
STEADY_PID=$!

# Run your generated SDK tests
npm test  # or python -m pytest, go test, etc.

# Steady provides detailed attribution for any failures
kill $STEADY_PID
```

### Error Attribution Examples

**SDK Bug Detection:**

```
❌ Request validation failed

  Endpoint: POST /users
  SDK: user_service.create_user(email="invalid")
  
  Schema violation:
    Field: email
    Expected: valid email format
    Received: "invalid"
    
  CAUSE: SDK validation bug
  FIX: Check SDK's email validation logic
```

**Spec Issue Detection:**

```
❌ OpenAPI spec validation failed

  Path: /users/{id}
  Schema: responses.200.content.application/json.schema
  
  Invalid schema definition:
    Field: user.age  
    Issue: type="number" with string constraints
    
  CAUSE: OpenAPI spec error
  FIX: Use type="string" or remove string constraints
```

### Validation Modes

```bash
# Strict mode (default) - fail on any validation error  
steady api.yaml --strict

# Relaxed mode - log warnings but continue processing
steady api.yaml --relaxed

# Per-request control
curl -H "X-Steady-Mode: relaxed" http://localhost:3000/users/123
```

## Enterprise-Scale Capabilities

### Handle Massive Specs

- **1500+ endpoints** (Cloudflare-scale) without memory issues
- **Complex schema recursion** without stack overflow
- **Deep nesting** and circular references handled gracefully
- **Resource-efficient algorithms** that scale properly

### Response Generation

Steady prioritizes responses intelligently:

1. **Explicit examples** - Use provided examples for consistent testing
2. **Schema-generated data** - Create realistic responses from JSON Schema
3. **Detailed errors** - Clear feedback when neither is available

Example with complex schema:

```yaml
responses:
  200:
    content:
      application/json:
        schema:
          type: object
          properties:
            id: { type: integer, minimum: 1 }
            name: { type: string, minLength: 1 }
            email: { type: string, format: email }
            nested:
              type: object
              properties:
                deep: { $ref: "#/components/schemas/RecursiveType" }
          required: [id, name, email]
```

### Why Replace Prism?

- **Prism breaks** on complex, real-world specs
- **Steady scales** to enterprise requirements
- **Better error messages** with precise attribution
- **CI-optimized** for automated testing workflows

## Special Endpoints

Steady provides special endpoints for development:

- `GET /_x-steady/health` - Health check endpoint
- `GET /_x-steady/spec` - Returns the loaded OpenAPI specification

## Development

### Prerequisites

- [Deno](https://deno.land/) 2.x or later

### Running from Source

```bash
# Clone the repository
git clone https://github.com/dgellow/steady.git
cd steady

# Run directly
deno run --allow-read --allow-net --allow-env --allow-write cmd/steady.ts api.yaml

# Or use the dev task
deno task dev api.yaml
```

### Project Structure

```
steady/
├── cmd/
│   └── steady.ts         # CLI entry point
├── src/                   # Core source files
│   ├── server.ts         # HTTP server implementation
│   ├── generator.ts      # Response generation
│   ├── resolver.ts       # Reference resolution
│   ├── validator.ts      # Request validation
│   └── ...
├── packages/
│   ├── parser/           # OpenAPI parser package
│   └── shared/           # Shared utilities and logging
├── scripts/              # Development scripts
└── tests/                # Test files and specs
```

### Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run quality checks (`deno task test-all`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Quality

All code must pass:

- `deno fmt` - Code formatting
- `deno check` - Type checking
- `deno lint` - Linting
- `deno task check-boundaries` - Package dependency checks

## Philosophy

Steady is built to be the world's best OpenAPI mock server:

- **Enterprise-first** - Handle the most complex real-world specs without
  breaking
- **SDK-focused** - Designed specifically for generated SDK validation workflows
- **Error attribution** - Instantly distinguish between SDK bugs and spec issues
- **Resource efficient** - Smart algorithms that scale to massive specs
- **Zero crashes** - Bulletproof reliability in CI and production environments
- **Developer experience** - Error messages so good they eliminate debugging
  time

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

Built with [Deno](https://deno.land/) for a modern, secure runtime experience.
