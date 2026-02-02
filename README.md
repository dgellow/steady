# Steady

_Pronounced /ˈstiːdi/, like "steed-y"_

OpenAPI 3.0/3.1 mock server built to fast and reliable. Validates requests
against specs and generates responses from schemas or examples.

Note: this project is still experiemental and not ready for production use.

![](./assets/logo.png)

_Note from the artist: the sword is to fight off bugs in your sdks_

## Installation

```bash
# npm
npm install -g @stdy/cli

# npx (no install)
npx @stdy/cli api.yaml

# Deno
deno install -gAn steady jsr:@steady/cli

# deno run (no install)
deno run -A jsr:@steady/cli api.yaml
```

## Usage

```bash
# Start mock server
steady api.yaml

# Validate spec without starting server
steady validate api.yaml

# Watch for spec changes
steady -r api.yaml

# Interactive mode with expandable request logs
steady -i api.yaml
```

### Options

```
steady [command] [options] <spec-file>

Commands:
  validate <spec>    Validate an OpenAPI spec (doesn't start server)
  <spec>             Start mock server (default)

Options:
  -p, --port <port>       Override server port (default: from spec or 3000)
  -r, --auto-reload       Restart on spec file changes
  -i, --interactive       Interactive TUI with expandable logs
  --log-level <level>     summary | details | full (default: summary)
  --log-bodies            Show request/response bodies
  --log=false             Disable request logging
  --strict                Reject invalid requests (default)
  --relaxed               Log warnings but return responses anyway
  -h, --help              Show help

Validator Options:
  --validator-strict-oneof             Require exactly one oneOf variant to match
  --validator-query-array-format=<fmt> Array query param serialization (see below)
  --validator-query-object-format=<fmt> Object query param serialization (see below)

Generator Options:
  --generator-array-size=<n>   Exact size for all generated arrays
  --generator-array-min=<n>    Minimum array size (default: 1)
  --generator-array-max=<n>    Maximum array size (default: 1)
  --generator-seed=<n>         Seed for deterministic generation (-1 for random)
```

### Query Parameter Serialization

Steady supports the full OpenAPI 3.x parameter serialization matrix. By default
(`auto`), Steady reads the `style` and `explode` properties from your OpenAPI
spec for each parameter. You can override this globally via CLI flags or
per-request via headers.

**Array formats** (`--validator-query-array-format`):

| Format     | Example                       | OpenAPI Equivalent             |
| ---------- | ----------------------------- | ------------------------------ |
| `auto`     | Read from spec (default)      | -                              |
| `repeat`   | `colors=red&colors=green`     | `style=form, explode=true`     |
| `comma`    | `colors=red,green,blue`       | `style=form, explode=false`    |
| `space`    | `colors=red%20green%20blue`   | `style=spaceDelimited`         |
| `pipe`     | `colors=red\|green\|blue`     | `style=pipeDelimited`          |
| `brackets` | `colors[]=red&colors[]=green` | PHP/Rails style (non-standard) |

**Object formats** (`--validator-query-object-format`):

| Format       | Example                             | OpenAPI Equivalent          |
| ------------ | ----------------------------------- | --------------------------- |
| `auto`       | Read from spec (default)            | -                           |
| `flat`       | `role=admin&firstName=Alex`         | `style=form, explode=true`  |
| `flat-comma` | `id=role,admin,firstName,Alex`      | `style=form, explode=false` |
| `brackets`   | `id[role]=admin&id[firstName]=Alex` | `style=deepObject`          |
| `dots`       | `id.role=admin&id.firstName=Alex`   | Non-standard (SDK compat)   |

### Port Configuration

The server port is determined in this order:

1. `-p, --port` CLI flag
2. `servers[0].url` port in your spec
3. Default: 3000

```yaml
# Option 1: CLI flag takes precedence
steady -p 8080 api.yaml

# Option 2: Set in spec
servers:
  - url: http://localhost:8080
```

## Response Generation

Steady generates responses in this order:

1. `example` field on the media type
2. First entry from `examples` map
3. Generated from `schema` (if present)

```yaml
responses:
  200:
    content:
      application/json:
        # Option 1: explicit example (preferred)
        example:
          id: 123
          name: "Alice"

        # Option 2: multiple examples
        examples:
          success:
            value: { id: 123, name: "Alice" }

        # Option 3: generate from schema
        schema:
          $ref: "#/components/schemas/User"
```

## Request Validation

In `--strict` mode (default), requests are validated against:

- **Path parameters** - type coercion and schema validation
- **Query parameters** - required check, type validation
- **Headers** - required headers, schema validation
- **Cookies** - required cookies, schema validation
- **Request body** - JSON Schema validation, content-type check

Invalid requests return 400 with validation errors. In `--relaxed` mode,
validation errors are logged but responses are still returned.

### Request Headers

Override server behavior for individual requests:

| Header                         | Description                                          |
| ------------------------------ | ---------------------------------------------------- |
| `X-Steady-Mode`                | Override validation mode: `strict` or `relaxed`      |
| `X-Steady-Query-Array-Format`  | Override array query param serialization format      |
| `X-Steady-Query-Object-Format` | Override object query param serialization format     |
| `X-Steady-Array-Size`          | Override array size (sets both min and max)          |
| `X-Steady-Array-Min`           | Override minimum array size                          |
| `X-Steady-Array-Max`           | Override maximum array size                          |
| `X-Steady-Seed`                | Override random seed (`-1` for non-deterministic)    |
| `X-Steady-Stream-Count`        | Number of items to stream (default: 5)               |
| `X-Steady-Stream-Interval-Ms`  | Interval between streamed items in ms (default: 100) |

```bash
# Force strict validation
curl -H "X-Steady-Mode: strict" http://localhost:3000/users

# Request 50 items in arrays
curl -H "X-Steady-Array-Size: 50" http://localhost:3000/users

# Get random (non-deterministic) responses
curl -H "X-Steady-Seed: -1" http://localhost:3000/users

# Override query format for SDK testing
curl -H "X-Steady-Query-Object-Format: dots" "http://localhost:3000/search?filter.level=high"
```

### Response Headers

Informational headers returned by the server:

| Header                    | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `X-Steady-Mode`           | The validation mode used for this request             |
| `X-Steady-Matched-Path`   | The OpenAPI path pattern that matched                 |
| `X-Steady-Example-Source` | How the response was generated: `generated` or `none` |
| `X-Steady-Streaming`      | Set to `true` for streaming responses                 |

## Streaming Responses

Steady supports streaming responses for NDJSON and Server-Sent Events (SSE):

| Content Type           | Format | Description            |
| ---------------------- | ------ | ---------------------- |
| `application/x-ndjson` | NDJSON | Newline-delimited JSON |
| `application/jsonl`    | NDJSON | JSON Lines             |
| `application/json-seq` | NDJSON | JSON Sequence          |
| `text/event-stream`    | SSE    | Server-Sent Events     |

### Streaming Headers

| Header                        | Description                                 |
| ----------------------------- | ------------------------------------------- |
| `X-Steady-Stream-Count`       | Number of items to stream (default: 5)      |
| `X-Steady-Stream-Interval-Ms` | Interval between items in ms (default: 100) |

```bash
# Stream 10 items with 50ms delay
curl -H "X-Steady-Stream-Count: 10" \
     -H "X-Steady-Stream-Interval-Ms: 50" \
     http://localhost:3000/events
```

### NDJSON Example

```yaml
/metrics:
  get:
    responses:
      "200":
        content:
          application/x-ndjson:
            schema:
              type: object
              properties:
                id: { type: integer }
                value: { type: number }
```

Output:

```
{"id":1,"value":42.5,"_stream":{"index":0,"total":5,"timestamp":"..."}}
{"id":2,"value":43.1,"_stream":{"index":1,"total":5,"timestamp":"..."}}
...
```

### SSE with Event Sequences

Define realistic SSE flows with different event types using array examples:

```yaml
/events:
  get:
    responses:
      "200":
        content:
          text/event-stream:
            example:
              - event: start
                data: { status: "processing" }
              - event: progress
                data: { percent: 50 }
              - event: progress
                data: { percent: 100 }
              - event: complete
                data: { result: "success" }
```

Output:

```
id: 0
event: start
data: {"status":"processing"}

id: 1
event: progress
data: {"percent":50}

id: 2
event: progress
data: {"percent":100}

id: 3
event: complete
data: {"result":"success"}
```

SSE events support these fields:

- `event` - Event type name (default: "message"; set to `null` or `""` to omit)
- `data` - Event payload (required; strings output as-is, objects JSON-encoded)
- `id` - Custom event ID (auto-generated if omitted; set to `null` to omit)
- `retry` - Reconnection timeout in milliseconds

If the last event isn't `done`, `complete`, or `end`, Steady automatically
appends a `done` event to signal stream completion.

### OpenAI-Style SSE

For APIs like OpenAI that use data-only terminal events, set `event` and `id` to
`null`:

```yaml
example:
  - event: message
    data: { delta: { content: "Hello" } }
  - event: null
    id: null
    data: "[DONE]"
```

Output:

```
id: 0
event: message
data: {"delta":{"content":"Hello"}}

data: [DONE]
```

## Special Endpoints

- `GET /_x-steady/health` - Health check with schema stats
- `GET /_x-steady/spec` - Returns the loaded OpenAPI spec as JSON

## JSON Schema Support

Supports JSON Schema draft 2020-12 with ~91% compliance.

**Supported:**

- Types: `string`, `number`, `integer`, `boolean`, `null`, `array`, `object`
- String: `minLength`, `maxLength`, `pattern`, `format`
- Number: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
  `multipleOf`
- Array: `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems`,
  `contains`, `unevaluatedItems`
- Object: `properties`, `required`, `additionalProperties`, `patternProperties`,
  `propertyNames`, `minProperties`, `maxProperties`, `unevaluatedProperties`
- Composition: `allOf`, `anyOf`, `oneOf`, `not`
- Conditional: `if`/`then`/`else`
- References: `$ref`, `$defs`, `$anchor`
- `const`, `enum`, `default`

**Not supported:**

- `$dynamicRef` / `$dynamicAnchor`
- External `$ref` (http://, file://)

## Error Attribution

Errors indicate whether the issue is likely in the spec or the client request:

```
POST /users → 400 Bad Request

Validation errors:
  1. Required parameter missing
     Path: query.limit
     Expected: integer

Attribution: SDK issue (high confidence)
Suggestion: Check SDK implementation - required parameter not sent
```

## Development

```bash
git clone https://github.com/dgellow/steady.git
cd steady
git submodule update --init  # fetch test fixtures

# Run tests
deno task test

# Type check
deno task check

# Lint + format
deno task lint
deno task fmt

# Run all checks
deno task test-all
```

### Project Structure

```
steady/
├── cmd/steady.ts              # CLI entry point
├── src/
│   ├── server.ts              # HTTP server, route matching
│   ├── validator.ts           # Request validation
│   ├── errors.ts              # Error types with attribution
│   └── logging/               # Request logging utilities
├── packages/
│   ├── json-pointer/          # @steady/json-pointer - RFC 6901
│   ├── json-schema/           # @steady/json-schema - JSON Schema processor
│   └── openapi/               # @steady/openapi - OpenAPI 3.x parser
└── tests/
    └── edge-cases/            # Edge case tests
```

### Tasks

```bash
deno task dev               # Dev server with watch
deno task start             # Production server
deno task test              # Run all tests
deno task test:json-schema  # JSON Schema tests only
deno task test:parser       # OpenAPI parser tests only
deno task test:json-pointer # JSON Pointer tests only
deno task check             # Type check
deno task lint              # Lint
deno task fmt               # Format
deno task check-boundaries  # Verify package dependencies
```

## Acknowledgements

Thanks to Stephen Downward for contributing the logo design.
