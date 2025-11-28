# JSON Schema Processor

Enterprise-scale JSON Schema 2020-12 processor designed for OpenAPI validation
workflows.

## Purpose

Complete JSON Schema processing system that validates schemas themselves,
provides runtime data validation with rich error context, and generates mock
responses. Built specifically for handling massive enterprise OpenAPI
specifications with surgical error attribution.

## Key Features

- **Schema Analysis** - Validate schemas against JSON Schema metaschema
- **Enterprise Scale** - Handle 12MB specs with 19K+ references efficiently
- **Error Attribution** - Distinguish between SDK bugs and spec issues
- **Runtime Validation** - Fast data validation with detailed error context
- **Response Generation** - Create realistic mock data from schemas
- **Reference Resolution** - Comprehensive $ref, $anchor, and $dynamicRef
  support

## Current Status

- **JSON Schema 2020-12 Compliance**: 91.6% (1151/1257 tests passing)
- **Architecture**: Undergoing redesign from validator-only to complete
  processor
- **Major remaining work**: unevaluatedProperties, unevaluatedItems, dynamicRef

## Architecture

```typescript
// Core API
export class JsonSchemaProcessor {
  process(schemaObject: unknown): SchemaProcessResult;
}

// Runtime APIs
export class SchemaValidator {
  validate(data: unknown): ValidationResult;
}

export class ResponseGenerator {
  generate(): unknown;
}
```

## Dependencies

- `@steady/json-pointer` - JSON Pointer resolution

## Used By

- `@steady/parser` - OpenAPI parser integration
- `@steady/core` - Main server logic
