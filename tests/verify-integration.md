# Integration Verification Checklist

## ✅ Code Review Verification (No Deno Required)

### 1. Validator Integration
- [x] `src/validator.ts` imports from `../packages/json-schema/mod.ts`
- [x] `src/server.ts` imports from `./validator.ts` (not `validator_legacy.ts`)
- [x] `RequestValidator` constructor accepts `OpenAPISpec` and mode
- [x] `validateRequest` is async (required for JSON Schema processing)
- [x] Path parameters are extracted and passed to validator

### 2. Path Parameter Extraction
- [x] `findOperation` returns `pathPattern` and `pathParams`
- [x] `matchPath` method handles patterns like `/users/{id}`
- [x] `matchPath` extracts parameter values correctly
- [x] Parameters are validated against their schemas

### 3. Request Body Validation
- [x] `validateRequestBody` parses JSON content
- [x] Uses `JsonSchemaProcessor` to validate
- [x] Handles different content types
- [x] Returns proper validation errors

### 4. Type Safety
- [x] `handleRequest` is async
- [x] `validateRequest` signature matches usage
- [x] All imports resolve correctly
- [x] No type assertions used as shortcuts

## 🧪 Manual Testing Checklist (Requires Deno)

### Test 1: Load Massive Spec
```bash
deno run --allow-read cmd/steady.ts datadog-openapi.json
```
**Expected:** Server starts successfully, shows 323 endpoints

### Test 2: Path Parameter Matching
```bash
# Start server with test spec
deno run --allow-read --allow-net cmd/steady.ts tests/test-spec-with-body.yaml

# In another terminal:
curl http://localhost:3001/users/123
```
**Expected:** 200 response with user data

### Test 3: Path Parameter Validation
```bash
curl http://localhost:3001/users/not-a-number
```
**Expected:** 400 error - path parameter type validation failed

### Test 4: Request Body Validation - Valid
```bash
curl -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "email": "alice@example.com",
    "age": 30
  }'
```
**Expected:** 200 response

### Test 5: Request Body Validation - Missing Required Field
```bash
curl -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bob"
  }'
```
**Expected:** 400 error - missing required field "email"

### Test 6: Request Body Validation - Type Error
```bash
curl -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Charlie",
    "email": "not-an-email",
    "age": "not-a-number"
  }'
```
**Expected:** 400 error - invalid email format and age type

### Test 7: Nested Object Validation
```bash
curl -X POST http://localhost:3001/posts \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Post",
    "content": "Post content here",
    "author": {
      "id": 1,
      "name": "Alice",
      "email": "alice@example.com"
    },
    "tags": ["tech", "programming"]
  }'
```
**Expected:** 200 response

### Test 8: Multiple Path Parameters
```bash
curl http://localhost:3001/products/electronics/AB123456
```
**Expected:** 200 response

### Test 9: Pattern Validation in Path
```bash
curl http://localhost:3001/products/electronics/invalid-format
```
**Expected:** 400 error - path parameter doesn't match pattern

### Test 10: Large Datadog Spec
```bash
deno run --allow-read --allow-net cmd/steady.ts datadog-openapi.json

# Test a parameterized endpoint
curl http://localhost:3000/api/v1/dashboard/my-dashboard-id
```
**Expected:** 200 or 404 (depending on mock behavior)

## 📊 Performance Benchmarks

### Spec Loading
```bash
time deno run --allow-read cmd/steady.ts validate datadog-openapi.json
```
**Target:** < 5 seconds for 8.4MB spec

### Request Processing
```bash
# Use Apache Bench or similar
ab -n 1000 -c 10 http://localhost:3001/users/123
```
**Target:** < 10ms average response time

## 🔍 Code Quality Checks

### Linting
```bash
cd /home/user/steady
deno lint
```
**Expected:** No errors

### Type Checking
```bash
deno check cmd/steady.ts
deno check src/validator.ts
deno check src/server.ts
```
**Expected:** No type errors

### Formatting
```bash
deno fmt --check
```
**Expected:** All files properly formatted

## 🎯 Integration Points Verified

1. **Parser → Validator**: OpenAPI spec types flow correctly
2. **Validator → JSON Schema**: Schema validation uses processor
3. **Server → Validator**: Request validation integrated
4. **Server → Path Matching**: Path parameters extracted and validated
5. **Validator → Error Attribution**: Errors include SDK vs spec attribution

## 📝 Files Created/Modified

### New Files
- `src/validator.ts` - Enterprise validator with JSON Schema integration
- `tests/integration-test.ts` - Comprehensive integration tests
- `tests/test-spec-with-body.yaml` - Test spec for body validation
- `tests/verify-integration.md` - This verification checklist

### Modified Files
- `src/server.ts` - Added path matching, async validation

### Files to Remove
- `src/validator_legacy.ts` - No longer needed

## ✅ Success Criteria

- [ ] All code review checks pass
- [ ] Server starts with massive spec (datadog-openapi.json)
- [ ] Path parameters are extracted and validated
- [ ] Request bodies are validated against schemas
- [ ] Type errors are caught and reported
- [ ] Error messages include proper attribution
- [ ] Performance meets targets (< 10ms per request)
- [ ] No TypeScript errors
- [ ] No linting errors

## 🚀 Ready for Production When

1. All integration tests pass
2. Performance benchmarks met
3. Error attribution working correctly
4. No memory leaks with massive specs
5. Documentation updated
