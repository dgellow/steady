/**
 * Tests for param-format.ts
 *
 * Tests shared parameter format parsing logic used by both
 * query parameter validation and form data parsing.
 */

import { assertEquals } from "@std/assert";
import {
  getArrayValues,
  groupFormEntries,
  hasParamValue,
  parseBracketPath,
  parseKeyToPath,
  parseObjectValue,
  resolveArrayFormat,
  resolveObjectFormat,
  setNestedValue,
  wrapURLSearchParams,
} from "./param-format.ts";

// =============================================================================
// resolveArrayFormat
// =============================================================================

Deno.test("resolveArrayFormat: returns format directly if not auto", () => {
  assertEquals(resolveArrayFormat("repeat"), "repeat");
  assertEquals(resolveArrayFormat("comma"), "comma");
  assertEquals(resolveArrayFormat("brackets"), "brackets");
});

Deno.test("resolveArrayFormat: auto defaults to repeat (form + explode)", () => {
  assertEquals(resolveArrayFormat("auto"), "repeat");
});

Deno.test("resolveArrayFormat: auto with style=form explode=true returns repeat", () => {
  assertEquals(
    resolveArrayFormat("auto", {
      name: "x",
      in: "query",
      style: "form",
      explode: true,
    }),
    "repeat",
  );
});

Deno.test("resolveArrayFormat: auto with style=form explode=false returns comma", () => {
  assertEquals(
    resolveArrayFormat("auto", {
      name: "x",
      in: "query",
      style: "form",
      explode: false,
    }),
    "comma",
  );
});

Deno.test("resolveArrayFormat: auto with style=spaceDelimited returns space", () => {
  assertEquals(
    resolveArrayFormat("auto", {
      name: "x",
      in: "query",
      style: "spaceDelimited",
    }),
    "space",
  );
});

Deno.test("resolveArrayFormat: auto with style=pipeDelimited returns pipe", () => {
  assertEquals(
    resolveArrayFormat("auto", {
      name: "x",
      in: "query",
      style: "pipeDelimited",
    }),
    "pipe",
  );
});

// =============================================================================
// resolveObjectFormat
// =============================================================================

Deno.test("resolveObjectFormat: returns format directly if not auto", () => {
  assertEquals(resolveObjectFormat("flat"), "flat");
  assertEquals(resolveObjectFormat("brackets"), "brackets");
  assertEquals(resolveObjectFormat("dots"), "dots");
});

Deno.test("resolveObjectFormat: auto defaults to flat (form + explode)", () => {
  assertEquals(resolveObjectFormat("auto"), "flat");
});

Deno.test("resolveObjectFormat: auto with style=form explode=true returns flat", () => {
  assertEquals(
    resolveObjectFormat("auto", {
      name: "x",
      in: "query",
      style: "form",
      explode: true,
    }),
    "flat",
  );
});

Deno.test("resolveObjectFormat: auto with style=form explode=false returns flat-comma", () => {
  assertEquals(
    resolveObjectFormat("auto", {
      name: "x",
      in: "query",
      style: "form",
      explode: false,
    }),
    "flat-comma",
  );
});

Deno.test("resolveObjectFormat: auto with style=deepObject returns brackets", () => {
  assertEquals(
    resolveObjectFormat("auto", {
      name: "x",
      in: "query",
      style: "deepObject",
    }),
    "brackets",
  );
});

// =============================================================================
// getArrayValues
// =============================================================================

Deno.test("getArrayValues: repeat format gets all values with same key", () => {
  const params = new URLSearchParams("colors=red&colors=green&colors=blue");
  const source = wrapURLSearchParams(params);

  assertEquals(getArrayValues(source, "colors", "repeat"), [
    "red",
    "green",
    "blue",
  ]);
});

Deno.test("getArrayValues: comma format splits single value", () => {
  const params = new URLSearchParams("colors=red,green,blue");
  const source = wrapURLSearchParams(params);

  assertEquals(getArrayValues(source, "colors", "comma"), [
    "red",
    "green",
    "blue",
  ]);
});

Deno.test("getArrayValues: space format splits by space", () => {
  const params = new URLSearchParams("colors=red green blue");
  const source = wrapURLSearchParams(params);

  assertEquals(getArrayValues(source, "colors", "space"), [
    "red",
    "green",
    "blue",
  ]);
});

Deno.test("getArrayValues: pipe format splits by pipe", () => {
  const params = new URLSearchParams("colors=red|green|blue");
  const source = wrapURLSearchParams(params);

  assertEquals(getArrayValues(source, "colors", "pipe"), [
    "red",
    "green",
    "blue",
  ]);
});

Deno.test("getArrayValues: brackets format gets values with [] suffix", () => {
  const params = new URLSearchParams(
    "colors[]=red&colors[]=green&colors[]=blue",
  );
  const source = wrapURLSearchParams(params);

  assertEquals(getArrayValues(source, "colors", "brackets"), [
    "red",
    "green",
    "blue",
  ]);
});

Deno.test("getArrayValues: returns empty array if key not found", () => {
  const params = new URLSearchParams("other=value");
  const source = wrapURLSearchParams(params);

  assertEquals(getArrayValues(source, "colors", "repeat"), []);
  assertEquals(getArrayValues(source, "colors", "comma"), []);
  assertEquals(getArrayValues(source, "colors", "brackets"), []);
});

// =============================================================================
// hasParamValue
// =============================================================================

Deno.test("hasParamValue: detects simple param", () => {
  const params = new URLSearchParams("name=sam");
  const source = wrapURLSearchParams(params);

  assertEquals(
    hasParamValue(source, "name", false, false, "repeat", "flat"),
    true,
  );
  assertEquals(
    hasParamValue(source, "other", false, false, "repeat", "flat"),
    false,
  );
});

Deno.test("hasParamValue: detects array with repeat format", () => {
  const params = new URLSearchParams("tags=a&tags=b");
  const source = wrapURLSearchParams(params);

  assertEquals(
    hasParamValue(source, "tags", true, false, "repeat", "flat"),
    true,
  );
});

Deno.test("hasParamValue: detects array with brackets format", () => {
  const params = new URLSearchParams("tags[]=a&tags[]=b");
  const source = wrapURLSearchParams(params);

  assertEquals(
    hasParamValue(source, "tags", true, false, "brackets", "flat"),
    true,
  );
});

Deno.test("hasParamValue: detects object with brackets format", () => {
  const params = new URLSearchParams("user[name]=sam");
  const source = wrapURLSearchParams(params);

  assertEquals(
    hasParamValue(source, "user", false, true, "repeat", "brackets"),
    true,
  );
  assertEquals(
    hasParamValue(source, "other", false, true, "repeat", "brackets"),
    false,
  );
});

Deno.test("hasParamValue: detects object with dots format", () => {
  const params = new URLSearchParams("user.name=sam");
  const source = wrapURLSearchParams(params);

  assertEquals(
    hasParamValue(source, "user", false, true, "repeat", "dots"),
    true,
  );
  assertEquals(
    hasParamValue(source, "other", false, true, "repeat", "dots"),
    false,
  );
});

// =============================================================================
// parseBracketPath
// =============================================================================

Deno.test("parseBracketPath: extracts single segment", () => {
  assertEquals(parseBracketPath("user[name]", "user"), ["name"]);
});

Deno.test("parseBracketPath: extracts multiple segments", () => {
  assertEquals(parseBracketPath("user[address][city]", "user"), [
    "address",
    "city",
  ]);
});

Deno.test("parseBracketPath: handles numeric indices", () => {
  assertEquals(parseBracketPath("items[0]", "items"), ["0"]);
  assertEquals(parseBracketPath("items[0][name]", "items"), ["0", "name"]);
});

Deno.test("parseBracketPath: returns empty for non-matching base", () => {
  assertEquals(parseBracketPath("other[name]", "user"), []);
});

Deno.test("parseBracketPath: handles empty brackets", () => {
  assertEquals(parseBracketPath("tags[]", "tags"), [""]);
});

// =============================================================================
// setNestedValue
// =============================================================================

Deno.test("setNestedValue: sets simple path", () => {
  const obj: Record<string, unknown> = Object.create(null);
  setNestedValue(obj, ["name"], "sam");

  assertEquals(obj, { name: "sam" });
});

Deno.test("setNestedValue: creates nested objects", () => {
  const obj: Record<string, unknown> = Object.create(null);
  setNestedValue(obj, ["user", "name"], "sam");

  assertEquals(obj, { user: { name: "sam" } });
});

Deno.test("setNestedValue: creates deeply nested objects", () => {
  const obj: Record<string, unknown> = Object.create(null);
  setNestedValue(obj, ["user", "address", "city"], "NYC");

  assertEquals(obj, { user: { address: { city: "NYC" } } });
});

Deno.test("setNestedValue: creates arrays for numeric indices", () => {
  const obj: Record<string, unknown> = Object.create(null);
  setNestedValue(obj, ["items", "0"], "first");
  setNestedValue(obj, ["items", "1"], "second");

  assertEquals(obj, { items: ["first", "second"] });
});

Deno.test("setNestedValue: handles empty path", () => {
  const obj: Record<string, unknown> = Object.create(null);
  setNestedValue(obj, [], "value");

  assertEquals(obj, {});
});

// =============================================================================
// parseObjectValue
// =============================================================================

Deno.test("parseObjectValue: flat format returns single value", () => {
  const params = new URLSearchParams("id=123");
  const source = wrapURLSearchParams(params);

  assertEquals(parseObjectValue(source, "id", "flat"), { id: "123" });
});

Deno.test("parseObjectValue: flat-comma format parses key-value pairs", () => {
  const params = new URLSearchParams("id=role,admin,firstName,Alex");
  const source = wrapURLSearchParams(params);

  assertEquals(parseObjectValue(source, "id", "flat-comma"), {
    role: "admin",
    firstName: "Alex",
  });
});

Deno.test("parseObjectValue: brackets format parses nested keys", () => {
  const params = new URLSearchParams("id[role]=admin&id[firstName]=Alex");
  const source = wrapURLSearchParams(params);

  assertEquals(parseObjectValue(source, "id", "brackets"), {
    role: "admin",
    firstName: "Alex",
  });
});

Deno.test("parseObjectValue: brackets format handles deeply nested", () => {
  const params = new URLSearchParams(
    "user[address][city]=NYC&user[address][zip]=10001",
  );
  const source = wrapURLSearchParams(params);

  assertEquals(parseObjectValue(source, "user", "brackets"), {
    address: { city: "NYC", zip: "10001" },
  });
});

Deno.test("parseObjectValue: dots format parses nested keys", () => {
  const params = new URLSearchParams("id.role=admin&id.firstName=Alex");
  const source = wrapURLSearchParams(params);

  assertEquals(parseObjectValue(source, "id", "dots"), {
    role: "admin",
    firstName: "Alex",
  });
});

Deno.test("parseObjectValue: dots format handles deeply nested", () => {
  const params = new URLSearchParams(
    "user.address.city=NYC&user.address.zip=10001",
  );
  const source = wrapURLSearchParams(params);

  assertEquals(parseObjectValue(source, "user", "dots"), {
    address: { city: "NYC", zip: "10001" },
  });
});

// =============================================================================
// groupFormEntries
// =============================================================================

Deno.test("groupFormEntries: groups repeated keys", () => {
  const entries: [string, string][] = [
    ["tags", "red"],
    ["tags", "green"],
    ["name", "sam"],
  ];

  const { groups, explicitArrays } = groupFormEntries(entries, "repeat");

  assertEquals(groups.get("tags"), ["red", "green"]);
  assertEquals(groups.get("name"), ["sam"]);
  assertEquals(explicitArrays.size, 0);
});

Deno.test("groupFormEntries: brackets format normalizes array keys", () => {
  const entries: [string, string][] = [
    ["tags[]", "red"],
    ["tags[]", "green"],
    ["name", "sam"],
  ];

  const { groups, explicitArrays } = groupFormEntries(entries, "brackets");

  assertEquals(groups.get("tags"), ["red", "green"]);
  assertEquals(groups.get("name"), ["sam"]);
  assertEquals(explicitArrays.has("tags"), true);
  assertEquals(explicitArrays.has("name"), false);
});

Deno.test("groupFormEntries: brackets format tracks single value arrays", () => {
  const entries: [string, string][] = [
    ["include[]", "logprobs"],
  ];

  const { groups, explicitArrays } = groupFormEntries(entries, "brackets");

  assertEquals(groups.get("include"), ["logprobs"]);
  assertEquals(explicitArrays.has("include"), true);
});

// =============================================================================
// parseKeyToPath
// =============================================================================

Deno.test("parseKeyToPath: flat format returns single-element array", () => {
  assertEquals(parseKeyToPath("name", "flat"), ["name"]);
  assertEquals(parseKeyToPath("user[name]", "flat"), ["user[name]"]);
  assertEquals(parseKeyToPath("user.name", "flat"), ["user.name"]);
});

Deno.test("parseKeyToPath: flat-comma format returns single-element array", () => {
  assertEquals(parseKeyToPath("id", "flat-comma"), ["id"]);
  assertEquals(parseKeyToPath("user[name]", "flat-comma"), ["user[name]"]);
});

Deno.test("parseKeyToPath: brackets format parses nested keys", () => {
  assertEquals(parseKeyToPath("user", "brackets"), ["user"]);
  assertEquals(parseKeyToPath("user[name]", "brackets"), ["user", "name"]);
  assertEquals(parseKeyToPath("user[address][city]", "brackets"), [
    "user",
    "address",
    "city",
  ]);
});

Deno.test("parseKeyToPath: brackets format handles numeric indices", () => {
  assertEquals(parseKeyToPath("items[0]", "brackets"), ["items", "0"]);
  assertEquals(parseKeyToPath("items[0][name]", "brackets"), [
    "items",
    "0",
    "name",
  ]);
});

Deno.test("parseKeyToPath: brackets format handles empty brackets", () => {
  assertEquals(parseKeyToPath("tags[]", "brackets"), ["tags", ""]);
});

Deno.test("parseKeyToPath: dots format splits by dots", () => {
  assertEquals(parseKeyToPath("user", "dots"), ["user"]);
  assertEquals(parseKeyToPath("user.name", "dots"), ["user", "name"]);
  assertEquals(parseKeyToPath("user.address.city", "dots"), [
    "user",
    "address",
    "city",
  ]);
});

console.log("param-format tests loaded");
