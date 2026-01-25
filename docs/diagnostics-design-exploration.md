# Steady Diagnostics System Design

## Purpose

Steady validates SDKs against OpenAPI specs. The diagnostics system must answer
one core question with confidence:

> **"Can this SDK be trusted to correctly transport requests to the API?"**

---

## The SDK's Role: Transport, Not Validation

An SDK is a **transport layer**. Its job is to:

1. Accept data from the developer using the SDK
2. Package it correctly (HTTP method, path, headers, JSON structure)
3. Send it to the server

The SDK is **not** responsible for validating the _content_ of user-provided
data. That's the server's job.

### What the SDK IS responsible for (structural correctness):

| Responsibility            | Example                                               |
| ------------------------- | ----------------------------------------------------- |
| Correct HTTP method       | POST for create, GET for read                         |
| Correct path construction | `/users/{id}` → `/users/123`                          |
| Required fields present   | If spec says `required: [email]`, SDK must include it |
| Correct data types        | Send integer when spec says `type: integer`           |
| Correct structure         | Nested objects match schema shape                     |
| Required headers          | Authorization, Content-Type, etc.                     |

### What the SDK is NOT responsible for (content validation):

| Server's Job                         | Why Not SDK's Job                       |
| ------------------------------------ | --------------------------------------- |
| Format validation (email, uri, uuid) | SDK passes user's string through        |
| Pattern matching (regex)             | User provides content, server validates |
| String length (minLength, maxLength) | User provides content                   |
| Numeric ranges (minimum, maximum)    | User provides the number                |
| Business rules                       | Server-side logic                       |

### Example

```python
# User code
sdk.create_user(email="not-a-valid-email")
```

The SDK should:

- [OK] Send POST to /users
- [OK] Include `{"email": "not-a-valid-email"}` in body
- [OK] Set Content-Type: application/json

The SDK should NOT:

- [x] Validate that the email matches a regex
- [x] Reject the request before sending

If the server returns 400 because the email is invalid, that's between the
**user and the server**. The SDK did its job correctly.

### Implication for Steady

When Steady validates requests, it must distinguish:

- **Structural issues** → SDK bugs (SDK failed to package correctly)
- **Content issues** → Pass-through (SDK correctly sent what user provided)

A content validation failure (pattern, format, etc.) is **not an SDK bug**
unless the SDK is supposed to generate that content itself.

---

## User Personas

### 1. SDK End User (Primary Customer)

**Who:** Developer choosing/using an SDK for an API

**Need:** Confidence that the SDK correctly implements the API specification

**Key question:** "Will this SDK work correctly in production?"

### 2. SDK Developer

**Who:** Engineer building/maintaining an SDK

**Need:** Know what to fix when validation fails

**Key question:** "What's wrong with my SDK and how do I fix it?"

### 3. API Spec Author

**Who:** Engineer writing/maintaining the OpenAPI specification

**Need:** Validate the spec is correct and usable

**Key question:** "Is my spec accurate and well-formed?"

### 4. CI/CD Pipeline

**Who:** Automated system running validation

**Need:** Pass/fail status with actionable output

**Key question:** "Should this build pass or fail?"

---

## Design Philosophy: Compiler-Quality Diagnostics

The goal is to make debugging **effortless**. When something fails, the
developer should immediately understand:

- **What** went wrong
- **Where** exactly (visual, not just text)
- **Why** it's wrong (expected vs actual)
- **How** to fix it (actual code/spec changes, not vague advice)

Inspired by Rust, Elm, and Unison compilers — errors are not obstacles, they're
helpful guides.

### Output Contexts

Steady diagnostics appear in three contexts, each with different needs:

| Context           | Characteristics    | Design Goals                        |
| ----------------- | ------------------ | ----------------------------------- |
| **CLI**           | Human at terminal  | Colors, visual markers, full detail |
| **CI logs**       | Noisy, scannable   | Stand out, be grep-able, actionable |
| **HTTP response** | SDK test framework | Headers for programmatic access     |

### CI Log Output

In CI, logs are noisy. Steady output needs to:

- Stand out visually (clear delimiters)
- Be grep-able (consistent prefixes)
- Show actionable summary first, details after

```
══════════════════════════════════════════════════════════════════════════════
STEADY VALIDATION FAILED — 2 SDK issues found
══════════════════════════════════════════════════════════════════════════════

SUMMARY
  Requests:  500 total, 450 passed, 50 failed (90%)
  Exit code: 1 (SDK has issues)

SDK ISSUES (must fix):

  [FAIL] GET /users/{id} — 30 occurrences
         Path param 'id': expected integer, got string
         Example: /users/abc123
                          ↑

  [FAIL] POST /users — 20 occurrences
         Body: missing required field 'email'
         Example: {"name": "Alice"} ← needs "email"

SUGGESTED FIXES:

  1. Convert user_id to integer before URL construction
  2. Include 'email' field in POST /users request body

FULL REPORT: /tmp/steady-report-2024-01-15-143200.json

══════════════════════════════════════════════════════════════════════════════
```

For CI systems that support annotations (GitHub Actions, GitLab CI):

```
::error file=sdk/users.py,line=42::Steady: Path param 'id' must be integer, got string "abc123"
::error file=sdk/users.py,line=87::Steady: POST /users missing required field 'email'
```

### HTTP Response Headers for SDK Tests

When validation fails, Steady returns diagnostic info in response headers. This
allows SDK test frameworks to programmatically access and display errors.

**Response headers:**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json
X-Steady-Mode: strict

# Validation result
X-Steady-Valid: false
X-Steady-Result: failed
X-Steady-Error-Count: 2

# Primary error (most important, for quick display)
X-Steady-Error-1-Path: path.id
X-Steady-Error-1-Message: expected integer, got string "abc123"
X-Steady-Error-1-Fix: Convert id to integer before building URL

X-Steady-Error-2-Path: body.email
X-Steady-Error-2-Message: missing required field
X-Steady-Error-2-Fix: Include 'email' in request body

# Full diagnostics as base64-encoded JSON (for rich display)
X-Steady-Diagnostics: eyJlcnJvcnMiOlt7Li4ufV19

# Link to spec location (for IDEs that support it)
X-Steady-Spec-Link: file:///path/to/spec.yaml#/paths/~1users~1{id}/get
```

**Response body (also contains errors for easy access):**

```json
{
  "error": "Validation failed",
  "steady": {
    "valid": false,
    "errors": [
      {
        "path": "path.id",
        "message": "expected integer, got string \"abc123\"",
        "fix": "Convert id to integer before building URL",
        "spec_pointer": "#/paths/~1users~1{id}/get/parameters/0/schema"
      }
    ]
  }
}
```

**SDK test framework integration example (pytest):**

```python
def test_get_user():
    response = sdk.get_user(id="abc123")  # Bug: string instead of int

    # Test framework reads Steady headers
    # Output:
    #
    # FAILED test_get_user
    #
    # Steady SDK Validation Error:
    # ────────────────────────────
    #
    #   GET /users/{id}
    #
    #   Path:
    #     /users/abc123
    #            ↑
    #            expected integer, got string "abc123"
    #
    #   Fix: Convert id to integer before building URL
    #
    #        - sdk.get_user(id="abc123")
    #        + sdk.get_user(id=123)
    #
    #   Spec: #/paths/~1users~1{id}/get/parameters/0/schema
```

**SDK test framework integration example (Jest/TypeScript):**

```typescript
test("get user", async () => {
  const response = await sdk.getUser({ id: "abc123" }); // Bug

  // Jest reporter reads Steady headers
  // Output:
  //
  // [X] get user (45ms)
  //
  //   Steady SDK Validation Error:
  //
  //     GET /users/{id}
  //     Path param 'id': expected integer, got string "abc123"
  //
  //     Fix: sdk.getUser({ id: Number(userId) })
});
```

---

## Error Display Format

### Path Parameter Errors

**Single parameter error** — no markers needed:

```
PUT /users/{id}

Path:
  /users/abc123
         ↑
         expected integer, got string "abc123"

Fix (SDK): Convert id to integer before building URL
  - url = f"/users/{user_id}"
  + url = f"/users/{int(user_id)}"
```

**Multiple parameter errors** — use markers to show each:

```
PUT /items/{id}/{status}

Path:
  /items/my-item/completed
         ↑        ↑
         │        └─ "completed" not in enum
         │           expected: active | inactive | pending
         │
         └─ "my-item" is not an integer
            expected: integer

Fix (SDK): Ensure id is integer and status is valid enum value
```

### Body Errors

Show the actual field path and value, then the error below it:

**Simple field error:**

```
POST /users

Body:
  email: 12345
  └─ expected string, got integer

Fix (SDK): Ensure email is passed as string
  - {"email": user.email}
  + {"email": str(user.email)}
```

**Nested field errors:**

```
PUT /orders/{id}

Body:
  shipping.address.zip: null
  └─ expected string, got null

  items[0].quantity: "five"
  └─ expected integer, got string "five"

  items[2].sku: <missing>
  └─ required field missing

Fix (SDK):
  - Ensure shipping.address.zip is a string, not null
  - Convert quantity to integer: int(item["quantity"])
  - Include required field 'sku' in all items
```

**Missing required field:**

```
POST /users

Body:
  {
    "name": "Alice"
  }
  └─ missing required field: email

Fix (SDK): Include 'email' in request body
  {
    "name": "Alice",
  + "email": "<user's email>"
  }
```

### Spec Fix Examples

When the issue might be in the spec, show the actual diff:

**Make field nullable (OpenAPI 3.1):**

```
Possible fix (Spec): Allow null for 'quantity'

  # components/schemas/Item/properties/quantity
  quantity:
  - type: integer
  + type:
  +   - integer
  +   - "null"
    description: Number of items
```

**Make field nullable (OpenAPI 3.0):**

```
Possible fix (Spec): Allow null for 'quantity'

  # components/schemas/Item/properties/quantity
  quantity:
    type: integer
  + nullable: true
    description: Number of items
```

**Add missing enum value:**

```
Possible fix (Spec): Add 'completed' to status enum

  # components/schemas/Order/properties/status
  status:
    type: string
    enum:
      - pending
      - processing
  +   - completed
      - failed
```

**Fix overly restrictive pattern:**

```
Possible fix (Spec): Use standard email format instead of restrictive pattern

  # components/schemas/User/properties/email
  email:
    type: string
  - pattern: "^[a-z]+@[a-z]+\\.[a-z]+$"
  + format: email
```

---

## Scenario Walkthroughs

### Scenario 1: Perfect SDK (Happy Path)

**Setup:**

- SDK test suite runs 500 requests across 30 endpoints
- All requests match the spec perfectly

**Expected Output:**

```
════════════════════════════════════════════════════════════════════
                      SDK VALIDATION REPORT
════════════════════════════════════════════════════════════════════

Spec:     Acme API v1.4.0
Server:   Steady v0.13.1
Date:     2024-01-15T14:32:00Z
Duration: 12.3s

────────────────────────────────────────────────────────────────────
RESULT: PASSED [OK]
────────────────────────────────────────────────────────────────────

Requests:    500 total, 500 valid (100%)
Endpoints:   30/30 covered

No issues detected.
════════════════════════════════════════════════════════════════════
```

**JSON Output:**

```json
{
  "result": "passed",
  "spec": { "title": "Acme API", "version": "1.4.0" },
  "session": {
    "duration_ms": 12300,
    "requests": { "total": 500, "valid": 500, "invalid": 0 },
    "endpoints": { "total": 30, "covered": 30, "fully_valid": 30 }
  },
  "issues": { "sdk": [], "spec": [], "ambiguous": [] }
}
```

**Exit code:** 0

---

### Scenario 2: SDK With Clear Bugs

**Setup:**

- SDK has a bug: sends `user_id` as string instead of integer
- SDK has a bug: omits required `email` field on user creation
- 50 requests fail out of 500

**Expected Output (CLI):**

```
════════════════════════════════════════════════════════════════════
                      SDK VALIDATION REPORT
════════════════════════════════════════════════════════════════════

Spec:     Acme API v1.4.0
Server:   Steady v0.13.1
Date:     2024-01-15T14:32:00Z
Duration: 12.3s

────────────────────────────────────────────────────────────────────
RESULT: FAILED [X]
────────────────────────────────────────────────────────────────────

Requests:    500 total, 450 valid (90%)
Endpoints:   30/30 covered, 28/30 fully valid

────────────────────────────────────────────────────────────────────
SDK ISSUES — 2 types, 50 occurrences
────────────────────────────────────────────────────────────────────

[1/2] GET /users/{id} — 30 requests failed
──────────────────────────────────────────

Path:
  /users/abc123
         ↑
         expected integer, got string "abc123"

Fix (SDK): Convert id to integer before building URL

  # Example fix in Python:
  - url = f"/users/{user_id}"
  + url = f"/users/{int(user_id)}"

  # Example fix in TypeScript:
  - const url = `/users/${userId}`;
  + const url = `/users/${Number(userId)}`;

  ╭─ Spec reference (components/schemas not shown for brevity)
  │  #/paths/~1users~1{id}/get/parameters/0
  │
  │  parameters:
  │    - name: id
  │      in: path
  │      required: true
  │      schema:
  │        type: integer    <--─ SDK sent string
  ╰─


[2/2] POST /users — 20 requests failed
──────────────────────────────────────

Body:
  {
    "name": "Alice"
  }
  └─ missing required field: email

Fix (SDK): Include 'email' in request body

  {
    "name": "Alice",
  + "email": "<user's email>"
  }

  ╭─ Spec reference
  │  #/paths/~1users/post/requestBody/content/application~1json/schema
  │
  │  type: object
  │  required:
  │    - name
  │    - email    <--─ SDK omitted this
  │  properties:
  │    name: { type: string }
  │    email: { type: string, format: email }
  ╰─

════════════════════════════════════════════════════════════════════
```

**Why these are SDK issues (high confidence):**

- Spec clearly says `id` is `type: integer` — SDK sent string
- Spec clearly says `email` is required — SDK omitted it
- No ambiguity: SDK is not following the spec

**Exit code:** 1

---

### Scenario 3: Content Validation Fails (Not SDK's Problem)

**Setup:**

- Spec says email must match pattern `^[a-z]+@[a-z]+\.[a-z]+$`
- User provides `alice.smith@example.co.uk` to SDK
- SDK correctly sends `{"email": "alice.smith@example.co.uk"}`
- Pattern validation fails

**Analysis:**

This is NOT an SDK issue because:

- SDK's job: Send a string in the email field [OK]
- SDK did exactly that [OK]
- Whether the string matches a pattern is between the user and server

**Expected Output:**

```
════════════════════════════════════════════════════════════════════
                      SDK VALIDATION REPORT
════════════════════════════════════════════════════════════════════

Spec:     Acme API v1.4.0
Server:   Steady v0.13.1
Date:     2024-01-15T14:32:00Z
Duration: 12.3s

────────────────────────────────────────────────────────────────────
RESULT: PASSED [OK]
────────────────────────────────────────────────────────────────────

Requests:    500 total, 500 valid (100%)
Endpoints:   30/30 covered

No SDK issues detected.

────────────────────────────────────────────────────────────────────
SERVER VALIDATION NOTES (15 requests)
────────────────────────────────────────────────────────────────────

The following requests are structurally correct but may be rejected
by a server that enforces content validation:

  POST /users — 15 requests
    Field 'email' doesn't match pattern: ^[a-z]+@[a-z]+\.[a-z]+$
    Values: alice.smith@example.co.uk, bob+test@company.io, ...

    Note: This is not an SDK issue. The SDK correctly sent the
    user-provided value. Pattern validation is the server's job.

════════════════════════════════════════════════════════════════════
```

**Key insight:** The SDK passed validation. The "server validation notes" are
purely informational — they tell the user "these requests might fail against a
strict server" but they don't reflect on SDK quality.

**Exit code:** 0 (SDK is correct)

---

### Scenario 4: Ambiguous Case — Null Handling

**Setup:**

- Spec says `quantity: { type: integer }`
- Spec does NOT say it's nullable
- SDK sends `{"quantity": null}`
- Is this an SDK bug, spec omission, or user error?

**Expected Output (CLI):**

```
════════════════════════════════════════════════════════════════════
                      SDK VALIDATION REPORT
════════════════════════════════════════════════════════════════════

Spec:     Acme API v1.4.0 (OpenAPI 3.1)
Server:   Steady v0.13.1
Date:     2024-01-15T14:32:00Z
Duration: 12.3s

────────────────────────────────────────────────────────────────────
RESULT: REVIEW REQUIRED [!]
────────────────────────────────────────────────────────────────────

Requests:    500 total, 495 valid (99%)
Endpoints:   30/30 covered

────────────────────────────────────────────────────────────────────
AMBIGUOUS — 1 type, 5 occurrences
────────────────────────────────────────────────────────────────────

[1/1] PUT /items/{id} — 5 requests need review
──────────────────────────────────────────────

Body:
  quantity: null
  └─ expected integer, got null

  ╭─ Spec reference
  │  #/components/schemas/Item/properties/quantity
  │
  │  quantity:
  │    type: integer    <--─ Spec doesn't say it's nullable
  │    description: Number of items to order
  ╰─

This could be:

  ┌─ Option A: Spec is wrong ─────────────────────────────────────┐
  │                                                               │
  │  If the real API accepts null, the spec should say so.        │
  │                                                               │
  │  Fix: Update spec to allow null                               │
  │                                                               │
  │    quantity:                                                  │
  │  -   type: integer                                            │
  │  +   type:                                                    │
  │  +     - integer                                              │
  │  +     - "null"                                               │
  │      description: Number of items to order                    │
  │                                                               │
  └───────────────────────────────────────────────────────────────┘

  ┌─ Option B: SDK design choice ─────────────────────────────────┐
  │                                                               │
  │  SDK could transform null before sending:                     │
  │    • null → omit the field entirely                           │
  │    • null → send 0                                            │
  │    • null → raise error before request                        │
  │                                                               │
  │  Example (omit null fields):                                  │
  │                                                               │
  │    body = {k: v for k, v in data.items() if v is not None}    │
  │                                                               │
  └───────────────────────────────────────────────────────────────┘

  ┌─ Option C: User error ────────────────────────────────────────┐
  │                                                               │
  │  User is passing null when they should pass a number or       │
  │  not include the field.                                       │
  │                                                               │
  │  Fix: User should check their input data                      │
  │                                                               │
  └───────────────────────────────────────────────────────────────┘

  --> How to resolve: Test against the real API
     - If API accepts null → Fix the spec (Option A)
     - If API rejects null → SDK or user should handle it (B or C)

════════════════════════════════════════════════════════════════════
```

**Why this is ambiguous:**

- Spec doesn't say it's nullable, so technically null is invalid
- But spec also doesn't explicitly forbid null
- Real API behavior is the source of truth
- Need to test against real API to determine correct fix

**Exit code:** 2 (special code for "needs review")

---

### Scenario 5: Mixed Issues

**Setup:**

- SDK has 2 clear bugs (wrong types, missing required field)
- 1 ambiguous case (null handling)
- Some requests have content that doesn't match patterns (not SDK's problem)

**Expected Output:**

```
════════════════════════════════════════════════════════════════════
                      SDK VALIDATION REPORT
════════════════════════════════════════════════════════════════════

Spec:     Acme API v1.4.0
Server:   Steady v0.13.1
Date:     2024-01-15T14:32:00Z
Duration: 12.3s

────────────────────────────────────────────────────────────────────
RESULT: FAILED [X]
────────────────────────────────────────────────────────────────────

Requests:    500 total, 450 structurally valid (90%)
Endpoints:   30/30 covered, 27/30 fully valid

Summary:
  SDK issues:      2 distinct (45 occurrences) — must fix
  Ambiguous:       1 distinct (5 occurrences)  — needs review

────────────────────────────────────────────────────────────────────
SDK ISSUES (2 distinct, 45 occurrences)
────────────────────────────────────────────────────────────────────

These must be fixed in the SDK:

1. GET /users/{id} — 30 failures
   [X] Path parameter 'id' has wrong type

   Request:  path.id
   Spec:     #/paths/~1users~1{id}/get/parameters/0/schema

   Expected: integer
   Received: string (e.g., "123")
   Fix: SDK must convert id to integer when constructing URL

2. POST /orders — 15 failures
   [X] Missing required field 'product_id'

   Request:  body
   Spec:     #/paths/~1orders/post/requestBody/content/application~1json/schema

   Expected: object with required property 'product_id'
   Received: {"quantity": 5}
   Fix: SDK must include product_id in request body

────────────────────────────────────────────────────────────────────
AMBIGUOUS (1 distinct, 5 occurrences)
────────────────────────────────────────────────────────────────────

These require human judgment — could be SDK, spec, or user:

1. PUT /items/{id} — 5 requests affected
   ? Field 'quantity' received null but spec expects integer

   Possible interpretations:
   • Spec is wrong → Real API accepts null, spec should say nullable: true
   • SDK design choice → SDK could omit null fields or convert to default
   • User error → User shouldn't send null for this field

────────────────────────────────────────────────────────────────────
SERVER VALIDATION NOTES (15 requests)
────────────────────────────────────────────────────────────────────

These requests are structurally correct but may fail server-side
content validation. This is NOT an SDK issue:

  POST /users — 15 requests
    Field 'email' doesn't match pattern
    (SDK correctly sent user-provided value)

════════════════════════════════════════════════════════════════════
```

**Exit code:** 1 (SDK has structural issues that must be fixed)

---

### Scenario 6: Spec Issues at Startup (Static Analysis)

**Setup:**

- Spec has circular reference: User → manager → User
- Spec has unresolved $ref: `$ref: '#/components/schemas/Missing'`
- These are found before any requests are made

**Expected Startup Output:**

```
════════════════════════════════════════════════════════════════════
                        SPEC DIAGNOSTICS
════════════════════════════════════════════════════════════════════

Spec:   Acme API v1.4.0
Server: Steady v0.13.1

────────────────────────────────────────────────────────────────────
ERRORS (1)
────────────────────────────────────────────────────────────────────

1. Unresolved reference
   Location: #/paths/~1legacy/get/responses/200/content/application~1json/schema
   Reference: #/components/schemas/Missing

   This schema does not exist. Requests to GET /legacy will fail.
   Fix: Add the missing schema or correct the $ref path.

────────────────────────────────────────────────────────────────────
WARNINGS (1)
────────────────────────────────────────────────────────────────────

1. Circular reference detected
   Chain: #/components/schemas/User
        → properties/manager
        → #/components/schemas/User

   This may cause infinite loops in code generators or validators.
   Steady handles this correctly, but SDK generators may not.
   Consider: Use $ref with maxDepth or break the cycle.

────────────────────────────────────────────────────────────────────

Loaded: 29/30 endpoints (1 endpoint has errors)
Ready to accept requests on http://localhost:3000

════════════════════════════════════════════════════════════════════
```

**Key point:** These are always spec issues, found before any SDK runs.

---

### Scenario 7: Tricky — SDK Sends Extra Fields

**Setup:**

- Spec defines User with `name` and `email`
- Spec does NOT set `additionalProperties: false`
- SDK sends `{"name": "Alice", "email": "a@b.com", "phone": "555-1234"}`

**Analysis:**

| Spec says                     | Interpretation                     |
| ----------------------------- | ---------------------------------- |
| `additionalProperties: false` | Extra fields forbidden → SDK issue |
| `additionalProperties: true`  | Extra fields allowed → Valid       |
| (nothing, OpenAPI default)    | Defaults to true → Valid           |

**Expected behavior:**

- If spec explicitly forbids: SDK issue
- If spec allows or is silent: Valid (SDK passes)

**Output when spec forbids:**

```
1. POST /users — 10 failures
   [X] Additional property 'phone' is not allowed
     Spec explicitly sets additionalProperties: false
     Fix: Remove 'phone' field from request, or update spec to allow it
```

**Output when spec allows/silent:** No issue reported. Request is valid.

---

### Scenario 8: Tricky — Unknown Query Parameter

**Setup:**

- Spec defines `GET /users?limit=10&offset=0`
- SDK sends `GET /users?limit=10&offset=0&debug=true`
- Is `debug` parameter allowed?

**Analysis:**

- OpenAPI doesn't have "additionalParameters" concept
- Unknown query params are generally ignored by servers
- But could indicate SDK bug (typo, wrong endpoint)

**Decision:** This should be a **warning**, not an error.

**Output:**

```
────────────────────────────────────────────────────────────────────
WARNINGS (1 distinct, 25 occurrences)
────────────────────────────────────────────────────────────────────

1. GET /users — 25 requests
   [!] Unknown query parameter 'debug'
     This parameter is not defined in the spec.

     If intentional: Parameter will be ignored by the server
     If unintentional: Check for typos or wrong endpoint

     Note: This does not fail validation but may indicate an issue.
```

**Exit code:** 0 (warnings don't fail the SDK)

---

### Scenario 9: Tricky — Type Coercion Edge Cases

**Setup:**

- Spec says `age: { type: integer, minimum: 0 }`
- SDK sends various values

**Analysis — separating structural from content:**

| SDK sends | Issue Type        | SDK's Fault? | Reasoning                |
| --------- | ----------------- | ------------ | ------------------------ |
| `25`      | None              | N/A          | Exact match              |
| `"25"`    | Type (structural) | **Yes**      | String, not integer      |
| `25.0`    | None              | N/A          | JSON serializes as `25`  |
| `25.5`    | Type (structural) | **Yes**      | Float, not integer       |
| `-5`      | Range (content)   | **No**       | User provided the number |

**Key distinction:**

- `type: integer` → Structural. SDK must send correct type.
- `minimum: 0` → Content validation. User provides value, server validates.

**Output for type issues (SDK's fault):**

```
────────────────────────────────────────────────────────────────────
SDK ISSUES (1 distinct, 8 occurrences)
────────────────────────────────────────────────────────────────────

1. POST /users — 8 failures
   [X] Field 'age' has wrong type

   Request:  body.age
   Spec:     #/paths/~1users/post/requestBody/.../properties/age

   Expected: integer
   Received: string "25"
   Fix: Send age as number, not string: {"age": 25}
```

**Output for range issues (NOT SDK's fault):**

```
────────────────────────────────────────────────────────────────────
RESULT: PASSED [OK]
────────────────────────────────────────────────────────────────────

No SDK issues detected.

────────────────────────────────────────────────────────────────────
SERVER VALIDATION NOTES (3 requests)
────────────────────────────────────────────────────────────────────

  POST /users — 3 requests
    Field 'age' is below minimum (0)

    Request:  body.age
    Spec:     #/paths/~1users/post/requestBody/.../properties/age

    Values: -5, -1, -10

    Note: SDK correctly sent user-provided integers. Range
    validation is the server's responsibility.
```

---

### Scenario 10: Tricky — Required Field in Optional Object

**Setup:**

```yaml
User:
  type: object
  properties:
    name: { type: string }
    address: # Not required
      type: object
      required: [street, city] # But if present, these are required
      properties:
        street: { type: string }
        city: { type: string }
```

- SDK sends `{"name": "Alice"}` — Valid (address is optional)
- SDK sends `{"name": "Alice", "address": {}}` — Invalid (address present but
  incomplete)
- SDK sends `{"name": "Alice", "address": {"street": "123 Main"}}` — Invalid
  (missing city)

**Output:**

```
1. POST /users — 5 failures
   [X] Missing required field 'city' in 'address'
     When 'address' is provided, 'city' is required.
     Received: {"street": "123 Main"}
     Fix: Include 'city' field, or omit 'address' entirely
```

---

### Scenario 11: Tricky — Discriminator / oneOf Validation

**Setup:**

```yaml
Pet:
  oneOf:
    - $ref: "#/components/schemas/Cat"
    - $ref: "#/components/schemas/Dog"
  discriminator:
    propertyName: petType
Cat:
  properties:
    petType: { const: "cat" }
    meowVolume: { type: integer }
Dog:
  properties:
    petType: { const: "dog" }
    barkVolume: { type: integer }
```

- SDK sends `{"petType": "cat", "barkVolume": 10}` — Invalid (cat doesn't bark)
- SDK sends `{"petType": "fish", "bubbles": true}` — Invalid (unknown pet type)

**Output:**

```
1. POST /pets — 3 failures
   [X] Invalid oneOf: data matches Cat (by discriminator) but has invalid properties
     Discriminator 'petType' = "cat" selects Cat schema
     But 'barkVolume' is not a valid Cat property
     Fix: Use 'meowVolume' for cats, or change petType to "dog"

2. POST /pets — 2 failures
   [X] Invalid discriminator value
     Field 'petType' must be one of: cat, dog
     Received: "fish"
     Fix: Use a valid pet type, or add Fish to the spec
```

---

### Scenario 12: Tricky — Date/Time Format Edge Cases

**Setup:**

- Spec says `created_at: { type: string, format: date-time }`
- User provides various date strings to SDK

**Key question:** Is `format: date-time` validation the SDK's job?

**Answer:** It depends on who provides the value.

| Who Provides  | SDK's Job? | Example                                     |
| ------------- | ---------- | ------------------------------------------- |
| User          | No         | `sdk.create_event(created_at="01/15/2024")` |
| SDK generates | Yes        | `created_at` auto-set to current time       |

**Scenario A: User provides timestamp**

```python
sdk.create_event(created_at="01/15/2024")  # User's date string
```

SDK sends: `{"created_at": "01/15/2024"}`

**Output:**

```
────────────────────────────────────────────────────────────────────
RESULT: PASSED [OK]
────────────────────────────────────────────────────────────────────

No SDK issues detected.

────────────────────────────────────────────────────────────────────
SERVER VALIDATION NOTES (5 requests)
────────────────────────────────────────────────────────────────────

  POST /events — 5 requests
    Field 'created_at' doesn't match format: date-time
    Values: "01/15/2024", "2024-01-15 10:30:00", ...

    Note: SDK correctly sent user-provided strings. Format
    validation is the server's responsibility.
```

**Scenario B: SDK auto-generates timestamp**

If SDK documentation says "created_at is automatically set", then the SDK is
responsible for generating a valid date-time:

```
────────────────────────────────────────────────────────────────────
RESULT: FAILED [X]
────────────────────────────────────────────────────────────────────

SDK ISSUES (1 distinct, 5 occurrences)
────────────────────────────────────────────────────────────────────

1. POST /events — 5 failures
   [X] SDK-generated 'created_at' has invalid format
     Expected: RFC 3339 date-time (e.g., 2024-01-15T10:30:00Z)
     Generated: "01/15/2024 10:30 AM"
     Fix: SDK's timestamp generation must use ISO 8601 format
```

**How does Steady know?** It can't automatically distinguish user-provided from
SDK-generated. Options:

1. Assume all content is user-provided (conservative)
2. Allow SDK tests to mark SDK-generated fields
3. Use heuristics (same value every request = probably SDK-generated)

---

### Scenario 13: High Volume — Many Failures

**Setup:**

- 10,000 requests
- 500 failures across 15 different issue types
- Need readable output without overwhelming detail

**Expected Output:**

```
════════════════════════════════════════════════════════════════════
                      SDK VALIDATION REPORT
════════════════════════════════════════════════════════════════════

Spec:     Acme API v1.4.0
Server:   Steady v0.13.1
Date:     2024-01-15T14:32:00Z
Duration: 2m 34s

────────────────────────────────────────────────────────────────────
RESULT: FAILED [X]
────────────────────────────────────────────────────────────────────

Requests:    10,000 total, 9,500 valid (95%)
Endpoints:   50/50 covered, 42/50 fully valid

Summary:
  SDK issues:      12 distinct (450 occurrences)
  Spec issues:      2 distinct (30 occurrences)
  Ambiguous:        1 distinct (20 occurrences)

────────────────────────────────────────────────────────────────────
TOP SDK ISSUES (showing 5 of 12)
────────────────────────────────────────────────────────────────────

1. GET /users/{id} — 150 failures
   [X] Path parameter 'id' has wrong type

2. POST /orders — 100 failures
   [X] Missing required field 'product_id'

3. PUT /items/{id} — 80 failures
   [X] Field 'price' must be >= 0

4. POST /users — 50 failures
   [X] Invalid email format

5. DELETE /sessions/{id} — 40 failures
   [X] Missing required header 'Authorization'

... and 7 more (run with --verbose for full list)

────────────────────────────────────────────────────────────────────
SPEC ISSUES (2 distinct, 30 occurrences)
────────────────────────────────────────────────────────────────────

1. POST /users — 25 requests affected
   [!] Pattern for 'email' is overly restrictive

2. GET /search — 5 requests affected
   [!] Query param 'q' should allow empty string

════════════════════════════════════════════════════════════════════

Full report: steady-report-2024-01-15T14-32-00.json
```

**Key design decisions:**

- Show top N issues by frequency (not all issues)
- Group by issue type, not by individual request
- Offer `--verbose` for full details
- Write full report to JSON file

---

### Scenario 14: Strict Mode vs Relaxed Mode

**Setup:**

- Server can run in `strict` or `relaxed` mode
- Strict: SDK issue causes request rejection (400)
- Relaxed: SDK issue logged but response returned (200)

**Use case for relaxed:**

- Early SDK development (want to see responses even with bugs)
- Exploring API behavior
- Debugging specific issues

**Use case for strict:**

- CI validation (must be correct)
- Production readiness testing
- Certification

**Report should indicate mode:**

```
════════════════════════════════════════════════════════════════════
                      SDK VALIDATION REPORT
════════════════════════════════════════════════════════════════════

Mode:     RELAXED (issues logged but not rejected)
...

Note: 45 requests would have been rejected in strict mode.
      Run with --mode=strict for certification testing.
```

---

### Scenario 15: Endpoint Coverage Analysis

**Setup:**

- Spec defines 50 endpoints
- SDK test suite only tests 30 endpoints
- User wants to know coverage

**Expected Output (at end of report):**

```
────────────────────────────────────────────────────────────────────
ENDPOINT COVERAGE
────────────────────────────────────────────────────────────────────

Tested:     30/50 endpoints (60%)
Untested:   20 endpoints

Untested endpoints:
  GET    /admin/users
  POST   /admin/users
  DELETE /admin/users/{id}
  GET    /reports/daily
  GET    /reports/weekly
  ... and 15 more

Recommendation: Increase test coverage for full validation confidence.
```

---

## Exit Codes

| Code | Meaning | When                                         |
| ---- | ------- | -------------------------------------------- |
| 0    | Passed  | No SDK issues (spec issues/warnings OK)      |
| 1    | Failed  | SDK has issues that must be fixed            |
| 2    | Review  | Ambiguous issues require human judgment      |
| 3    | Error   | Steady itself failed (bad spec, crash, etc.) |

---

## Output Formats

### Text (default)

Human-readable report as shown above.

### JSON

Machine-readable for CI integration and tooling:

```json
{
  "result": "failed",
  "exit_code": 1,

  "spec": {
    "title": "Acme API",
    "version": "1.4.0",
    "openapi": "3.1.0",
    "path": "./specs/acme-api.yaml"
  },

  "server": {
    "name": "Steady",
    "version": "0.13.1",
    "mode": "strict"
  },

  "session": {
    "started_at": "2024-01-15T14:30:00Z",
    "ended_at": "2024-01-15T14:32:00Z",
    "duration_ms": 120000
  },

  "summary": {
    "requests": { "total": 500, "passed": 450, "failed": 50 },
    "issues": { "sdk": 2, "ambiguous": 0, "server_notes": 3 },
    "endpoints": { "total": 50, "covered": 30, "fully_valid": 28 }
  },

  "issues": {
    "sdk": [
      {
        "id": "sdk-001",
        "endpoint": "GET /users/{id}",
        "count": 30,
        "category": "structural",
        "constraint": "type",

        "location": {
          "request_path": "path.id",
          "spec_pointer": "#/paths/~1users~1{id}/get/parameters/0/schema",
          "spec_context": {
            "parameters": [{
              "name": "id",
              "in": "path",
              "required": true,
              "schema": { "type": "integer" }
            }]
          }
        },

        "error": {
          "message": "Path parameter 'id' has wrong type",
          "expected": { "type": "integer" },
          "received": { "type": "string", "example": "abc123" }
        },

        "fix": {
          "target": "sdk",
          "description": "Convert id to integer before building URL",
          "examples": {
            "python": "url = f\"/users/{int(user_id)}\"",
            "typescript": "const url = `/users/${Number(userId)}`;"
          }
        },

        "occurrences": {
          "first": {
            "request_id": "req-001",
            "timestamp": "2024-01-15T14:30:15Z"
          },
          "last": {
            "request_id": "req-089",
            "timestamp": "2024-01-15T14:31:42Z"
          },
          "sample_values": ["abc123", "user_456", "id-789"]
        }
      }
    ],

    "ambiguous": [
      {
        "id": "amb-001",
        "endpoint": "PUT /items/{id}",
        "count": 5,

        "location": {
          "request_path": "body.quantity",
          "spec_pointer": "#/components/schemas/Item/properties/quantity",
          "spec_context": {
            "quantity": { "type": "integer", "description": "Number of items" }
          }
        },

        "error": {
          "message": "Field 'quantity' received null but spec expects integer",
          "expected": { "type": "integer" },
          "received": { "type": "null" }
        },

        "possible_fixes": [
          {
            "target": "spec",
            "description": "Allow null for quantity",
            "diff": {
              "path": "#/components/schemas/Item/properties/quantity",
              "before": { "type": "integer" },
              "after": { "type": ["integer", "null"] }
            }
          },
          {
            "target": "sdk",
            "description": "Omit null fields before sending",
            "examples": {
              "python": "body = {k: v for k, v in data.items() if v is not None}"
            }
          },
          {
            "target": "user",
            "description": "Provide integer value instead of null"
          }
        ],

        "resolution_hint": "Test against real API to determine if null is accepted"
      }
    ],

    "server_notes": [
      {
        "id": "note-001",
        "endpoint": "POST /users",
        "count": 15,
        "category": "content",
        "constraint": "pattern",

        "location": {
          "request_path": "body.email",
          "spec_pointer": "#/components/schemas/User/properties/email"
        },

        "note": {
          "message": "Email doesn't match pattern",
          "pattern": "^[a-z]+@[a-z]+\\.[a-z]+$",
          "sample_values": ["alice.smith@example.co.uk", "bob+test@company.io"]
        },

        "context": "SDK correctly sent user-provided strings. Content validation is server's responsibility."
      }
    ]
  },

  "coverage": {
    "tested": ["GET /users", "GET /users/{id}", "POST /users"],
    "untested": ["DELETE /users/{id}", "GET /admin/stats"]
  }
}
```

### JUnit XML

For CI systems that expect JUnit format:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Steady SDK Validation" tests="500" failures="50" time="120">
  <testsuite name="GET /users/{id}" tests="100" failures="30">
    <testcase name="request-001" time="0.05"/>
    <testcase name="request-002" time="0.04">
      <failure message="Path parameter 'id' has wrong type">
        Expected: integer
        Received: string "123"
      </failure>
    </testcase>
  </testsuite>
</testsuites>
```

---

## Attribution Logic

### The Core Principle: Structural vs Content

The SDK is a transport layer. Attribution depends on whether the issue is
**structural** (SDK's job) or **content** (user's data, server validates).

```
┌─────────────────────────────────────────────────────────────────┐
│                    VALIDATION TAXONOMY                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STRUCTURAL (SDK's responsibility)                              │
│  ─────────────────────────────────                              │
│  • HTTP method           → SDK chose wrong verb                 │
│  • Path construction     → SDK built URL incorrectly            │
│  • Required fields       → SDK omitted mandatory field          │
│  • Data types            → SDK sent string instead of integer   │
│  • Object structure      → SDK sent wrong shape                 │
│  • Required headers      → SDK forgot Authorization             │
│                                                                 │
│  If these fail → SDK ISSUE                                      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CONTENT (User provides, server validates)                      │
│  ─────────────────────────────────────────                      │
│  • format: email/uri/uuid  → User's string, SDK just sends it   │
│  • pattern: regex          → User's content, server checks      │
│  • minLength/maxLength     → User's string length               │
│  • minimum/maximum         → User's number value                │
│  • Business rules          → Server logic                       │
│                                                                 │
│  If these fail → NOT SDK ISSUE (informational only)             │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EDGE CASES (Context-dependent)                                 │
│  ─────────────────────────────                                  │
│  • enum values      → SDK might expose as typed enum, or not    │
│  • nullable         → SDK might allow null, or not              │
│  • additionalProps  → SDK might filter fields, or pass through  │
│                                                                 │
│  Depends on SDK design choices → May need human judgment        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### SDK Issue (High Confidence)

These are unambiguously the SDK's fault:

| Issue                     | Why SDK's Fault                  |
| ------------------------- | -------------------------------- |
| Wrong HTTP method         | SDK chose the verb               |
| Path parameter wrong type | SDK constructs the URL           |
| Missing required field    | SDK must include required fields |
| Wrong data type           | SDK must send correct types      |
| Wrong object structure    | SDK must match schema shape      |
| Missing required header   | SDK must add required headers    |

**Example:**

```
Spec: GET /users/{id} where id is type: integer
SDK sends: GET /users/abc

→ SDK ISSUE: Path parameter 'id' must be integer, got string
```

### NOT SDK Issue (Content Validation)

These are NOT the SDK's fault — the SDK just passes through user data:

| Issue                       | Why Not SDK's Fault       |
| --------------------------- | ------------------------- |
| Email doesn't match pattern | User provided the email   |
| String too short/long       | User provided the string  |
| Number out of range         | User provided the number  |
| Format validation fails     | User provided the content |

**Example:**

```
Spec: POST /users with email: { type: string, format: email }
User calls: sdk.create_user(email="not-valid")
SDK sends: POST /users {"email": "not-valid"}

→ NOT SDK ISSUE: SDK correctly sent the user's string.
  Server may reject it, but that's user's problem.
```

### The Spec Might Be Wrong

Important: Steady validates against the **spec**, but the spec might not
accurately describe the **real API**. When validation fails, consider:

```
┌─────────────────────────────────────────────────────────────────┐
│                    WHO COULD BE WRONG?                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SDK is wrong                                                │
│     SDK doesn't follow the spec                                 │
│     → Fix the SDK                                               │
│                                                                 │
│  2. Spec is wrong                                               │
│     Spec doesn't accurately describe the real API               │
│     → Fix the spec (real API is source of truth)                │
│                                                                 │
│  3. User data is wrong                                          │
│     User provided invalid input to the SDK                      │
│     → User's problem, not SDK or spec                           │
│                                                                 │
│  4. Multiple parties wrong                                      │
│     Ambiguous case, needs investigation                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

When Steady reports an ambiguous issue, the user should:

1. Test against the real API to see what it actually accepts
2. If real API accepts it → spec is wrong
3. If real API rejects it → SDK or user data is wrong

### Edge Cases Requiring Judgment

Some cases depend on SDK design philosophy:

**Enum values:**

```
Spec: status: { enum: [active, inactive] }
User calls: sdk.update_user(status="invalid")
```

- If SDK exposes `status` as a typed enum → User can't even call this
- If SDK exposes `status` as string → SDK passes it through, server rejects
- Attribution depends on SDK's API design

**Null handling:**

```
Spec: age: { type: integer } (no nullable: true)
User calls: sdk.update_user(age=None)
```

- SDK might: Omit the field entirely
- SDK might: Send `"age": null`
- SDK might: Raise an error before sending
- Attribution depends on SDK's null handling strategy

**Additional properties:**

```
Spec: User has {name, email}, additionalProperties: false
User calls: sdk.create_user(name="A", email="a@b.com", phone="555")
```

- SDK might: Filter out unknown fields
- SDK might: Pass everything through
- If SDK passes through → Server rejects → Is that SDK's fault?
- Attribution depends on SDK's design philosophy

### Special Case: SDK-Generated Content

If the SDK **generates** content (not user-provided), content validation
applies:

| SDK Generates     | Content Validation Applies              |
| ----------------- | --------------------------------------- |
| Request ID (UUID) | Yes - SDK must generate valid UUID      |
| Timestamp         | Yes - SDK must generate valid date-time |
| Signature/HMAC    | Yes - SDK must compute correctly        |
| Default values    | Yes - SDK's defaults must be valid      |

**Example:**

```
SDK auto-generates: X-Request-ID: "not-a-uuid"

→ SDK ISSUE: SDK-generated request ID must be valid UUID
```

### Attribution Summary

| Validation Type     | User Data     | SDK-Generated |
| ------------------- | ------------- | ------------- |
| Type mismatch       | SDK issue     | SDK issue     |
| Missing required    | SDK issue     | SDK issue     |
| Wrong structure     | SDK issue     | SDK issue     |
| Format (email, etc) | Not SDK issue | SDK issue     |
| Pattern (regex)     | Not SDK issue | SDK issue     |
| Range (min/max)     | Not SDK issue | SDK issue     |

---

## Error Codes

Inspired by Rust's `E0308` system, every Steady diagnostic has a code. The
leading digit encodes **attribution** — you see the code and immediately know
who's responsible.

**Format:** `E` + 4 digits. First digit = category = attribution.

```
E1xxx — Spec       (spec author's problem, found at startup)
E2xxx — Routing    (SDK hitting wrong endpoint)
E3xxx — Transport  (SDK packaging data wrong — the core of Steady)
E4xxx — Content    (not SDK's fault — server validates this)
E5xxx — Ambiguous  (needs human judgment)
```

Each code has a detailed explanation accessible via `steady --explain E3013`.

---

### E1xxx — Spec Diagnostics

Found during spec loading, before any SDK runs. Always the spec author's
problem.

| Code  | Title                           | Severity |
| ----- | ------------------------------- | -------- |
| E1001 | Invalid syntax                  | error    |
| E1002 | Unsupported OpenAPI version     | error    |
| E1003 | Missing required spec field     | error    |
| E1004 | Unresolved reference            | error    |
| E1005 | Circular reference              | warning  |
| E1006 | Invalid schema definition       | error    |
| E1007 | Keywords alongside $ref ignored | warning  |

---

### E2xxx — Routing

SDK sent a request that can't be matched to a spec operation.

| Code  | Title                        | Severity |
| ----- | ---------------------------- | -------- |
| E2001 | Path not found               | error    |
| E2002 | Method not allowed           | error    |
| E2003 | Undocumented query parameter | warning  |

---

### E3xxx — Transport Failures

The heart of Steady. SDK failed to correctly package the request per the spec.
Unambiguously the SDK's fault — these are structural, not content.

| Code  | Title                             | What went wrong                               |
| ----- | --------------------------------- | --------------------------------------------- |
| E3001 | Path parameter type mismatch      | SDK constructs URLs — must get types right    |
| E3002 | Missing required query parameter  | SDK must include required params              |
| E3003 | Query parameter type mismatch     | SDK must send correct types                   |
| E3004 | Missing required header           | SDK must include required headers             |
| E3005 | Missing request body              | Endpoint requires body, SDK sent none         |
| E3006 | Wrong Content-Type                | SDK sent wrong media type                     |
| E3007 | Missing required field            | SDK must include all required fields          |
| E3008 | Field type mismatch               | SDK sent string where spec says integer, etc. |
| E3009 | Additional property not allowed   | `additionalProperties: false` explicitly set  |
| E3010 | Invalid array item type           | Array contains items of wrong type            |
| E3011 | Invalid discriminator value       | Discriminator value doesn't match any schema  |
| E3012 | Schema composition mismatch       | Doesn't satisfy oneOf/anyOf/allOf             |
| E3013 | Required field in optional parent | Optional object present but incomplete        |

---

### E4xxx — Content Validation Notes

SDK correctly transported user data. The data doesn't meet server-side
constraints, but **that's the server's job, not the SDK's**. Informational only
— never fails validation.

| Code  | Title                   | Why not SDK's fault                                |
| ----- | ----------------------- | -------------------------------------------------- |
| E4001 | Format mismatch         | User's string, SDK just sends it                   |
| E4002 | Pattern mismatch        | User's content, server checks regex                |
| E4003 | String length violation | User provides content                              |
| E4004 | Numeric range violation | User provides the number                           |
| E4005 | Array size violation    | User controls array contents                       |
| E4006 | Enum value not in list  | User-provided value (see E5002 for ambiguous case) |
| E4007 | Multiple-of violation   | User provides the number                           |

---

### E5xxx — Ambiguous

Could be SDK, spec, or user. Steady presents options and lets the human decide.

| Code  | Title                               | Why it's ambiguous                          |
| ----- | ----------------------------------- | ------------------------------------------- |
| E5001 | Null for non-nullable field         | Spec omission? SDK design? User error?      |
| E5002 | Enum value from SDK                 | Does SDK expose typed enum or pass-through? |
| E5003 | Additional properties (spec silent) | Spec doesn't set `additionalProperties`     |

---

### `steady --explain`

Each error code has a detailed explanation that teaches the user WHY Steady
categorized it this way. The explain text is Steady-specific — it doesn't just
describe the error, it explains the attribution reasoning through Steady's
transport-layer lens.

#### `steady --explain E5001`

The hardest attribution problem. Three parties could be responsible, and Steady
can't determine which without testing against the real API.

```
E5001: Null for non-nullable field
═══════════════════════════════════

Attribution: AMBIGUOUS — could be spec, SDK, or user
Category:    Needs human judgment

The SDK sent null for a field the spec does not mark as nullable.
Steady cannot determine who is responsible without more context.

Example:

  Spec:
    PUT /items/{id}
    requestBody:
      content:
        application/json:
          schema:
            properties:
              quantity:
                type: integer          ← no nullable, no "null" in type
                description: Number of items to order

  SDK sends:
    PUT /items/42
    {"quantity": null}

Why this is ambiguous:

  Three parties could be responsible:

  1. THE SPEC might be wrong.
     Many real APIs accept null even when the spec doesn't say so.
     Specs are often incomplete — written once, then the API evolves.
     If the real API accepts null here, the spec should be updated:

       quantity:
     -   type: integer
     +   type: [integer, "null"]          # OpenAPI 3.1
         description: Number of items to order

     Or for OpenAPI 3.0:
       quantity:
         type: integer
     +   nullable: true

  2. THE SDK might need a design decision.
     How should the SDK handle null values from the user?
     Common strategies:

       • Omit the field entirely:
         body = {k: v for k, v in data.items() if v is not None}

       • Convert to a default:
         quantity = user_quantity ?? 0

       • Reject before sending:
         if quantity is None:
             raise ValueError("quantity cannot be null")

  3. THE USER might be making a mistake.
     The user passed null when they should have passed an integer
     or omitted the field entirely.

How to resolve:

  Test against the real API:
    • If API accepts null → Fix the spec (Option 1)
    • If API rejects null → SDK or user should handle it (Option 2 or 3)

  Steady reports this as AMBIGUOUS because validating against the spec
  alone cannot determine who is at fault.
```

#### `steady --explain E3013`

A subtle structural bug that trips up SDK developers. The parent is optional,
but once included, its required children must be present. SDKs that blindly pass
through partial objects break this contract.

```
E3013: Required field missing in optional parent
═════════════════════════════════════════════════

Attribution: SDK issue (structural)
Category:    Transport failure

The SDK included an optional object in the request body, but that
object is missing fields that become required once the parent is present.

Example:

  Spec:
    POST /users
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required: [name]
            properties:
              name:
                type: string
              address:              ← NOT in parent's required[]
                type: object
                required: [street, city]  ← but if present, THESE are required
                properties:
                  street: { type: string }
                  city: { type: string }
                  zip: { type: string }

  SDK sends:
    POST /users
    {
      "name": "Alice",
      "address": {               ← SDK chose to include address
        "street": "123 Main"
      }                          ← where is city?
    }

Why this is an SDK issue:

  The SDK had two valid choices:

    1. Omit address entirely     → ✓ Valid (address is optional)
    2. Include a COMPLETE address → ✓ Valid (all required children present)

  The SDK chose a third option:

    3. Include address but incomplete → ✗ Invalid

  By including the address object, the SDK took responsibility for
  its contents. The required: [street, city] constraint activates
  the moment the parent object is present.

  This is structural — it's about the SHAPE of the object, not the
  VALUES inside it. The SDK is sending a malformed object.

How to fix (SDK):

  Option A — Include all required fields:
    {
      "name": "Alice",
      "address": {
        "street": "123 Main",
    +   "city": "Springfield"
      }
    }

  Option B — Don't include partial objects:
    // Only include address if all required fields are available
    if address.street and address.city:
        body["address"] = address
    // Otherwise, omit it entirely

Common cause:
  SDK is building the address object from user input but not
  checking whether all required fields were provided before
  including the parent. A single field present causes the SDK
  to include the object, but other required siblings are missing.
```

#### `steady --explain E4001`

The philosophical core of Steady's design. This is where the transport-layer
concept is most important — and most counterintuitive for developers used to
"validate everything" thinking.

```
E4001: Format validation failed
════════════════════════════════

Attribution: NOT an SDK issue (content validation)
Category:    Server validation note — informational only

A value doesn't match the format constraint in the spec (email, uri,
uuid, date-time, etc). However, format validation is the SERVER's
responsibility, not the SDK's. The SDK's job is to transport the
user's data faithfully.

Example:

  Spec:
    POST /users
    requestBody:
      content:
        application/json:
          schema:
            properties:
              email:
                type: string        ← type: string ✓
                format: email       ← format is server-side validation

  User code:
    sdk.create_user(email="not-a-valid-email")

  SDK sends:
    POST /users
    {"email": "not-a-valid-email"}

  Steady says: SDK is CORRECT. This is NOT an SDK issue.

  The SDK was asked to send a string. It sent a string. Done.

Why this is NOT an SDK issue:

  The SDK is a transport layer. Its job is:
    1. Accept data from the user           ✓ (accepted the string)
    2. Package it correctly                 ✓ (put it in the email field)
    3. Send it as the right type            ✓ (sent a string, spec says string)

  Whether that string is a valid email is between the USER and
  the SERVER.

  Think of the SDK like a postal service:
    • It's the post office's job to deliver your letter
      to the right address.
    • It's NOT the post office's job to proofread your letter.
    • If the recipient rejects your letter because of its content,
      that's between you and the recipient.

  If the server returns 400 for an invalid email, that's correct
  server behavior. The SDK did its job by faithfully sending
  the request.

  Compare with E3008 (field type mismatch):
    {"email": 12345}       ← E3008, SDK issue. Spec says string, SDK sent integer.
    {"email": "whatever"}  ← E4001, NOT SDK issue. String is correct type.

When IS format the SDK's fault?

  Only when the SDK GENERATES the value itself:

    • SDK auto-generates X-Request-ID → must be valid UUID
    • SDK auto-generates timestamps   → must be valid date-time
    • SDK computes HMAC signatures    → must be correct

  In those cases, the SDK is both author and transport. It's
  responsible for content too.

  Steady cannot automatically detect which fields are SDK-generated
  vs user-provided. By default, all content is assumed user-provided
  (conservative — avoids false SDK blame).

What Steady reports:

  Steady logs E4001 as a "Server Validation Note" — visible in the
  report but does NOT affect the pass/fail result. Your SDK validation
  still PASSES even if E4001 notes exist.
```

#### `steady --explain E3011`

A complex case involving OpenAPI's discriminator mechanism. The discriminator is
structural — it determines which schema applies, like a type tag in a tagged
union. Getting it wrong means the SDK doesn't know what object it's building.

```
E3011: Invalid discriminator value
═══════════════════════════════════

Attribution: SDK issue (structural)
Category:    Transport failure

The SDK sent a value for a discriminator property that doesn't match
any schema in the oneOf/anyOf composition.

Example:

  Spec:
    POST /pets
    requestBody:
      content:
        application/json:
          schema:
            oneOf:
              - $ref: '#/components/schemas/Cat'
              - $ref: '#/components/schemas/Dog'
            discriminator:
              propertyName: petType
              mapping:
                cat: '#/components/schemas/Cat'
                dog: '#/components/schemas/Dog'

    Cat:
      type: object
      required: [petType, name, indoor]
      properties:
        petType: { type: string, const: "cat" }
        name: { type: string }
        indoor: { type: boolean }

    Dog:
      type: object
      required: [petType, name, breed]
      properties:
        petType: { type: string, const: "dog" }
        name: { type: string }
        breed: { type: string }

  SDK sends:
    POST /pets
    {"petType": "fish", "name": "Nemo", "tankSize": 50}

  "fish" is not in the discriminator mapping. Steady cannot determine
  which schema to validate against.

Why this is an SDK issue:

  Discriminators are structural. They determine which schema applies —
  like a type tag in a tagged union. The SDK must send a valid
  discriminator value because:

    1. The SDK typically exposes pet creation as typed methods:
         sdk.create_cat(name="Whiskers", indoor=True)
         sdk.create_dog(name="Rex", breed="Labrador")

    2. Even with a generic method, the SDK knows the valid types:
         sdk.create_pet(type="cat", ...)

    3. The discriminator value determines the ENTIRE object shape.
       Sending an invalid discriminator means the SDK doesn't know
       what object it's building — that's a transport failure.

  This is different from enum content validation (E4006) because the
  discriminator controls SCHEMA SELECTION, not just a field value.
  An invalid discriminator makes the entire request structurally
  unparseable by the server.

How to fix (SDK):

  Option A — Validate discriminator before sending:
    VALID_PET_TYPES = {"cat", "dog"}
    if pet_type not in VALID_PET_TYPES:
        raise ValueError(f"Invalid pet type: {pet_type}")

  Option B — Use typed constructors:
    // TypeScript
    type Pet = Cat | Dog;  // No "fish" possible at compile time
    function createCat(name: string, indoor: boolean): Cat { ... }
    function createDog(name: string, breed: string): Dog { ... }

  Option C — Map user input to valid discriminator values:
    pet_type_map = {"kitty": "cat", "puppy": "dog"}
    api_type = pet_type_map.get(user_input)

Also check for (separate code):
  E3012 — Valid discriminator but wrong shape for that schema
           e.g., {"petType": "cat", "breed": "Labrador"}
           "cat" is valid, but Cat doesn't have breed — it has indoor.
```

---

## Open Questions

1. **Should Steady validate content constraints at all?**
   - Option A: Don't validate (only structural) — simpler, cleaner separation
   - Option B: Validate but report separately — more information for users
   - Option C: Make it configurable — `--structural-only` flag
   - Recommendation: Option B (validate, report as "server notes")

2. **Should warnings affect exit code?**
   - Current design: No, only errors
   - Alternative: `--strict-warnings` flag to treat warnings as errors

3. **How to handle flaky issues?**
   - Issue appears in 1/100 requests for same endpoint
   - Could be race condition, random data, or intermittent bug
   - Should we track consistency?

4. **Should we track "fixed" issues?**
   - Issue appeared in requests 1-50, then stopped
   - Suggests SDK was updated mid-session
   - Useful for live development workflows

5. **Per-endpoint vs aggregate reporting?**
   - Current: Aggregate by (endpoint, message)
   - Alternative: Per-endpoint report cards
   - Could offer both

6. **Historical comparison?**
   - "5 new issues since last run"
   - "3 issues fixed since last run"
   - Requires storing previous results

---

## Implementation Notes

### Validation Classification

At validation time, Steady must classify each constraint:

```typescript
type ConstraintType = "structural" | "content";

const STRUCTURAL_CONSTRAINTS = [
  "type", // type: integer, string, object, array
  "required", // required: [field1, field2]
  "properties", // object shape
  "items", // array item type
  "additionalProperties", // when explicitly false
];

const CONTENT_CONSTRAINTS = [
  "format", // format: email, uri, date-time
  "pattern", // pattern: regex
  "minLength", // string length
  "maxLength",
  "minimum", // numeric range
  "maximum",
  "minItems", // array length
  "maxItems",
  "enum", // allowed values (debatable - see edge cases)
];
```

### Issue Classification

```typescript
type IssueCategory =
  | "sdk-issue" // Structural failure → SDK must fix
  | "server-note" // Content failure → Informational only
  | "ambiguous"; // Needs human judgment

interface ValidationIssue {
  category: IssueCategory;
  constraint: string; // 'type', 'required', 'pattern', etc.
  constraintType: ConstraintType;

  // Location - WHERE the issue is
  requestPath: string; // 'body.email', 'path.id', 'query.limit'
  specPointer: string; // '#/paths/~1users/post/requestBody/.../schema'

  // Details - WHAT the issue is
  message: string;
  expected: unknown;
  received: unknown;
  suggestion?: string;
}
```

### Data to Track Per Request

```typescript
interface RequestRecord {
  id: string;
  timestamp: Date;
  method: string;
  path: string; // /users/123
  pathPattern: string; // /users/{id}

  // Separate tracking for SDK issues vs content notes
  structurallyValid: boolean; // Only structural issues affect this
  sdkIssues: ValidationIssue[];
  serverNotes: ValidationIssue[]; // Content validation results
  ambiguous: ValidationIssue[];
}
```

### Aggregation for Report

```typescript
interface IssueAggregate {
  // What endpoint
  endpoint: string; // "GET /users/{id}"
  message: string;
  category: IssueCategory;

  // Where in request/spec
  requestPath: string; // 'body.email', 'path.id'
  specPointer: string; // '#/paths/~1users~1{id}/get/parameters/0/schema'

  // Frequency
  count: number;
  firstOccurrence: Date;
  lastOccurrence: Date;

  // Details
  exampleValues: unknown[]; // Sample of failing values
  suggestion?: string;
}

interface ValidationReport {
  result: "passed" | "failed" | "review";

  // Structural validity (determines pass/fail)
  structurallyValid: number;
  structurallyInvalid: number;

  // Breakdown
  sdkIssues: IssueAggregate[]; // Must fix
  serverNotes: IssueAggregate[]; // Informational
  ambiguous: IssueAggregate[]; // Needs review
}
```

### Report Generation

At shutdown:

1. Group RequestRecords by (pathPattern, method, issue.message)
2. Sort by count descending
3. Take top N for display (configurable)
4. Calculate summary statistics
5. Determine exit code based on SDK issues
6. Format output based on requested format
