# Shared Utilities

Common utilities, types, and logging infrastructure used across all Steady packages.

## Purpose

Provides shared functionality that all Steady packages need, including structured logging for CI environments, common error types, and utility functions. Keeps the other packages focused on their core responsibilities.

## Key Features

- **Structured Logging** - CI-friendly logging with clear output formats
- **Common Error Types** - Consistent error handling across packages
- **Utility Functions** - Shared helper functions
- **Type Definitions** - Common types used across packages

## Current Status

- **Basic Implementation** - Core logging and types available
- **Stable Interface** - Other packages depend on this

## Architecture

```typescript
// Logging
export class Logger {
  info(message: string, context?: Record<string, unknown>): void
  error(message: string, error?: Error, context?: Record<string, unknown>): void
  // ...
}

// Common Types
export interface ErrorContext {
  // ...
}

// Utilities
export function formatError(error: Error): string
```

## Dependencies

None - this is the foundation package.

## Used By

- `@steady/json-pointer` - Error handling
- `@steady/json-schema` - Logging and error types  
- `@steady/parser` - Logging and error types
- `@steady/core` - All utilities