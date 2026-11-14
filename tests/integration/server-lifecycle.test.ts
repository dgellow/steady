/**
 * A server that has stopped must leave nothing behind. With --auto-reload
 * the process starts a new server for every change of the spec; whatever a
 * stopped server keeps registered accumulates, and a shutdown signal would
 * reach every server that ever ran.
 *
 * These tests run with Deno's default sanitizers: a listener or operation
 * left behind by start() fails them.
 */

import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { parseSpec } from "../../packages/openapi/parser.ts";
import { analyzeSpec } from "../../src/engine/spec-analyzer.ts";
import { MockServer } from "../../src/server/mod.ts";

async function newServer(): Promise<MockServer> {
  const { spec, defaultedFields } = await parseSpec(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "lifecycle", version: "1" },
      paths: {
        "/ping": { get: { responses: { "200": { description: "ok" } } } },
      },
    }),
    { format: "json" },
  );
  const analysis = analyzeSpec(spec, {
    baseUri: "file:///lifecycle.json",
    defaultedFields,
  });
  return new MockServer(spec, {
    port: 0,
    host: "127.0.0.1",
    quiet: true,
    logLevel: "summary",
    startupDiagnostics: analysis.diagnostics,
    specPath: "lifecycle.json",
  }, analysis.docIndex);
}

Deno.test("MockServer: stop() removes every signal listener start() added", async () => {
  const added: [Deno.Signal, () => void][] = [];
  const removed: [Deno.Signal, () => void][] = [];
  const addStub = stub(
    Deno,
    "addSignalListener",
    (signal: Deno.Signal, handler: () => void) => {
      added.push([signal, handler]);
    },
  );
  const removeStub = stub(
    Deno,
    "removeSignalListener",
    (signal: Deno.Signal, handler: () => void) => {
      removed.push([signal, handler]);
    },
  );
  try {
    const server = await newServer();
    await server.start();
    assertEquals(added.map(([signal]) => signal), [
      "SIGINT",
      "SIGTERM",
      "SIGHUP",
      "SIGQUIT",
    ]);
    await server.stop();
    // The same signals with the same handler functions.
    assertEquals(removed.length, added.length);
    for (const [signal, handler] of added) {
      assertEquals(
        removed.some(([s, h]) => s === signal && h === handler),
        true,
        `listener for ${signal} was not removed`,
      );
    }
  } finally {
    addStub.restore();
    removeStub.restore();
  }
});

Deno.test("MockServer: start, request, stop leaves nothing behind", async () => {
  const server = await newServer();
  const port = await server.start();
  const response = await fetch(`http://127.0.0.1:${port}/ping`);
  await response.body?.cancel();
  assertEquals(response.status, 200);
  await server.stop();
});

Deno.test("MockServer: stop() twice is harmless", async () => {
  const server = await newServer();
  await server.start();
  await server.stop();
  await server.stop();
});
