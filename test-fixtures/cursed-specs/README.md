# Cursed OpenAPI Specs

A collection of real-world OpenAPI specs that violate the specification or use
patterns that break tooling. These are used to:

1. Test Steady's resilience against invalid specs
2. Document common mistakes and edge cases
3. Ensure graceful handling with clear error attribution

## Contributing

When adding a cursed spec, include:

- **Header comment** explaining the violation and why it's cursed
- **Real-world source** if known (anonymized if needed)
- **Tooling behavior** - how different tools handle it
- **How Steady handles it** - expected warnings/behavior

## Catalog

| File                           | Curse                                       | OAS Section     |
| ------------------------------ | ------------------------------------------- | --------------- |
| `duplicate-path-patterns.yaml` | Same URL pattern with different param names | Path Templating |

## Ideas for Future Curses

- Circular `$ref` chains that break generators
- `allOf` with contradictory constraints
- Response schemas that reference request body schemas
- Deeply nested `oneOf`/`anyOf` causing combinatorial explosion
- Security schemes that reference non-existent scopes
- Path parameters defined but not in path template
- Required properties not in properties list
- `additionalProperties: false` with `allOf` inheritance
