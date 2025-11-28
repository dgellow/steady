# OpenAPI Parser

Enterprise-grade OpenAPI 3.x specification parser with integrated JSON Schema
processing.

## Purpose

Parse and validate OpenAPI 3.0/3.1 specifications, extract and analyze all
embedded JSON Schemas, and provide fast endpoint indexing for the mock server.
Designed to handle massive enterprise specs with excellent error messages.

## Key Features

- **OpenAPI 3.x Support** - Full compatibility with OpenAPI 3.0 and 3.1
- **JSON Schema Integration** - Extract and validate all schemas in the spec
- **Enterprise Scale** - Handle specs with 1500+ endpoints efficiently
- **Excellent Error Messages** - Clear attribution of spec issues with fix
  suggestions
- **Endpoint Indexing** - Fast lookup structures for request routing
- **Reference Resolution** - Handle complex $ref structures across the spec

## Current Status

- **Basic Implementation** - YAML/JSON parsing with validation
- **Needs Integration** - JSON Schema processor integration pending
- **Good Error Messages** - Already provides detailed error context

## Architecture

```typescript
export interface ParsedOpenAPISpec {
  spec: OpenAPISpec;
  schemas: Map<string, ProcessedSchema>; // All schemas indexed
  endpoints: EndpointInfo[]; // Fast endpoint lookup
  errors: ParseError[];
  warnings: ParseWarning[];
}

export async function parseSpec(path: string): Promise<ParsedOpenAPISpec>;
```

## Dependencies

- `@steady/json-pointer` - JSON Pointer resolution
- `@steady/json-schema` - Schema processing and validation

## Used By

- `@steady/core` - Main server logic
