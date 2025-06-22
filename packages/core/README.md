# Core Server

Main HTTP server implementation that brings together all Steady components to provide world-class OpenAPI mocking.

## Purpose

The core server that provides the HTTP API, request routing, response generation, and error reporting. This is where all the other packages come together to create the complete Steady experience.

## Key Features

- **HTTP Server** - Deno-native HTTP server implementation
- **Request Routing** - Fast path matching with parameter extraction
- **Response Generation** - Smart response selection (examples → generated → errors)
- **Validation Modes** - Strict and relaxed validation with clear feedback
- **Error Attribution** - Surgical precision in distinguishing SDK vs spec issues
- **Health Endpoints** - Diagnostic and monitoring endpoints
- **Live Reload** - Watch spec files for changes

## Current Status

- **Not Yet Created** - Will be implemented in Phase 5
- **Well Planned** - Architecture defined in implementation plan

## Architecture

```typescript
export class SteadyServer {
  constructor(spec: ParsedOpenAPISpec, options?: ServerOptions)
  
  async start(port?: number): Promise<void>
  async stop(): Promise<void>
  
  // Request handling
  private async handleRequest(request: Request): Promise<Response>
  private matchEndpoint(request: Request): EndpointMatch | null
  private generateResponse(endpoint: EndpointMatch, request: Request): Response
}

export interface ServerOptions {
  mode: 'strict' | 'relaxed'
  enableHealthEndpoints: boolean
  enableSpecEndpoint: boolean
}
```

## Dependencies

- `@steady/parser` - OpenAPI spec parsing
- `@steady/json-schema` - Schema validation and response generation
- `@steady/shared` - Logging and utilities

## Used By

- Main CLI application
- Integration tests
- SDK validation workflows