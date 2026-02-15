/**
 * Unit tests for the containment-aware cycle detection algorithm.
 * Tests the algorithm in isolation, independent of the processor.
 */

import { assertEquals } from "@std/assert";
import { computeCyclicRefs, sourceNodeFor } from "./cycle-detection.ts";

// --- sourceNodeFor tests ---

Deno.test("sourceNodeFor - root pointer", () => {
  assertEquals(sourceNodeFor("#"), "#");
});

Deno.test("sourceNodeFor - property path returns as-is", () => {
  assertEquals(sourceNodeFor("#/properties/name"), "#/properties/name");
});

Deno.test("sourceNodeFor - $defs entry returns definition path", () => {
  assertEquals(sourceNodeFor("#/$defs/User"), "#/$defs/User");
});

Deno.test("sourceNodeFor - nested inside $defs returns definition path", () => {
  assertEquals(
    sourceNodeFor("#/$defs/User/properties/name"),
    "#/$defs/User",
  );
});

Deno.test("sourceNodeFor - deeply nested $defs returns innermost", () => {
  assertEquals(
    sourceNodeFor("#/$defs/Outer/$defs/Inner/properties/x"),
    "#/$defs/Outer/$defs/Inner",
  );
});

// --- computeCyclicRefs tests ---

Deno.test("computeCyclicRefs - direct self-reference { $ref: '#' }", () => {
  // Schema: { $ref: "#" }
  // RefGraph edge: # -> #
  const edges = new Map<string, Set<string>>([
    ["#", new Set(["#"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.has("#"), true);
  assertEquals(cyclic.size, 1);
});

Deno.test("computeCyclicRefs - property references parent", () => {
  // Schema: { properties: { self: { $ref: "#" } } }
  // RefGraph edge: #/properties/self -> #
  const edges = new Map<string, Set<string>>([
    ["#/properties/self", new Set(["#"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.has("#"), true);
  assertEquals(cyclic.has("#/properties/self"), true);
  assertEquals(cyclic.size, 2);
});

Deno.test("computeCyclicRefs - two-step $defs cycle", () => {
  // A -> B, B -> A
  const edges = new Map<string, Set<string>>([
    ["#/$defs/A", new Set(["#/$defs/B"])],
    ["#/$defs/B", new Set(["#/$defs/A"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.has("#/$defs/A"), true);
  assertEquals(cyclic.has("#/$defs/B"), true);
});

Deno.test("computeCyclicRefs - three-step $defs cycle", () => {
  // A -> B, B -> C, C -> A
  const edges = new Map<string, Set<string>>([
    ["#/$defs/A", new Set(["#/$defs/B"])],
    ["#/$defs/B", new Set(["#/$defs/C"])],
    ["#/$defs/C", new Set(["#/$defs/A"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.has("#/$defs/A"), true);
  assertEquals(cyclic.has("#/$defs/B"), true);
  assertEquals(cyclic.has("#/$defs/C"), true);
});

Deno.test("computeCyclicRefs - no cycle with forward refs", () => {
  // A -> StringType, B -> NumberType (no cycles)
  const edges = new Map<string, Set<string>>([
    ["#/properties/a", new Set(["#/$defs/StringType"])],
    ["#/properties/b", new Set(["#/$defs/NumberType"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.size, 0);
});

Deno.test("computeCyclicRefs - allOf containment cycle", () => {
  // Schema: { allOf: [{ properties: { parent: { $ref: "#" } } }] }
  // Edge: #/allOf/0/properties/parent -> #
  const edges = new Map<string, Set<string>>([
    ["#/allOf/0/properties/parent", new Set(["#"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.has("#"), true);
  assertEquals(cyclic.has("#/allOf/0/properties/parent"), true);
});

Deno.test("computeCyclicRefs - $defs cycle with nested ref pointers", () => {
  // A's ref is inside A's allOf, B's ref is inside B's properties
  // A (via allOf/0) -> B, B (via properties/a) -> A
  const edges = new Map<string, Set<string>>([
    ["#/$defs/A/allOf/0", new Set(["#/$defs/B"])],
    ["#/$defs/B/properties/a", new Set(["#/$defs/A"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.has("#/$defs/A"), true);
  assertEquals(cyclic.has("#/$defs/B"), true);
  // The actual ref pointer locations should also be marked cyclic
  assertEquals(cyclic.has("#/$defs/A/allOf/0"), true);
  assertEquals(cyclic.has("#/$defs/B/properties/a"), true);
});

Deno.test("computeCyclicRefs - recursive Person schema", () => {
  // Person has spouse -> Person and children/items -> Person (self-referential def)
  const edges = new Map<string, Set<string>>([
    ["#/$defs/Person/properties/spouse", new Set(["#/$defs/Person"])],
    [
      "#/$defs/Person/properties/children/items",
      new Set(["#/$defs/Person"]),
    ],
  ]);

  const cyclic = computeCyclicRefs(edges);
  // Person references itself (self-loop at def level)
  assertEquals(cyclic.has("#/$defs/Person"), true);
});

Deno.test("computeCyclicRefs - mixed cyclic and non-cyclic", () => {
  // A -> B -> A (cycle), C -> D (no cycle)
  const edges = new Map<string, Set<string>>([
    ["#/$defs/A", new Set(["#/$defs/B"])],
    ["#/$defs/B", new Set(["#/$defs/A"])],
    ["#/$defs/C", new Set(["#/$defs/D"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.has("#/$defs/A"), true);
  assertEquals(cyclic.has("#/$defs/B"), true);
  assertEquals(cyclic.has("#/$defs/C"), false);
  assertEquals(cyclic.has("#/$defs/D"), false);
});

Deno.test("computeCyclicRefs - empty edges", () => {
  const edges = new Map<string, Set<string>>();
  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.size, 0);
});

Deno.test("computeCyclicRefs - root ref to $defs with back-ref to root", () => {
  // Root refs A, A refs root back
  const edges = new Map<string, Set<string>>([
    ["#", new Set(["#/$defs/A"])],
    ["#/$defs/A/allOf/0", new Set(["#"])],
  ]);

  const cyclic = computeCyclicRefs(edges);
  assertEquals(cyclic.has("#"), true);
  assertEquals(cyclic.has("#/$defs/A"), true);
});
