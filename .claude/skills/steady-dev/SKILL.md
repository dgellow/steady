---
name: steady-dev
description: How to work on the Steady project
---

# Working on Steady

## What Steady Is

Steady is an OpenAPI mock server that answers one question: **can this SDK be
trusted to correctly transport requests to the API?**

It validates SDK-generated HTTP requests against an OpenAPI spec, attributing
every issue to exactly one responsible party: the SDK, the spec, or ambiguous.
This is Steady's core value — not generic API testing, but SDK transport-layer
verification.

## The User

Steady's user is an SDK developer staring at terminal output, trying to figure
out why their SDK test failed. Every decision — error messages, diagnostic
formatting, CLI flags, exit codes — should be evaluated from their chair.

- **They don't know your internals.** Don't say "metaschema", say "not
  recognized here". Don't say `#/paths`, say `GET /users`.
- **They need to know what to do.** Every diagnostic should answer: what
  happened, whose fault is it, and how do I fix it.
- **They're scanning, not reading.** Visual hierarchy matters. Errors are red,
  warnings are yellow, info is grey. Important things pop, noise fades.
- **They might be in CI.** Output must be grep-able, exit codes must be
  meaningful, JSON output must be machine-parseable.

When in doubt, ask: "If I were debugging an SDK at 11pm, would this help me or
annoy me?"

## Architecture

```
cmd/steady.ts           CLI entry point, arg parsing, subcommands
src/server.ts           HTTP server, request matching, response generation
src/engine/             Diagnostics engine (attribution, composition analysis)
  spec-analyzer.ts      Startup analysis (refs, duplicates, metaschema)
  diagnostic-engine.ts  Runtime attribution pipeline
  routing.ts            Path/method matching with enriched diagnostics
  interpreter.ts        Maps validation issues to E-codes
src/codes/              E-code registry + explanations
  registry.ts           Code definitions (title, severity, category)
  explanations.ts       User-facing documentation per code
  explain.ts            `steady explain` command renderer
src/logging/            All output formatting
  format-diagnostic.ts  Compiler-style diagnostic rendering
  text-logger.ts        Terminal output for requests/startup/shutdown
  json-logger.ts        NDJSON output for CI
  colors.ts             ANSI color constants and helpers
src/diagnostics/        Session tracking
  collector.ts          Aggregates runtime diagnostics for shutdown summary
packages/               Self-contained libraries (no src/ imports)
  openapi/              OpenAPI 3.x parser
  json-schema/          JSON Schema 2020-12 validator + generator
  json-pointer/         RFC 6901 implementation
docs/
  diagnostics-spec.md   Design spec — vision and rationale, not rigid rules
```

### Key Design Decisions

**Parser does parsing, analyzer does analysis.** `parseSpec()` returns a typed
object. All quality analysis (refs, duplicates, metaschema, impossible
constraints) lives in `spec-analyzer.ts` and flows through the diagnostic
pipeline.

**E-codes are the API.** Every diagnostic has a stable code (E1001, E3008, etc).
The registry (`src/codes/registry.ts`) defines metadata. Code ranges have
meaning: E1xxx=spec, E2xxx=routing, E3xxx=transport, E4xxx=content,
E5xxx=ambiguous.

**Compiler-style output.** Diagnostics render like Rust/Elm errors: header with
severity+code, arrow pointing to location, pipe section with context, notes with
`=` prefix. This is in `format-diagnostic.ts`.

**Attribution is the product.** The diagnostics engine doesn't just report
errors — it determines WHO is responsible (SDK vs spec vs ambiguous) with a
confidence score and reasoning chain. This is what makes Steady different from a
generic validator.

## Design Doc Relationship

`docs/diagnostics-spec.md` captures the vision and rationale. It is guidance,
not a rigid contract. The spec may lag behind implementation or contain
aspirational sections. When implementing:

- Understand the intent behind a spec section
- If you find a better way to serve the user, do it
- Update the spec to match reality when they diverge
- Never implement something you know is wrong just because the spec says so

## Working Style

**User-centric above all.** Before writing code, think about what the user sees.
Run `steady <spec>` and look at the output. Does it help? Is it noisy? Is the
important thing visible?

**No type hacks.** No `as` casts, no non-null assertions. Use type guards,
`satisfies`, narrowing, or restructure parameters.

**Red-green testing.** Write the failing test first. Run it. See it fail.
Implement. See it pass. This is not optional.

**Inline snapshots for output tests.** Use `assertInlineSnapshot` from
`@std/testing/unstable-snapshot` for testing formatted output. Run with
`-- --update` to auto-populate snapshot values.

**Run the tool.** After making changes to output formatting, CLI flags, or
diagnostics — actually run `steady` against a real spec and look at it. Terminal
output bugs are visual; you can't catch them from test assertions alone.

**Investigate before implementing.** Read the OpenAPI spec, check RFCs, look at
how other tools handle it. Don't guess.

## Common Tasks

### Adding a new E-code

1. Add to `src/codes/registry.ts` with title, severity, category
2. Add explanation to `src/codes/explanations.ts`
3. Emit the diagnostic from the appropriate place (spec-analyzer for startup,
   interpreter for runtime)
4. Add/update tests

### Changing diagnostic output

1. Edit `src/logging/format-diagnostic.ts` for compiler-style output
2. Edit `src/logging/text-logger.ts` for startup/shutdown/request output
3. Run `steady <spec>` to see the result visually
4. Update snapshots: `./scripts/test <file> -- --update`

### Adding a CLI flag

1. Add to `parseArgs` in `cmd/steady.ts`
2. Add to the options type and thread through to where it's used
3. Add to `printHelp()`
4. Add to `ServerConfig` in `src/types.ts` if it affects server behavior
