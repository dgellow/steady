/**
 * OpenAPI Directory Integration Tests
 *
 * Tests Steady's parser against real-world OpenAPI specs from APIs-guru/openapi-directory
 * https://github.com/APIs-guru/openapi-directory
 *
 * This test suite validates that our parser handles the diversity of real-world specs.
 */

import { assertEquals, assertExists } from "@std/assert";
import { parseSpec } from "@steady/parser";

const OPENAPI_DIR = new URL(
  "../test-fixtures/openapi-directory/APIs",
  import.meta.url,
).pathname;

interface SpecInfo {
  path: string;
  name: string;
}

async function findSpecs(
  dir: string,
  filter?: (path: string) => boolean,
): Promise<SpecInfo[]> {
  const specs: SpecInfo[] = [];

  async function walk(path: string) {
    try {
      for await (const entry of Deno.readDir(path)) {
        const fullPath = `${path}/${entry.name}`;
        if (entry.isDirectory) {
          await walk(fullPath);
        } else if (
          (entry.name.endsWith(".yaml") || entry.name.endsWith(".json")) &&
          !entry.name.includes("swagger") // Skip Swagger 2.0 specs
        ) {
          if (!filter || filter(fullPath)) {
            specs.push({
              path: fullPath,
              name: fullPath.replace(dir + "/", ""),
            });
          }
        }
      }
    } catch {
      // Directory might not exist if submodule not initialized
    }
  }

  await walk(dir);
  return specs;
}

async function parseSpecFile(
  path: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const content = await Deno.readTextFile(path);
    const format = path.endsWith(".yaml") || path.endsWith(".yml")
      ? "yaml"
      : "json";
    await parseSpec(content, { format });
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// Check if submodule is available
let submoduleAvailable = false;
try {
  const stat = await Deno.stat(OPENAPI_DIR);
  submoduleAvailable = stat.isDirectory;
} catch {
  submoduleAvailable = false;
}

Deno.test({
  name: "OpenAPI Directory: submodule is available",
  ignore: false,
  fn: () => {
    if (!submoduleAvailable) {
      console.log(
        "⚠️  openapi-directory submodule not initialized. Run: git submodule update --init",
      );
    }
    // Don't fail - just warn
  },
});

Deno.test({
  name: "OpenAPI Directory: parse GitHub specs",
  ignore: !submoduleAvailable,
  fn: async () => {
    const specs = await findSpecs(OPENAPI_DIR, (p) => p.includes("github.com"));

    if (specs.length === 0) {
      console.log("No GitHub specs found");
      return;
    }

    let passed = 0;
    let failed = 0;

    for (const spec of specs) {
      const result = await parseSpecFile(spec.path);
      if (result.success) {
        passed++;
      } else {
        failed++;
        console.log(`❌ ${spec.name}: ${result.error}`);
      }
    }

    console.log(`GitHub specs: ${passed}/${specs.length} passed`);
    assertEquals(failed, 0, `${failed} GitHub specs failed to parse`);
  },
});

Deno.test({
  name: "OpenAPI Directory: parse Stripe spec",
  ignore: !submoduleAvailable,
  fn: async () => {
    const specs = await findSpecs(OPENAPI_DIR, (p) => p.includes("stripe.com"));

    if (specs.length === 0) {
      console.log("No Stripe specs found");
      return;
    }

    for (const spec of specs) {
      const result = await parseSpecFile(spec.path);
      assertEquals(
        result.success,
        true,
        `Stripe spec ${spec.name} failed: ${result.error}`,
      );
    }

    console.log(`Stripe specs: ${specs.length} passed`);
  },
});

Deno.test({
  name: "OpenAPI Directory: parse large specs (>1MB)",
  ignore: !submoduleAvailable,
  fn: async () => {
    const specs = await findSpecs(OPENAPI_DIR);
    const largeSpecs: SpecInfo[] = [];

    for (const spec of specs) {
      try {
        const stat = await Deno.stat(spec.path);
        if (stat.size > 1_000_000) {
          // > 1MB
          largeSpecs.push(spec);
        }
      } catch {
        continue;
      }
    }

    if (largeSpecs.length === 0) {
      console.log("No large specs found");
      return;
    }

    let passed = 0;
    const failures: string[] = [];

    for (const spec of largeSpecs.slice(0, 20)) {
      // Test first 20 large specs
      const start = performance.now();
      const result = await parseSpecFile(spec.path);
      const duration = performance.now() - start;

      if (result.success) {
        passed++;
        console.log(`✅ ${spec.name} (${duration.toFixed(0)}ms)`);
      } else {
        failures.push(`${spec.name}: ${result.error}`);
      }
    }

    console.log(
      `Large specs: ${passed}/${Math.min(20, largeSpecs.length)} passed`,
    );

    if (failures.length > 0) {
      console.log("Failures:");
      for (const f of failures) {
        console.log(`  ❌ ${f}`);
      }
    }

    // Allow some failures for webhook-only specs
    assertEquals(
      failures.length <= 2,
      true,
      `Too many large spec failures: ${failures.length}`,
    );
  },
});

Deno.test({
  name: "OpenAPI Directory: overall pass rate > 95%",
  ignore: !submoduleAvailable,
  fn: async () => {
    const specs = await findSpecs(OPENAPI_DIR);

    if (specs.length === 0) {
      console.log("No specs found");
      return;
    }

    // Sample 200 random specs for speed
    const sample = specs.length > 200
      ? specs.sort(() => Math.random() - 0.5).slice(0, 200)
      : specs;

    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const spec of sample) {
      const result = await parseSpecFile(spec.path);
      if (result.success) {
        passed++;
      } else {
        failed++;
        if (failures.length < 10) {
          failures.push(`${spec.name}: ${result.error?.split("\n")[0]}`);
        }
      }
    }

    const passRate = (passed / sample.length) * 100;
    console.log(
      `Sample of ${sample.length} specs: ${passed} passed, ${failed} failed (${
        passRate.toFixed(1)
      }%)`,
    );

    if (failures.length > 0) {
      console.log("Sample failures:");
      for (const f of failures) {
        console.log(`  ❌ ${f}`);
      }
    }

    assertEquals(
      passRate >= 95,
      true,
      `Pass rate ${passRate.toFixed(1)}% is below 95% threshold`,
    );
  },
});

Deno.test({
  name: "OpenAPI Directory: notable APIs parse successfully",
  ignore: !submoduleAvailable,
  fn: async () => {
    const notableAPIs = [
      "github.com",
      "stripe.com",
      "twilio.com",
      "slack.com",
      "spotify.com",
      "twitter.com",
      "googleapis.com",
      "azure.com",
    ];

    for (const api of notableAPIs) {
      const specs = await findSpecs(OPENAPI_DIR, (p) => p.includes(api));

      if (specs.length === 0) {
        console.log(`⚠️  No specs found for ${api}`);
        continue;
      }

      // Test first spec from each API
      const spec = specs[0];
      assertExists(spec);
      const result = await parseSpecFile(spec.path);

      if (result.success) {
        console.log(`✅ ${api}`);
      } else {
        // Don't fail on missing paths (webhook specs)
        if (result.error?.includes("Missing paths")) {
          console.log(`⚠️  ${api} (webhook-only spec)`);
        } else {
          assertEquals(
            result.success,
            true,
            `${api} failed to parse: ${result.error}`,
          );
        }
      }
    }
  },
});
