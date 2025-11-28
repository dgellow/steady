# JSON Pointer

RFC 6901 JSON Pointer implementation for JavaScript/TypeScript.

## Purpose

Provides reliable JSON Pointer resolution for traversing JSON documents. This is
the foundation for JSON Schema reference resolution and OpenAPI component
lookups.

## Key Features

- **RFC 6901 Compliant** - Full specification compliance
- **Type Safe** - TypeScript types for pointer operations
- **Error Handling** - Clear error messages for invalid pointers
- **Performance** - Efficient traversal algorithms

## Usage

```typescript
import { resolve } from "@steady/json-pointer";

const data = {
  users: [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ],
};

// Resolve JSON Pointer
const alice = resolve(data, "/users/0"); // { id: 1, name: "Alice" }
const name = resolve(data, "/users/0/name"); // "Alice"
```

## API

- `resolve(data, pointer)` - Resolve a JSON Pointer in data
- `isValidReference(data, pointer)` - Check if pointer is valid
- `getAllReferences(data)` - Extract all `$ref` values from data

## Dependencies

None - pure JavaScript implementation.
