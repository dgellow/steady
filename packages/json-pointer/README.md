# JSON Pointer

RFC 6901 JSON Pointer implementation.

## Usage

```typescript
import { resolve } from "@steady/json-pointer";

const data = {
  users: [{ id: 1, name: "Alice" }],
};

resolve(data, "/users/0/name"); // "Alice"
```

## API

- `resolve(data, pointer)` - Resolve a JSON Pointer
- `isValidReference(data, pointer)` - Check if pointer is valid
- `getAllReferences(data)` - Extract all `$ref` values

## Dependencies

None.
