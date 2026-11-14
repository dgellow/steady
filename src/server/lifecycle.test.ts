/**
 * The exit code is how a CI job learns the outcome of a session: 0 when
 * nothing matched the fail criteria, 1 when something did.
 */

import { assertEquals } from "@std/assert";
import { computeExitCode } from "./lifecycle.ts";
import { DiagnosticCollector } from "../diagnostics/collector.ts";
import { type ECode, getCode } from "../codes/registry.ts";
import type { Diagnostic } from "../diagnostic.ts";
import type { ServerConfig } from "../types.ts";

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    quiet: true,
    logLevel: "summary",
    ...overrides,
  };
}

function diagnostic(code: ECode): Diagnostic {
  const definition = getCode(code);
  return {
    code,
    severity: definition.severity,
    category: definition.category,
    requestPath: "body",
    specPointer: "#",
    message: definition.title,
    attribution: { confidence: 1, reasoning: [] },
  };
}

/** A collector that has seen one request with the given diagnostics. */
function sessionWith(...codes: ECode[]): DiagnosticCollector {
  const collector = new DiagnosticCollector();
  collector.addRuntimeDiagnostics(codes.map(diagnostic), "post", "/x", true);
  return collector;
}

Deno.test("computeExitCode: a clean session exits with 0", () => {
  assertEquals(computeExitCode(0, config(), new DiagnosticCollector()), 0);
});

Deno.test("computeExitCode: any failed request exits with 1, whatever the flags", () => {
  assertEquals(computeExitCode(1, config(), new DiagnosticCollector()), 1);
  assertEquals(
    computeExitCode(
      3,
      config({ failOnAmbiguous: false, failOnWarnings: false }),
      new DiagnosticCollector(),
    ),
    1,
  );
});

Deno.test("computeExitCode: content notes never change the exit code", () => {
  const session = sessionWith("E4003", "E4007");
  assertEquals(computeExitCode(0, config(), session), 0);
  assertEquals(
    computeExitCode(
      0,
      config({ failOnAmbiguous: true, failOnWarnings: true }),
      session,
    ),
    0,
  );
});

Deno.test("computeExitCode: ambiguous diagnostics fail the session only with --fail-on-ambiguous", () => {
  // E3015 is ambiguous with severity info, so --fail-on-warnings does not
  // apply to it and the two flags can be told apart.
  const session = sessionWith("E3015");
  assertEquals(computeExitCode(0, config(), session), 0);
  assertEquals(
    computeExitCode(0, config({ failOnWarnings: true }), session),
    0,
  );
  assertEquals(
    computeExitCode(0, config({ failOnAmbiguous: true }), session),
    1,
  );
});

Deno.test("computeExitCode: warnings fail the session only with --fail-on-warnings", () => {
  // E5003 is ambiguous with severity warning.
  const session = sessionWith("E5003");
  assertEquals(computeExitCode(0, config(), session), 0);
  assertEquals(
    computeExitCode(0, config({ failOnWarnings: true }), session),
    1,
  );
});

Deno.test("computeExitCode: startup diagnostics do not count as session results", () => {
  const collector = new DiagnosticCollector();
  collector.setStaticDiagnostics([diagnostic("E1016"), diagnostic("E1019")]);
  assertEquals(
    computeExitCode(
      0,
      config({ failOnAmbiguous: true, failOnWarnings: true }),
      collector,
    ),
    0,
  );
});
