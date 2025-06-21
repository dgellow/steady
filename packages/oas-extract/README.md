# OAS Extract

A reliable tool for extracting inline schemas from OpenAPI 3.0 specifications
with AI-powered semantic naming.

## Overview

OAS Extract analyzes OpenAPI specs and extracts inline schemas into reusable
components with meaningful names. Unlike simple extraction tools that produce
generic names like "response0", this tool uses Gemini Flash LLM to generate
semantic, domain-aware names.

## Key Features

- **Fast Analysis**: Processes large specs (8MB+) in under 100ms
- **AI-Powered Naming**: Uses Gemini Flash for meaningful schema names
- **Semantic Deduplication**: Intelligently merges duplicate schemas based on
  semantic analysis
- **Deterministic by Default**: Produces reproducible outputs for CI/CD pipelines
- **Rate Limiting**: Built-in exponential backoff for API reliability
- **Structured Output**: Uses JSON schema validation for reliable LLM responses

## Determinism and Reproducibility

The tool defaults to the `deterministic` strategy (temperature=0) which guarantees
100% reproducible schema names across runs. This is critical for CI/CD pipelines
and version control.

Our research (see `/research/llm-naming-determinism/`) discovered that even low
temperature settings like 0.2 produce only 32.8% naming consistency. There is no
middle ground - any temperature above 0 introduces randomness.

For development or one-time extractions where naming quality matters more than
consistency, use the `adaptive` or `multi-sample` strategies:

```bash
# For exploration and better names (accepts naming variations)
oas-extract extract api.yaml --strategy adaptive

# For highest quality names (runs 3x samples, picks best)
oas-extract extract api.yaml --strategy multi-sample
```

## Installation

```bash
# From the oas-tools directory
deno task extract --help
```

## Usage

```bash
# Basic extraction (uses deterministic strategy by default)
oas-extract extract api.yaml

# With different naming strategy for better names (not reproducible)
oas-extract extract api.yaml --strategy adaptive

# Verbose output to see progress
oas-extract extract api.yaml --verbose

# Custom complexity thresholds
oas-extract extract api.yaml --min-properties 3 --min-complexity 5
```

## CLI Flags

### Core Options

- `--dry-run`: Analyze and report without transforming the spec
- `--verbose`: Show detailed progress information
- `--output <file>`: Specify output file (default: adds `-extracted` suffix)

### Extraction Filters

- `--min-properties <n>`: Minimum properties required to extract object schemas
  (default: 2)
- `--min-complexity <n>`: Minimum complexity score to extract schemas
  (default: 3)

The complexity score considers:

- Number of properties
- Nesting depth
- Array items
- Object references

### Deduplication

- `--enable-deduplication`: Enable semantic deduplication using AI analysis
  (experimental)

When enabled, the tool performs two-phase deduplication:

1. **Structural grouping**: Groups schemas with identical structure
2. **Semantic analysis**: Uses LLM to determine if structurally identical
   schemas represent the same logical concept

### Performance

- `--concurrency <n>`: Number of batches to process in parallel (default: 1)

Higher concurrency can speed up processing but may increase rate limiting. For
reliability, the default is 1 (sequential processing).

## Algorithm Overview

### Phase 1: Fast Structural Analysis

Uses a stack-based, non-recursive traversal to quickly identify all inline
schemas:

1. **Schema Discovery**: Traverses OpenAPI spec to find inline schemas in:
   - Request bodies (`requestBody.content.*.schema`)
   - Response bodies (`responses.*.content.*.schema`)
   - Parameters (`parameters.*.schema`)
   - Nested object properties

2. **Context Extraction**: Captures rich context for each schema:
   - Path and HTTP method
   - Location within the spec
   - Operation ID and resource name
   - Parent context for nested schemas

3. **Filtering**: Applies complexity and property count filters to focus on
   meaningful schemas

### Phase 2: Semantic Deduplication (Optional)

When `--enable-deduplication` is enabled:

1. **Structural Fingerprinting**: Groups schemas by structural similarity:
   ```typescript
   fingerprint = {
     props: sortedPropertyNames,
     types: propertyTypes,
     required: sortedRequiredFields,
     arrayItems: itemsFingerprint,
   };
   ```

2. **Batch Analysis**: Processes groups using Gemini Flash with structured
   output:
   ```json
   {
     "analyses": [{
       "groupId": "group-1",
       "decision": "MERGE" | "KEEP_SEPARATE",
       "confidence": "HIGH" | "MEDIUM" | "LOW",
       "reasoning": "Explanation...",
       "semanticConcept": "User | BillingUsage | APIError"
     }]
   }
   ```

3. **Conservative Merging**: Only merges schemas with HIGH confidence decisions

### Phase 3: AI-Powered Naming

1. **Batch Processing**: Groups schemas by resource/domain for contextual naming
2. **LLM Prompting**: Provides rich context to Gemini Flash:
   - API domain and resource group
   - Schema structure preview
   - Path, method, and location information
3. **Name Generation**: Follows naming conventions:
   - Request bodies: `{Resource}{Method}Request`
   - Responses: `{Resource}{Method}Response` or `{Resource}`
   - Nested objects: `{Parent}{Property}`
   - Arrays: `{Parent}Item`

### Phase 4: Spec Transformation

1. **Component Creation**: Adds extracted schemas to `components.schemas`
2. **Reference Replacement**: Replaces inline schemas with `$ref` pointers
3. **Validation**: Ensures transformed spec remains valid

## Rate Limiting & Reliability

The tool implements patient exponential backoff for API reliability:

- **429 Handling**: Exponential backoff from 3s to 2min with jitter
- **Max Retries**: Up to 8 retries for rate-limited requests
- **Request Spacing**: 5s delay between naming batches, 8s between deduplication
  batches
- **Conservative Processing**: Single-threaded by default for reliability

## Example Results

From a real 8.4MB Datadog OpenAPI spec:

- **Before**: 834 inline schemas
- **After structural deduplication**: 236 unique schemas (71.7% reduction)
- **After semantic deduplication**: 39 schemas (58% additional reduction)
- **Processing time**: ~90ms for analysis + ~2min for AI naming
- **Generated names**: `DatadogBillingUsage`, `AWSCredentials`, `MetricQuery`

## Configuration

Set your Gemini API key:

```bash
# In packages/oas-extract/.env
GEMINI_API_KEY=your_api_key_here
```

The tool will also check for the environment variable `GEMINI_API_KEY`.

## Error Handling

- **Graceful degradation**: Falls back to rule-based naming if LLM fails
- **Network resilience**: Retries on connection issues
- **Partial success**: Continues processing even if some batches fail
- **Clear error messages**: Provides actionable feedback for common issues

## Performance Characteristics

- **Startup**: ~100ms for large specs
- **Memory**: Minimal footprint with streaming analysis
- **Concurrency**: Conservative single-threaded processing for reliability
- **API Usage**: Efficient batching to minimize LLM requests

## Limitations

- Requires Gemini API key for semantic naming
- Deduplication is experimental and conservative
- Processing time scales with number of unique schemas
- Limited to OpenAPI 3.0 specifications

## Contributing

The tool follows Steady's philosophy of reliability over speed. When making
changes:

1. Prioritize correctness over performance
2. Use meaningful error messages
3. Handle edge cases gracefully
4. Test with real-world specs

## License

Part of the Steady project - see main repository for license details.
