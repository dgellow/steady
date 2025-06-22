# Steady Core Server Implementation

This directory contains the main HTTP server implementation for Steady - the world-class OpenAPI 3 mock server built for SDK validation workflows.

## Purpose

The `src/` directory implements the core server functionality that transforms OpenAPI specifications into a running mock server. This is where requests are received, matched to operations, validated, and responses are generated.

## Architecture Intent

This implementation follows Steady's core philosophy of **surgical error attribution** - distinguishing between SDK bugs and OpenAPI spec issues with precision. Every component is designed to provide clear, actionable feedback when something goes wrong.

### Key Principles

1. **Fail loudly with context** - Never silently ignore validation failures
2. **Attribution over speed** - Prioritize clear error messages over raw performance
3. **Enterprise-scale reliability** - Handle massive specs (1500+ endpoints) without crashes
4. **Zero configuration** - Works perfectly out of the box with any valid OpenAPI spec

## Component Responsibilities

### `server.ts` - HTTP Server Core
- Receives incoming HTTP requests
- Routes requests to appropriate OpenAPI operations
- Coordinates validation and response generation
- **Current limitation**: Only exact path matching (no path parameters)

### `parser.ts` - OpenAPI Spec Parser
- Parses YAML/JSON OpenAPI specifications
- Validates OpenAPI structure and syntax
- **Missing**: JSON Schema validation of embedded schemas

### `matcher.ts` - Request Matching Engine
- Matches incoming requests to OpenAPI operations
- Extracts path parameters from URL patterns
- Handles HTTP method matching

### `validator.ts` - Request/Response Validation
- Validates requests against OpenAPI schemas
- **Current limitation**: Request body validation disabled
- Provides detailed validation error context

### `generator.ts` - Mock Response Generation
- Generates realistic mock data from JSON Schemas
- Handles circular references and complex recursive schemas
- Prioritizes explicit examples over generated data

### `responder.ts` - Response Builder
- Selects appropriate response for matched operations
- Handles content-type negotiation
- Formats final HTTP responses

### `errors.ts` - Error Handling
- Custom error types with rich context
- Formatted error messages for debugging
- Clear attribution between SDK and spec issues

## Current State vs Vision

### ✅ What Works
- Complete HTTP server with beautiful logging
- Sophisticated response generation with circular reference handling
- Basic request routing and validation framework
- Enterprise-scale spec parsing (handles 12MB specs)

### ⚠️ Current Limitations
1. **Path parameters**: Only exact path matching (`/users/123` works, `/users/{id}` doesn't)
2. **Request body validation**: Disabled in validator (`// For MVP, skip body validation`)
3. **Schema validation**: Parser doesn't validate JSON Schemas within OpenAPI specs
4. **Error attribution**: Cannot distinguish SDK bugs from spec issues

### 🎯 Next Steps
1. **Enable path parameter matching** in `server.ts:259-260`
2. **Enable request body validation** in `validator.ts:57-59`
3. **Integrate JSON Schema processor** for spec validation
4. **Add surgical error attribution** throughout the validation pipeline

## Integration with Packages

This implementation depends on the modular packages in `../packages/`:

- **`json-schema/`**: Will provide schema validation and response generation (needs enhancement)
- **`parser/`**: OpenAPI structure parsing (needs JSON Schema integration)
- **`json-pointer/`**: Reference resolution for complex schemas
- **`shared/`**: Logging and common utilities

## Success Criteria

This implementation succeeds when:

1. **SDK teams choose Steady** over alternatives for CI validation workflows
2. **Zero crashes** even with massive, complex OpenAPI specifications
3. **Instant error attribution** - developers immediately know if issues are SDK or spec problems
4. **Enterprise adoption** - replaces tools like Prism that break at scale

The code in this directory transforms OpenAPI specifications into a reliable, enterprise-grade mock server that makes developers' lives better when they're already frustrated with integration issues.