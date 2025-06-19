# Steady - The Reliable OpenAPI 3 Mock Server

A rock-solid OpenAPI 3.0/3.1 mock server built with Deno that prioritizes
reliability, clarity, and developer experience. Where other mock servers fail
with cryptic errors, Steady provides crystal-clear feedback and predictable
behavior.

## Features

- **OpenAPI 3.0 & 3.1 Support** - Full compatibility with modern OpenAPI
  specifications
- **Excellent Error Messages** - Know exactly what went wrong and how to fix it
- **Smart Example Generation** - Automatically generates valid responses from
  schemas when examples aren't provided
- **Interactive TUI Logger** - Navigate and filter requests with a beautiful
  terminal interface
- **Zero Configuration** - Just point it at your spec and go
- **Fast & Lightweight** - Built on Deno for minimal overhead

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

### Validation Modes

Control how strictly Steady validates requests:

```bash
# Strict mode (default) - fail on any validation error
steady api.yaml --strict

# Relaxed mode - log warnings but don't fail requests
steady api.yaml --relaxed

# Or use the X-Steady-Mode header per request
curl -H "X-Steady-Mode: relaxed" http://localhost:3000/users/123
```

## Response Generation

Steady prioritizes responses in this order:

1. **Explicit examples** - If your spec includes example responses, those are
   used
2. **Generated from schema** - Valid data is generated based on your JSON Schema
3. **Helpful errors** - If neither is available, you get a clear error message

Example with schema generation:

```yaml
responses:
  200:
    content:
      application/json:
        schema:
          type: object
          properties:
            id:
              type: integer
              minimum: 1
            name:
              type: string
              minLength: 1
            email:
              type: string
              format: email
          required: [id, name, email]
```

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

Steady follows the Zig Zen principles:

- **Communicate intent precisely** - Every error tells you exactly what went
  wrong
- **Edge cases matter** - Handle malformed specs and partial definitions
  gracefully
- **Favor reading code over writing code** - Simple, obvious implementation
- **Runtime crashes are better than bugs** - Fail fast and loud
- **Together we serve the users** - Developer experience is paramount

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

Built with [Deno](https://deno.land/) for a modern, secure runtime experience.
