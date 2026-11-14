/**
 * JSON Schema Test Suite compliance, draft 2020-12, required tests.
 *
 * The snapshot records the pass count and every case the validator gets
 * wrong. It is the project's compliance figure: documentation points here
 * instead of repeating a number.
 *
 * The test fails when the outcome changes in either direction:
 *
 * - A case that passed now fails: a regression. Fix the validator.
 * - A case that failed now passes: an improvement. Record it with
 *   `./scripts/test packages/json-schema/test-suite.test.ts -- --update`
 *   and commit the snapshot.
 *
 * The suite is the `packages/json-schema/test-suite` submodule. Moving its
 * pin changes the cases and therefore the snapshot.
 */

import { assertSnapshot } from "@std/testing/snapshot";
import { DRAFT_2020_12_DIR, runSuite } from "./test-suite-runner.ts";

Deno.test("JSON Schema Test Suite: draft 2020-12 compliance", async (t) => {
  let results;
  try {
    results = await runSuite(DRAFT_2020_12_DIR);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `JSON Schema Test Suite not found at ${DRAFT_2020_12_DIR}. ` +
          "It is a git submodule. Run: git submodule update --init",
        { cause: error },
      );
    }
    throw error;
  }

  // Failing cases by suite file, in suite order.
  const failing: Record<string, string[]> = {};
  for (const f of results.failures) {
    const wanted = f.expected ? "valid" : "invalid";
    (failing[f.file] ??= []).push(
      `${f.group} / ${f.test} (should be ${wanted})`,
    );
  }

  await assertSnapshot(t, {
    total: results.total,
    passed: results.passed,
    failed: results.failures.length,
    failing,
  });
});
