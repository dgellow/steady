# OpenAPI Parser

OpenAPI 3.x specification parser.

## Usage

```typescript
import { parseSpecFromFile } from "@steady/openapi";

const spec = await parseSpecFromFile("api.yaml");
```

## Dependencies

- `@steady/json-pointer`
- `@steady/json-schema`
