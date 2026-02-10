/**
 * End-to-end CLI tests.
 *
 * Each test spawns `cmd/steady.ts` as a subprocess via Deno.Command,
 * then asserts on exit code, stdout, and stderr.
 */

import { assert, assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";

// ── Helpers ─────────────────────────────────────────────────────────

/** Write a temp spec file, run a callback, clean up. */
async function withTempSpec(
  content: string,
  fn: (specPath: string) => Promise<void>,
): Promise<void> {
  const tmp = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(tmp, content);
    await fn(tmp);
  } finally {
    try {
      await Deno.remove(tmp);
    } catch {
      // best-effort cleanup
    }
  }
}

/** Spawn `cmd/steady.ts` with given args, return exit code + output. */
async function runCli(
  args: string[],
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "--allow-env",
      "cmd/steady.ts",
      ...args,
    ],
    env,
    stdout: "piped",
    stderr: "piped",
  });

  const output = await cmd.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

/** Wait for a server to accept connections, with retries. */
async function waitForServer(
  port: number,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://localhost:${port}/_x-steady/health`);
      await resp.body?.cancel();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

// ── Validate command tests ──────────────────────────────────────────

Deno.test("validate: clean spec → exit 0, 'All good'", async () => {
  const spec = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Clean", version: "1.0.0" },
    paths: {
      "/health": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  await withTempSpec(spec, async (path) => {
    const result = await runCli(["validate", path]);
    assertEquals(result.code, 0);
    assert(result.stdout.includes("All good"), `stdout: ${result.stdout}`);
  });
});

Deno.test("validate: unresolved $ref → exit 3, shows E1004", async () => {
  const spec = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Bad Ref", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Ghost" },
                },
              },
            },
          },
        },
      },
    },
  });

  await withTempSpec(spec, async (path) => {
    const result = await runCli(["validate", path]);
    assertEquals(result.code, 3);
    assert(result.stderr.includes("E1004"), `stderr: ${result.stderr}`);
  });
});

Deno.test("validate: non-fatal warnings → exit 0, shows diagnostics", async () => {
  const spec = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Warnings", version: "1.0.0" },
    paths: {
      "/users/{id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/users/{userId}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  await withTempSpec(spec, async (path) => {
    const result = await runCli(["validate", path]);
    assertEquals(result.code, 0);
    assert(result.stderr.includes("E1008"), `stderr: ${result.stderr}`);
    assert(result.stderr.includes("warning"), `stderr: ${result.stderr}`);
  });
});

// ── Snapshot tests (NO_COLOR) ────────────────────────────────────────

Deno.test("validate: clean spec → snapshot stdout", async (t) => {
  const spec = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Clean", version: "1.0.0" },
    paths: {
      "/health": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  await withTempSpec(spec, async (path) => {
    const result = await runCli(["validate", path], { NO_COLOR: "1" });
    assertEquals(result.code, 0);
    await assertSnapshot(t, result.stdout);
  });
});

Deno.test("validate: fatal spec → snapshot stderr", async (t) => {
  const spec = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Bad Ref", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Ghost" },
                },
              },
            },
          },
        },
      },
    },
  });

  await withTempSpec(spec, async (path) => {
    const result = await runCli(["validate", path], { NO_COLOR: "1" });
    assertEquals(result.code, 3);
    await assertSnapshot(t, result.stderr);
  });
});

Deno.test("validate: warnings → snapshot stderr", async (t) => {
  const spec = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Warnings", version: "1.0.0" },
    paths: {
      "/users/{id}": {
        get: { responses: { "200": { description: "OK" } } },
      },
      "/users/{userId}": {
        get: { responses: { "200": { description: "OK" } } },
      },
    },
  });

  await withTempSpec(spec, async (path) => {
    const result = await runCli(["validate", path], { NO_COLOR: "1" });
    assertEquals(result.code, 0);
    await assertSnapshot(t, result.stderr);
  });
});

// ── Server start tests ──────────────────────────────────────────────

Deno.test("server: fatal spec → exit 3, stderr has E1004", async () => {
  const spec = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Bad Ref", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Ghost" },
                },
              },
            },
          },
        },
      },
    },
  });

  await withTempSpec(spec, async (path) => {
    const result = await runCli([path]);
    assertEquals(result.code, 3);
    assert(result.stderr.includes("E1004"), `stderr: ${result.stderr}`);
    assert(
      result.stderr.includes("cannot load this spec"),
      `stderr: ${result.stderr}`,
    );
  });
});

Deno.test("server: clean spec → starts and accepts requests", async () => {
  const port = 5199;
  await withTempSpec(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Clean", version: "1.0.0" },
      paths: {
        "/health": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    }),
    async (path) => {
      const cmd = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-net",
          "--allow-env",
          "cmd/steady.ts",
          "--port",
          String(port),
          path,
        ],
        stdout: "null",
        stderr: "null",
      });
      const process = cmd.spawn();

      try {
        const ready = await waitForServer(port);
        assert(ready, "Server did not start within timeout");

        // Verify it responds to requests
        const resp = await fetch(`http://localhost:${port}/_x-steady/health`);
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.status, "healthy");
      } finally {
        try {
          process.kill("SIGTERM");
        } catch {
          // already dead
        }
        // Wait for process to fully exit to avoid resource leaks
        await process.status;
      }
    },
  );
});
