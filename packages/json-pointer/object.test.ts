import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { getOwn, hasOwn } from "./object.ts";
import { exists, JsonPointerError, resolve, set } from "./json-pointer.ts";

const INHERITED_NAMES = [
  "toString",
  "constructor",
  "hasOwnProperty",
  "valueOf",
  "__proto__",
];

Deno.test("hasOwn / getOwn - inherited members are not members of the map", () => {
  const map: Record<string, number> = { a: 1 };
  assertEquals(hasOwn(map, "a"), true);
  assertEquals(getOwn(map, "a"), 1);
  for (const name of INHERITED_NAMES) {
    assertEquals(hasOwn(map, name), false, name);
    assertEquals(getOwn(map, name), undefined, name);
  }
});

Deno.test("hasOwn / getOwn - a member with an inherited name is found", () => {
  // JSON.parse stores "__proto__" as an ordinary member.
  const map: Record<string, unknown> = JSON.parse(
    '{"toString":1,"constructor":2,"__proto__":3}',
  );
  assertEquals(getOwn(map, "toString"), 1);
  assertEquals(getOwn(map, "constructor"), 2);
  assertEquals(getOwn(map, "__proto__"), 3);
});

Deno.test("hasOwn / getOwn - maps without a prototype", () => {
  const map: Record<string, number> = Object.create(null);
  map.a = 1;
  assertEquals(hasOwn(map, "a"), true);
  assertEquals(getOwn(map, "toString"), undefined);
});

Deno.test("resolve - an inherited name is not a member of the document", () => {
  const doc = { components: { schemas: { User: { type: "object" } } } };
  for (const name of INHERITED_NAMES) {
    assertThrows(() => resolve(doc, `/${name}`), JsonPointerError);
    assertThrows(
      () => resolve(doc, `/components/schemas/${name}`),
      JsonPointerError,
    );
    assertEquals(exists(doc, `/components/schemas/${name}`), false, name);
  }
});

Deno.test("resolve - a member with an inherited name resolves", () => {
  const doc = JSON.parse(
    '{"schemas":{"constructor":{"type":"string"},"__proto__":{"type":"number"}}}',
  );
  assertEquals(resolve(doc, "/schemas/constructor"), { type: "string" });
  assertEquals(resolve(doc, "/schemas/__proto__"), { type: "number" });
});

Deno.test("set - cannot walk into or replace a prototype", () => {
  const doc: Record<string, unknown> = { a: {} };

  // Walking through an inherited name fails like any missing member.
  assertThrows(() => set(doc, "/__proto__/polluted", true), JsonPointerError);
  assertThrows(() => set(doc, "/constructor/prototype/x", 1), JsonPointerError);
  assertEquals(Object.hasOwn(Object.prototype, "polluted"), false);

  // A final segment named __proto__ becomes an ordinary member.
  set(doc, "/a/__proto__", { injected: true });
  const a = doc.a;
  assertStrictEquals(Object.getPrototypeOf(a), Object.prototype);
  assertEquals(hasOwn(Object(a), "__proto__"), true);
  assertEquals(resolve(doc, "/a/__proto__"), { injected: true });
});
