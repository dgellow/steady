# JSON Schema Validator Performance Analysis

## Current Implementation Issues (Anti-Zig-Zen)

### 🔴 **Object Allocation Heavy**
```typescript
// BAD: Creating full objects for every error
errors.push({
  instancePath,
  schemaPath: `${schemaPath}/minItems`,
  keyword: "minItems",
  message: `must NOT have fewer than ${schema.minItems} items`,
  params: { limit: schema.minItems },
  schema: schema.minItems,
  data,
});
```

### 🔴 **String Concatenation in Hot Paths**
```typescript
// BAD: Building paths repeatedly
`${instancePath}/${propName}`
`${schemaPath}/properties/${propName}`
```

### 🔴 **Expensive Deep Comparisons**
```typescript
// BAD: JSON.stringify for uniqueItems comparison
const item = JSON.stringify(data[i]);
if (seen.has(item)) // Very expensive for large objects
```

### 🔴 **Regex Recompilation**
```typescript
// BAD: Compiling same regex repeatedly
const regex = new RegExp(pattern); // In hot validation loop
```

### 🔴 **Deep Recursion**
```typescript
// BAD: Can blow stack on deep schemas
this.validateInternal(subSchema, data, instancePath, schemaPath, errors);
```

### 🔴 **No Early Exit**
```typescript
// BAD: Continues processing even when validation fails
// Should fail fast in many cases
```

## Data-Oriented Design Improvements

### ✅ **Structure of Arrays (SoA) for Errors**
```typescript
interface ValidationErrors {
  instancePaths: string[];
  schemaPaths: string[];
  keywords: string[];
  messages: string[];
  // Pack related data together
}
```

### ✅ **Path String Builder with Reuse**
```typescript
class PathBuilder {
  private buffer: string[] = [];
  
  push(segment: string): void {
    this.buffer.push(segment);
  }
  
  pop(): void {
    this.buffer.pop();
  }
  
  toString(): string {
    return this.buffer.join('/');
  }
}
```

### ✅ **Cached Regex Compilation**
```typescript
class RegexCache {
  private cache = new Map<string, RegExp>();
  
  get(pattern: string): RegExp {
    let regex = this.cache.get(pattern);
    if (!regex) {
      regex = new RegExp(pattern);
      this.cache.set(pattern, regex);
    }
    return regex;
  }
}
```

### ✅ **Iterative Validation with Work Queue**
```typescript
interface ValidationWork {
  schema: Schema;
  data: unknown;
  pathIndex: number; // Index into path array
}

// Process work items in batch instead of recursion
const workQueue: ValidationWork[] = [];
```

### ✅ **Efficient Unique Item Checking**
```typescript
// Use hash-based equality for primitives, structural for objects
function fastEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  // Only use JSON.stringify as last resort
}
```

### ✅ **Memory Pool for Common Objects**
```typescript
class ValidationErrorPool {
  private pool: ValidationError[] = [];
  
  get(): ValidationError {
    return this.pool.pop() ?? { /* new object */ };
  }
  
  release(error: ValidationError): void {
    // Reset and return to pool
    this.pool.push(error);
  }
}
```

### ✅ **Hot/Cold Data Separation**
```typescript
// Hot data: accessed in every validation
interface HotValidationData {
  type: SchemaType;
  required: boolean;
  minimum: number;
  maximum: number;
}

// Cold data: metadata, rarely accessed
interface ColdValidationData {
  title: string;
  description: string;
  examples: unknown[];
}
```

## Performance Characteristics

### Current Implementation:
- **Memory**: O(n × d) where n=data size, d=schema depth
- **Allocations**: ~10-50 objects per validation
- **String ops**: ~5-15 concatenations per property
- **Cache misses**: High (no caching)

### Optimized Implementation:
- **Memory**: O(n + d) with object pooling
- **Allocations**: ~1-3 objects per validation
- **String ops**: ~1-2 operations per property (reused builders)
- **Cache hits**: High (regex, path caching)

## Benchmark Targets

For a 1000-property object with nested arrays:
- **Current**: ~50ms, 10MB allocations
- **Target**: ~5ms, 1MB allocations

The key is to minimize allocations and maximize cache locality while preserving correctness.