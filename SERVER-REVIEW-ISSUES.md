# Server and Request Handling - Code Review Issues

## Critical Issues (Must Fix Immediately)

### CRITICAL-1: Missing await on async metaschema validation
**File**: `packages/json-schema/processor.ts:43`
**Severity**: 🔴 Critical - Bug introduced in recent refactoring

```typescript
// WRONG (current):
const metaschemaResult = this.metaschemaValidator.validate(
  schemaObject,
  source.metaschema,
);

// CORRECT:
const metaschemaResult = await this.metaschemaValidator.validate(
  schemaObject,
  source.metaschema,
);
```

**Impact**: Metaschema validation is completely bypassed! The Promise is never awaited, so validation results are ignored. Invalid schemas will be processed as if they're valid.

**Root Cause**: When refactoring MetaschemaValidator to use RuntimeValidator, I made `validate()` async but forgot to update the call site in processor.ts.

---

### CRITICAL-2: Path parameter values are not URL-decoded
**File**: `src/server.ts:349-385` (matchPath function)
**Severity**: 🔴 Critical - Data corruption bug

```typescript
// Current code extracts params but doesn't decode them:
const paramName = patternSeg.slice(1, -1);
params[paramName] = requestSeg;  // BUG: requestSeg might be URL-encoded

// Should be:
params[paramName] = decodeURIComponent(requestSeg);
```

**Example**:
- Request: `GET /users/John%20Doe`
- Pattern: `/users/{name}`
- Current behavior: `pathParams.name === "John%20Doe"` ❌
- Correct behavior: `pathParams.name === "John Doe"` ✅

**Impact**: Path parameters with special characters (spaces, unicode, etc.) will have incorrect values when passed to validators and responses.

---

## High Priority Issues

### HIGH-1: Schema cache key collision risk
**File**: `src/validator.ts:330`
**Severity**: 🟠 High - Correctness issue

```typescript
// PROBLEMATIC:
const schemaKey = JSON.stringify(schema);
let validator = this.schemaProcessors.get(schemaKey);
```

**Problems**:
1. **Not deterministic**: Object property order in JSON.stringify is not guaranteed
2. **Performance**: Stringifying large schemas on every request is expensive
3. **Collision risk**: Two semantically different schemas could stringify to same value if properties are in different order

**Better approaches**:
- Use a sequential ID assigned during schema processing
- Use the schema's `$id` if present
- Use WeakMap with schema object as key (if schemas are stable objects)

---

### HIGH-2: Query parameter array handling is incorrect
**File**: `src/validator.ts:410-412`
**Severity**: 🟠 High - Logic error

```typescript
case "array":
  // Query params like ?tag=a&tag=b should be parsed as array
  return [value];  // BUG: Single value wrapped in array
```

**Problem**: For array-type parameters, a single value `?tags=foo` becomes `["foo"]`, but the validator should use `URLSearchParams.getAll()` to handle multiple values properly.

**Example**:
- Request: `?tags=a&tags=b&tags=c`
- Current: Only processes first value as `["a"]`
- Correct: Should process all values as `["a", "b", "c"]`

**Solution**: Modify validateQueryParams to use `params.getAll(spec.name)` for array-type parameters.

---

### HIGH-3: Using parseQueryValue for path parameters
**File**: `src/validator.ts:191`
**Severity**: 🟠 High - Wrong function for the job

```typescript
const validation = await this.validateValue(
  this.parseQueryValue(value, spec.schema),  // BUG: Wrong parser
  spec.schema as Schema,
  `path.${spec.name}`,
);
```

**Problem**: Path parameters and query parameters have different semantics:
- Query params: Can be arrays (multiple values with same name)
- Path params: Always single value, already a string

Using `parseQueryValue` for path parameters applies incorrect logic (especially for array type).

**Solution**: Create separate `parsePathParam()` function or use the same parser with a flag.

---

## Medium Priority Issues

### MED-1: Duplicate validation error handling logic
**File**: `src/validator.ts:134-145, 190-201, 230-241`
**Severity**: 🟡 Medium - Code quality

The same pattern appears 3 times:

```typescript
if (!validation.valid) {
  if (this.mode === "strict") {
    errors.push(...validation.errors);
  } else {
    warnings.push(...validation.errors);
  }
}
```

**Solution**: Extract to helper method:

```typescript
private addValidationResult(
  validation: ValidationResult,
  errors: ValidationError[],
  warnings: ValidationError[],
): void {
  if (!validation.valid) {
    if (this.mode === "strict") {
      errors.push(...validation.errors);
    } else {
      warnings.push(...validation.errors);
    }
  }
}
```

---

### MED-2: Empty request body not properly validated
**File**: `src/validator.ts:286-301`
**Severity**: 🟡 Medium - Poor error message

```typescript
try {
  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    parsedBody = JSON.parse(body);  // Throws on empty string
  }
} catch (error) {
  errors.push({
    path: "body",
    message: `Invalid ${mediaType} format: ${error.message}`,  // Confusing for empty body
  });
}
```

**Problem**: If `body === ""` and `requestBody.required === true`, the error says "Invalid JSON format: Unexpected end of JSON input" instead of "Required request body is missing".

**Solution**: Check for empty body before parsing:

```typescript
if (requestBody.required && body.trim() === "") {
  errors.push({
    path: "body",
    message: "Required request body is missing",
  });
  return { valid: false, errors, warnings };
}
```

---

### MED-3: Error information loss in response generation
**File**: `src/server.ts:420-424`
**Severity**: 🟡 Medium - Debugging difficulty

```typescript
try {
  body = await this.schemaProcessor.generateFromMediaType(mediaType);
} catch (_error) {  // BUG: Error is silenced
  throw missingExampleError(path, method, statusCode);
}
```

**Problem**: The actual error from `generateFromMediaType` is completely lost. If there's a bug in the generator, we have no way to know what went wrong.

**Solution**: Log the actual error before throwing the generic one:

```typescript
try {
  body = await this.schemaProcessor.generateFromMediaType(mediaType);
} catch (error) {
  console.error("Response generation failed:", error);
  throw missingExampleError(path, method, statusCode);
}
```

---

### MED-4: Response code selection could fail silently
**File**: `src/server.ts:337-339`
**Severity**: 🟡 Medium - Edge case

```typescript
const statusCode = operation.responses["200"]
  ? "200"
  : Object.keys(operation.responses)[0] || "200";
```

**Problem**: If `operation.responses` is `{}` (empty object), this returns `"200"` even though no 200 response is defined. Later code will fail when trying to access `operation.responses["200"]`.

**Solution**: Validate responses exist:

```typescript
if (!operation.responses || Object.keys(operation.responses).length === 0) {
  throw new MatchError("No responses defined", {
    httpPath: path,
    httpMethod: method.toUpperCase(),
    errorType: "match",
    reason: `Operation has no response definitions`,
    suggestion: "Add at least one response to the OpenAPI spec",
  });
}

const statusCode = operation.responses["200"] ? "200" : Object.keys(operation.responses)[0]!;
```

---

## Low Priority Issues

### LOW-1: Unused parameter in circularReferenceError
**File**: `src/errors.ts:25-29`
**Severity**: 🟢 Low - Code cleanliness

```typescript
export function circularReferenceError(
  _refPath: string,  // BUG: Never used
  cycle: string[],
  specFile?: string,
): ReferenceError {
```

**Solution**: Either use it or remove it:

```typescript
export function circularReferenceError(
  cycle: string[],
  specFile?: string,
): ReferenceError {
```

---

### LOW-2: Info disclosure in error messages
**File**: `src/server.ts:306-314`
**Severity**: 🟢 Low - Security consideration

```typescript
throw new MatchError("Path not found", {
  // ...
  suggestion: availablePaths.length > 0
    ? `Available paths: ${availablePaths.join(", ")}`  // Could expose sensitive paths
    : "No paths defined in the OpenAPI spec",
});
```

**Problem**: In production, listing all available paths could be an information disclosure vulnerability. For a mock server this is probably acceptable, but worth noting.

**Consideration**: Add a config flag to disable detailed error messages in production?

---

### LOW-3: Redundant error class wrappers
**File**: `src/errors.ts:1-22`
**Severity**: 🟢 Low - Code simplification

```typescript
export class ReferenceError extends SteadyError {
  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "reference" });
    this.name = "ReferenceError";
  }
}
// ... similar for GenerationError and MatchError
```

**Observation**: These classes just set `errorType` and `name`. Could be simplified to factory functions:

```typescript
export function referenceError(message: string, context: ErrorContext): SteadyError {
  return new SteadyError(message, { ...context, errorType: "reference" });
}
```

---

## Performance Considerations

### PERF-1: Schemas validated during request handling
**File**: `src/validator.ts:330-369`
**Severity**: 🟡 Medium - Performance

**Issue**: Although there's caching, the first request for each unique schema combination processes it fully (validate against metaschema, resolve refs, index). This adds latency to the first requests.

**Solution**: Pre-process all schemas during `server.init()`:
1. Extract all schemas from the OpenAPI spec (parameters, request bodies, responses)
2. Process them during initialization
3. Store validators in a map by schema reference

**Impact**: Eliminates first-request latency, predictable startup time

---

### PERF-2: JSON.stringify for cache keys
**File**: `src/validator.ts:330`
**Severity**: 🟡 Medium - Performance

**Issue**: Stringifying potentially large schemas on every validation call is expensive.

**Solution**: As mentioned in HIGH-1, use a better cache key strategy.

---

## Architecture Observations

### ARCH-1: No separate matcher module
**Observation**: All path matching logic is inline in `server.ts`. For current complexity this is fine, but could be extracted to `matcher.ts` for:
- Better testability
- Separation of concerns
- Reusability

**Not an issue**, just an observation for future growth.

---

### ARCH-2: RequestValidator creates its own JsonSchemaProcessor instances
**File**: `src/validator.ts:336`
**Observation**: Each validation creates a new `JsonSchemaProcessor` instance. This works but is inconsistent with the server's `ServerSchemaProcessor` approach.

**Suggestion**: Consider making RequestValidator use the same ServerSchemaProcessor instance for consistency and potential caching benefits.

---

## Summary

**Critical**: 2 bugs that must be fixed immediately
**High Priority**: 3 correctness issues
**Medium Priority**: 4 quality/UX issues
**Low Priority**: 3 minor issues
**Performance**: 2 optimization opportunities
**Architecture**: 2 observations for future consideration

**Total Issues**: 11 (excluding observations)

**Estimated Impact**:
- **Critical-1**: Silent validation bypass - schemas may be invalid
- **Critical-2**: Data corruption for special characters in URLs
- **High-1**: Potential cache misses or incorrect validation
- **High-2**: Multi-value query params broken
- **High-3**: Array-type path params validated incorrectly

**Recommendation**: Fix Critical and High priority issues before any production use. Medium and Low priority issues can be addressed iteratively.
