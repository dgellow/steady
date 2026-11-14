import { assertEquals } from "@std/assert";
import { inspectDocument } from "./document-shape.ts";

Deno.test("inspectDocument: a tree", () => {
  const shape = inspectDocument({ a: { b: [1, { c: "x" }] }, d: null });
  assertEquals(shape.cycle, undefined);
  // root, a, b (array), {c}
  assertEquals(shape.nodes, 4);
  assertEquals(shape.expandedNodes, 4);
  assertEquals(shape.depth, 3);
  assertEquals(shape.deepestPath, ["a", "b", "1"]);
});

Deno.test("inspectDocument: primitives have no nodes", () => {
  for (const value of [null, 1, "x", true, undefined]) {
    const shape = inspectDocument(value);
    assertEquals(shape.nodes, 0);
    assertEquals(shape.expandedNodes, 0);
    assertEquals(shape.depth, 0);
    assertEquals(shape.deepestPath, []);
  }
});

Deno.test("inspectDocument: a shared node counts once in nodes, once per path in expandedNodes", () => {
  const shared = { leaf: {} };
  const shape = inspectDocument({ p: shared, q: shared });
  // root, shared, leaf
  assertEquals(shape.nodes, 3);
  // root + 2 * (shared + leaf)
  assertEquals(shape.expandedNodes, 5);
  assertEquals(shape.depth, 2);
  assertEquals(shape.cycle, undefined);
});

Deno.test("inspectDocument: alias fan-out is measured without being expanded", () => {
  // 60 levels, each using the previous one twice: 2^61 - 1 nodes as a tree.
  let node: Record<string, unknown> = {};
  for (let i = 0; i < 60; i++) node = { p: node, q: node };
  const start = performance.now();
  const shape = inspectDocument(node);
  assertEquals(shape.nodes, 61);
  assertEquals(shape.expandedNodes, 2 ** 61 - 1);
  assertEquals(shape.depth, 60);
  // Linear in the number of distinct nodes.
  assertEquals(performance.now() - start < 100, true);
});

Deno.test("inspectDocument: expansion beyond the range of a number saturates", () => {
  let node: Record<string, unknown> = {};
  for (let i = 0; i < 2000; i++) node = { p: node, q: node };
  assertEquals(inspectDocument(node).expandedNodes, Infinity);
});

Deno.test("inspectDocument: a node that contains itself is reported with both paths", () => {
  const loop: Record<string, unknown> = { name: "x" };
  loop.self = loop;
  const shape = inspectDocument({ a: [loop] });
  assertEquals(shape.cycle, {
    path: ["a", "0", "self"],
    ancestor: ["a", "0"],
  });
});

Deno.test("inspectDocument: a longer cycle through an array", () => {
  const a: Record<string, unknown> = {};
  const b: unknown[] = [a];
  a.next = { list: b };
  const shape = inspectDocument({ start: a });
  assertEquals(shape.cycle, {
    path: ["start", "next", "list", "0"],
    ancestor: ["start"],
  });
});

Deno.test("inspectDocument: two references to one node are not a cycle", () => {
  const shared = { x: 1 };
  const shape = inspectDocument({ a: shared, b: { c: shared } });
  assertEquals(shape.cycle, undefined);
});

Deno.test("inspectDocument: depth far beyond the call stack", () => {
  let node: unknown = {};
  for (let i = 0; i < 200_000; i++) node = { a: node };
  const shape = inspectDocument(node);
  assertEquals(shape.depth, 200_000);
  assertEquals(shape.nodes, 200_001);
  assertEquals(shape.deepestPath.length, 200_000);
});

Deno.test("inspectDocument: the deepest path goes through a shared node", () => {
  const deep = { x: { y: {} } };
  const shape = inspectDocument({ first: {}, second: deep, third: deep });
  assertEquals(shape.depth, 3);
  assertEquals(shape.deepestPath, ["second", "x", "y"]);
});
