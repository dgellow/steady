# Cursed Clients

A collection of HTTP request patterns that real-world SDK clients produce
incorrectly. While cursed specs test Steady against invalid OpenAPI definitions,
cursed clients test Steady against malformed HTTP requests that actual SDKs
send.

The distinction matters:

- **Cursed specs** = the API definition is wrong
- **Cursed clients** = the SDK implementation is wrong

## Why This Matters

A mock server's job is to validate SDKs against specs. When an SDK sends a
malformed request, Steady should:

1. **Detect** the malformation
2. **Attribute** the error correctly (SDK bug, not spec issue)
3. **Provide** actionable diagnostics pointing to the SDK code

## Contributing

When adding a cursed client pattern, include:

- **Header comment** explaining the malformation
- **Real-world source** - which SDK produces this (with version/commit if known)
- **Root cause** - what code in the SDK causes the issue
- **Expected vs actual** - what the request should look like vs what it does
- **Detection strategy** - how Steady can detect this pattern

## Catalog

| File                        | Curse                                        | SDK Source       |
| --------------------------- | -------------------------------------------- | ---------------- |
| `double-question-mark.yaml` | `?beta=true?limit=10` instead of `&limit=10` | anthropic-sdk-go |

## Ideas for Future Curses

- Missing Content-Type header on POST/PUT requests
- Sending body on GET requests
- Incorrect percent-encoding in path parameters
- Trailing slashes when spec doesn't define them
- Mixed-case HTTP methods
- Sending query params as body or vice versa
