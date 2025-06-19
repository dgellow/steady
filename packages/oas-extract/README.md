# OpenAPI Schema Extractor

An intelligent tool for extracting inline schemas from OpenAPI specifications
and giving them meaningful names using AI (Gemini Flash).

## Features

- 🤖 **AI-Powered Naming**: Uses Gemini Flash to generate context-aware,
  meaningful schema names
- 📦 **Smart Batching**: Groups related schemas for efficient LLM processing
- 🎯 **Configurable Extraction**: Set complexity thresholds to extract only what
  matters
- 📊 **Detailed Reports**: Get insights into what was extracted and why
- 🔄 **Safe Transformation**: Preserves all schema properties and metadata

## Installation

```bash
# Clone the repository
git clone <your-repo>
cd oas-tools/packages/oas-extract

# Set up your Gemini API key
cp .env.example .env
# Edit .env and add your Gemini API key
```

## Usage

### Basic Extraction

```bash
# Extract schemas from an OpenAPI spec
deno run --allow-read --allow-write --allow-net --allow-env cli.ts extract datadog-openapi.json
```

### With Options

```bash
# Custom output file
deno run --allow-read --allow-write --allow-net --allow-env cli.ts extract api.json -o clean-api.json

# Dry run to preview changes
deno run --allow-read --allow-write --allow-net --allow-env cli.ts extract api.json --dry-run --verbose

# Extract only complex schemas
deno run --allow-read --allow-write --allow-net --allow-env cli.ts extract api.json --min-properties 5

# Generate a report
deno run --allow-read --allow-write --allow-net --allow-env cli.ts extract api.json --report extraction-report.md
```

## How It Works

1. **Analysis**: Scans your OpenAPI spec to find inline schemas
2. **Context Extraction**: Captures path, method, and location information
3. **Smart Batching**: Groups related schemas by resource
4. **AI Naming**: Sends batches to Gemini Flash for intelligent naming
5. **Conflict Resolution**: Ensures all names are unique and valid
6. **Transformation**: Replaces inline schemas with $ref to components

## Example

Before:

```json
{
  "paths": {
    "/api/v2/actions/connections": {
      "post": {
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "data": {
                    "type": "object",
                    "properties": {
                      "attributes": {
                        "type": "object",
                        "properties": {
                          "name": { "type": "string" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

After:

```json
{
  "paths": {
    "/api/v2/actions/connections": {
      "post": {
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateActionConnectionRequest"
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "CreateActionConnectionRequest": {
        "type": "object",
        "properties": {
          "data": {
            "$ref": "#/components/schemas/ActionConnectionData"
          }
        }
      },
      "ActionConnectionData": {
        "type": "object",
        "properties": {
          "attributes": {
            "$ref": "#/components/schemas/ActionConnectionAttributes"
          }
        }
      },
      "ActionConnectionAttributes": {
        "type": "object",
        "properties": {
          "name": { "type": "string" }
        }
      }
    }
  }
}
```

## Configuration

### Environment Variables

- `GEMINI_API_KEY`: Your Gemini API key (required)

### CLI Options

- `--output, -o`: Output file path
- `--min-properties`: Minimum properties for object extraction (default: 2)
- `--min-complexity`: Minimum complexity score (default: 3)
- `--dry-run`: Preview changes without modifying files
- `--verbose`: Show detailed progress
- `--report`: Save extraction report to file
- `--no-nested`: Don't extract nested objects
- `--no-array-items`: Don't extract array item schemas

## Programmatic Usage

```typescript
import { OpenAPIExtractor } from "./mod.ts";

const extractor = new OpenAPIExtractor({
  minProperties: 3,
  verbose: true,
});

const spec = JSON.parse(await Deno.readTextFile("api.json"));
const result = await extractor.extract(spec);

console.log(`Extracted ${result.extracted.length} schemas`);
```

## License

MIT
