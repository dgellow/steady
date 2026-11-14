/**
 * Request bodies, checked against specs the test generates itself.
 *
 * For every generated schema:
 *
 * - the spec loads without a single diagnostic
 * - a value that is valid by construction is served, marked valid, with no
 *   finding
 * - every single fault causes exactly the finding it must cause: the code,
 *   the location, and whether the request is rejected
 *
 * `./scripts/test` runs a fixed seed, so a failure is the same on every
 * machine. With STEADY_FUZZ=1 the seed is random and the run lasts as long
 * as STEADY_FUZZ_SECONDS allows; the seed is printed with any failure.
 * To replay a failure, set STEADY_FUZZ_SEED to the printed seed.
 */

import { assertEquals } from "@std/assert";
import fc from "fast-check";
import { faults, modelWithValue, toSchema } from "./model.ts";
import { specWithBody, withSteady } from "./harness.ts";

const exploring = Deno.env.get("STEADY_FUZZ") === "1";
const seedText = Deno.env.get("STEADY_FUZZ_SEED");
const seconds = Number(Deno.env.get("STEADY_FUZZ_SECONDS") ?? "60");

const parameters: fc.Parameters<unknown> = {
  seed: seedText !== undefined
    ? Number(seedText)
    : exploring
    ? Date.now() % 2_147_483_647
    : 20261114,
  ...(exploring
    ? { numRuns: 1_000_000, interruptAfterTimeLimit: seconds * 1000 }
    : { numRuns: 150 }),
};

const bodyPath = (segments: string[]) => ["body", ...segments].join(".");

Deno.test("fuzz: generated schemas, valid bodies and single faults", async () => {
  await fc.assert(
    fc.asyncProperty(modelWithValue, async ({ model, value }) => {
      await withSteady(specWithBody(toSchema(model)), async (steady) => {
        assertEquals(
          steady.startupCodes,
          [],
          "a generated spec has no startup diagnostic",
        );

        assertEquals(
          await steady.postJson("/x", value),
          { status: 200, valid: "true", findings: [] },
          "a valid body is served without a finding",
        );

        for (const fault of faults(model, value)) {
          assertEquals(
            await steady.postJson("/x", fault.body),
            {
              status: fault.expected.rejects ? 400 : 200,
              valid: fault.expected.rejects ? "false" : "true",
              findings: [{
                code: fault.expected.code,
                path: bodyPath(fault.expected.path),
              }],
            },
            `${fault.label}, body ${JSON.stringify(fault.body)}`,
          );
        }
      });
    }),
    parameters,
  );
});
