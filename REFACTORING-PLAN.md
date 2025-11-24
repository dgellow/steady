# Refactoring Plan - Unifying Architecture

**Goal:** Single source of truth for schema processing
**Timeline:** Systematic, one fix at a time
**Testing:** Verify each change before moving to next

---

## Phase 1: Unify Reference Resolution (CURRENT)

### Step 1.1: Create ServerSchemaProcessor

**Purpose:** Manage ProcessedSchemas for all response schemas in the OpenAPI spec

**New File:** `src/schema-processor.ts`

```typescript
import { JsonSchemaProcessor, ProcessedSchema, ResponseGenerator } from "../packages/json-schema/mod.ts";
import type { OpenAPISpec } from "@steady/parser";

/**
 * Manages JSON Schema processing for all schemas in an OpenAPI spec
 * Processes schemas once at startup, caches for runtime use
 */
export class ServerSchemaProcessor {
  private schemaCache: Map<string, ProcessedSchema> = new Map();
  private processor: JsonSchemaProcessor;

  constructor(private spec: OpenAPISpec) {
    this.processor = new JsonSchemaProcessor();
  }

  /**
   * Process all response schemas in the spec
   */
  async processAllSchemas(): Promise<void> {
    // Process all component schemas
    if (this.spec.components?.schemas) {
      for (const [name, schema] of Object.entries(this.spec.components.schemas)) {
        const key = `#/components/schemas/${name}`;
        const result = await this.processor.process(schema, {
          baseUri: key,
        });
        if (result.valid && result.schema) {
          this.schemaCache.set(key, result.schema);
        }
      }
    }

    // Process inline schemas in responses
    for (const [path, pathItem] of Object.entries(this.spec.paths)) {
      // ... process each operation's response schemas
    }
  }

  /**
   * Get a response generator for a schema
   */
  getGeneratorForSchema(schema: unknown): ResponseGenerator | null {
    // Find or process the schema, return generator
  }

  /**
   * Generate a response from a schema
   */
  async generateResponse(schema: unknown): Promise<unknown> {
    const generator = this.getGeneratorForSchema(schema);
    if (!generator) return null;
    return generator.generate();
  }
}
```

### Step 1.2: Update MockServer to Use ServerSchemaProcessor

**Changes to `src/server.ts`:**

1. Remove:
   ```typescript
   import { buildReferenceGraph } from "./resolver.ts";
   import { generateFromMediaType } from "./generator.ts";
   private refGraph: ReferenceGraph;
   ```

2. Add:
   ```typescript
   import { ServerSchemaProcessor } from "./schema-processor.ts";
   private schemaProcessor: ServerSchemaProcessor;
   ```

3. In constructor:
   ```typescript
   this.schemaProcessor = new ServerSchemaProcessor(spec);
   await this.schemaProcessor.processAllSchemas();
   ```

4. In generateResponse():
   ```typescript
   // OLD:
   body = generateFromMediaType(mediaType, this.spec, this.refGraph);

   // NEW:
   body = await this.schemaProcessor.generateResponse(mediaType.schema);
   ```

### Step 1.3: Delete Old Files

After verifying the new system works:
- Delete `src/resolver.ts` (229 lines)
- Delete `src/generator.ts` (244 lines)
- Remove `ReferenceGraph` type from `src/types.ts`

**Impact:** -473 lines, unified architecture

---

## Phase 2: Delete Dead Code

### Step 2.1: Delete Completely Unused Validators

**Files to delete:**
1. `packages/json-schema/optimized-validator.ts` (406 lines)
   - Grep confirms: ZERO references
   - Safe to delete immediately

2. `src/validator_legacy.ts` (262 lines)
   - Replaced by `src/validator.ts`
   - Safe to delete immediately

**Command:**
```bash
rm packages/json-schema/optimized-validator.ts
rm src/validator_legacy.ts
```

**Impact:** -668 lines immediately

### Step 2.2: Update MetaschemaValidator

**Goal:** Remove dependency on `validator_legacy.ts`

**File:** `packages/json-schema/metaschema-validator.ts`

**Current:**
```typescript
import { JsonSchemaValidator } from "./validator_legacy.ts";

validate(schema: unknown, metaschema: Schema): ValidationResult {
  const validator = new JsonSchemaValidator();
  return validator.validate(metaschema, schema);
}
```

**New:**
```typescript
import { RuntimeValidator } from "./runtime-validator.ts";
import { JsonSchemaProcessor } from "./processor.ts";

async validate(schema: unknown, metaschema: Schema): Promise<ValidationResult> {
  // Process the metaschema once
  const processor = new JsonSchemaProcessor();
  const result = await processor.process(metaschema);

  if (!result.valid || !result.schema) {
    return { valid: false, errors: result.errors };
  }

  // Validate schema against processed metaschema
  const validator = new RuntimeValidator(result.schema);
  const errors = validator.validate(schema);

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

### Step 2.3: Delete validator_legacy.ts

After MetaschemaValidator is updated:
```bash
rm packages/json-schema/validator_legacy.ts
```

**Impact:** -1,409 lines

**Total Phase 2:** -2,077 lines of dead code deleted!

---

## Phase 3: Clean Up Processor

### Step 3.1: Remove Dead Methods

**File:** `packages/json-schema/processor.ts`

**Methods to delete:**
- `findAllRefs()` (lines 124-183) - Duplicate of resolver logic
- `detectCycles()` (lines 185-219) - Duplicate of resolver logic
- `calculateMaxDepth()` (lines 221-244) - Duplicate of indexer logic
- `countKeywords()` (lines 246-264) - Never used

**Impact:** -140 lines

### Step 3.2: Add Missing Type Import

If `DependencyGraph` type is actually needed, import it from types.ts

**Impact:** +1 line (but fixes type error)

---

## Phase 4: Improve Type Safety

### Step 4.1: Ensure Boolean Schema Support

**Verify all code handles:**
```typescript
type Schema =
  | boolean  // true = allow all, false = allow nothing
  | ObjectSchema;  // The actual schema object
```

**Files to check:**
- [x] packages/json-schema/runtime-validator.ts (already handles it)
- [x] packages/json-schema/response-generator.ts (already handles it)
- [ ] src/validator.ts (needs verification)

### Step 4.2: Unify Error Types

**Create:** `packages/shared/errors.ts`

**Export unified error types:**
- ValidationError
- SchemaError
- ServerError

**Update all files to use shared types**

---

## Testing Plan

### After Each Phase:

1. **Lint Check:**
   ```bash
   deno lint
   ```

2. **Type Check:**
   ```bash
   deno check cmd/steady.ts
   ```

3. **Format:**
   ```bash
   deno fmt
   ```

4. **Integration Tests:**
   ```bash
   deno test tests/integration-test.ts
   ```

5. **Manual Test:**
   ```bash
   deno run --allow-read --allow-net cmd/steady.ts tests/test-spec-with-body.yaml
   curl http://localhost:3001/users
   ```

---

## Success Metrics

### Code Quality
- ✅ Reduce codebase by ~2,500 lines (~17%)
- ✅ Single source of truth for schema processing
- ✅ No duplicate logic
- ✅ Consistent error handling

### Architecture
- ✅ Unified reference resolution
- ✅ Clean separation of concerns
- ✅ Server → json-schema package (one-way dependency)

### Performance
- ✅ Process schemas once at startup
- ✅ Reuse ProcessedSchema for validation & generation
- ✅ No runtime schema analysis overhead

### Type Safety
- ✅ Full Schema | boolean support
- ✅ Consistent type usage
- ✅ No SchemaObject assumptions

---

## Rollback Plan

Each phase is atomic and can be reverted:

**Phase 1 Rollback:**
```bash
git revert <commit-hash>
# Restore src/resolver.ts and src/generator.ts from git
```

**Phase 2 Rollback:**
```bash
git checkout HEAD~1 packages/json-schema/metaschema-validator.ts
git checkout HEAD~1 packages/json-schema/validator_legacy.ts
```

---

## Timeline

- **Phase 1:** 1-2 hours (complex integration)
- **Phase 2:** 30 minutes (straightforward deletions)
- **Phase 3:** 15 minutes (simple cleanup)
- **Phase 4:** 30 minutes (verification & polish)

**Total:** 2-3 hours of careful, systematic refactoring

---

## Current Status

- [x] Code review complete
- [x] Issues documented
- [x] Refactoring plan created
- [ ] **Phase 1 in progress...**
