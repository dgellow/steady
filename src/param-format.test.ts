/**
 * Tests for param-format.ts
 *
 * Tests shared parameter format parsing logic used by both
 * query parameter validation and form data parsing.
 */

import { assertEquals } from "@std/assert";
import {
  type FormFormat,
  getArrayValues,
  hasParamValue,
  parseFormEntries,
  parseKeySegments,
  parseObjectValue,
  resolveArrayFormat,
  resolveObjectFormat,
  setNestedValue,
  wrapURLSearchParams,
} from "./param-format.ts";
import type { Schema } from "@steady/json-schema";

const BRACKETS: FormFormat = { array: "brackets", object: "brackets" };

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
  assertEquals(resolveArrayFormat("auto", "form", true), "repeat");
});

Deno.test("resolveArrayFormat: auto with style=form explode=false returns comma", () => {
  assertEquals(resolveArrayFormat("auto", "form", false), "comma");
});

Deno.test("resolveArrayFormat: auto with style=spaceDelimited returns space", () => {
  assertEquals(resolveArrayFormat("auto", "spaceDelimited"), "space");
});

Deno.test("resolveArrayFormat: auto with style=pipeDelimited returns pipe", () => {
  assertEquals(resolveArrayFormat("auto", "pipeDelimited"), "pipe");
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
  assertEquals(resolveObjectFormat("auto", "form", true), "flat");
});

Deno.test("resolveObjectFormat: auto with style=form explode=false returns flat-comma", () => {
  assertEquals(resolveObjectFormat("auto", "form", false), "flat-comma");
});

Deno.test("resolveObjectFormat: auto with style=deepObject returns brackets", () => {
  assertEquals(resolveObjectFormat("auto", "deepObject"), "brackets");
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

Deno.test("hasParamValue: scalar encoding", () => {
  const source = wrapURLSearchParams(new URLSearchParams("name=sam"));

  assertEquals(hasParamValue(source, "name", { kind: "scalar" }), true);
  assertEquals(hasParamValue(source, "other", { kind: "scalar" }), false);
});

Deno.test("hasParamValue: flat-array repeat format", () => {
  const source = wrapURLSearchParams(new URLSearchParams("tags=a&tags=b"));

  assertEquals(
    hasParamValue(source, "tags", { kind: "flat-array", arrayFmt: "repeat" }),
    true,
  );
});

Deno.test("hasParamValue: flat-array brackets format", () => {
  const source = wrapURLSearchParams(
    new URLSearchParams("tags[]=a&tags[]=b"),
  );

  assertEquals(
    hasParamValue(source, "tags", {
      kind: "flat-array",
      arrayFmt: "brackets",
    }),
    true,
  );
});

Deno.test("hasParamValue: nested brackets format", () => {
  const source = wrapURLSearchParams(new URLSearchParams("user[name]=sam"));

  assertEquals(
    hasParamValue(source, "user", { kind: "nested", objectFmt: "brackets" }),
    true,
  );
  assertEquals(
    hasParamValue(source, "other", { kind: "nested", objectFmt: "brackets" }),
    false,
  );
});

Deno.test("hasParamValue: nested dots format", () => {
  const source = wrapURLSearchParams(new URLSearchParams("user.name=sam"));

  assertEquals(
    hasParamValue(source, "user", { kind: "nested", objectFmt: "dots" }),
    true,
  );
  assertEquals(
    hasParamValue(source, "other", { kind: "nested", objectFmt: "dots" }),
    false,
  );
});

Deno.test("hasParamValue: flat-object flat format", () => {
  const source = wrapURLSearchParams(new URLSearchParams("user=sam"));

  assertEquals(
    hasParamValue(source, "user", { kind: "flat-object", objectFmt: "flat" }),
    true,
  );
});

Deno.test("hasParamValue: flat-object flat-comma format", () => {
  const source = wrapURLSearchParams(
    new URLSearchParams("user=name,sam,age,30"),
  );

  assertEquals(
    hasParamValue(source, "user", {
      kind: "flat-object",
      objectFmt: "flat-comma",
    }),
    true,
  );
  // No comma = not detected as flat-comma
  const source2 = wrapURLSearchParams(new URLSearchParams("user=sam"));
  assertEquals(
    hasParamValue(source2, "user", {
      kind: "flat-object",
      objectFmt: "flat-comma",
    }),
    false,
  );
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
// parseKeySegments
// =============================================================================

Deno.test("parseKeySegments: flat format treats key as literal single segment", () => {
  assertEquals(parseKeySegments("name", "flat", "repeat"), [
    { type: "key", name: "name" },
  ]);
  assertEquals(parseKeySegments("user[name]", "flat", "repeat"), [
    { type: "key", name: "user[name]" },
  ]);
  assertEquals(parseKeySegments("user.name", "flat", "repeat"), [
    { type: "key", name: "user.name" },
  ]);
});

Deno.test("parseKeySegments: flat-comma format treats key as literal single segment", () => {
  assertEquals(parseKeySegments("id", "flat-comma", "repeat"), [
    { type: "key", name: "id" },
  ]);
  assertEquals(parseKeySegments("user[name]", "flat-comma", "repeat"), [
    { type: "key", name: "user[name]" },
  ]);
});

Deno.test("parseKeySegments: brackets format parses nested keys", () => {
  assertEquals(parseKeySegments("user", "brackets", "brackets"), [
    { type: "key", name: "user" },
  ]);
  assertEquals(parseKeySegments("user[name]", "brackets", "brackets"), [
    { type: "key", name: "user" },
    { type: "key", name: "name" },
  ]);
  assertEquals(
    parseKeySegments("user[address][city]", "brackets", "brackets"),
    [
      { type: "key", name: "user" },
      { type: "key", name: "address" },
      { type: "key", name: "city" },
    ],
  );
});

Deno.test("parseKeySegments: brackets format handles numeric indices", () => {
  assertEquals(parseKeySegments("items[0]", "brackets", "brackets"), [
    { type: "key", name: "items" },
    { type: "index", index: 0 },
  ]);
  assertEquals(parseKeySegments("items[0][name]", "brackets", "brackets"), [
    { type: "key", name: "items" },
    { type: "index", index: 0 },
    { type: "key", name: "name" },
  ]);
});

Deno.test("parseKeySegments: brackets format handles empty brackets as append", () => {
  assertEquals(parseKeySegments("tags[]", "brackets", "brackets"), [
    { type: "key", name: "tags" },
    { type: "append" },
  ]);
});

Deno.test("parseKeySegments: dots format splits by dots", () => {
  assertEquals(parseKeySegments("user", "dots", "repeat"), [
    { type: "key", name: "user" },
  ]);
  assertEquals(parseKeySegments("user.name", "dots", "repeat"), [
    { type: "key", name: "user" },
    { type: "key", name: "name" },
  ]);
  assertEquals(parseKeySegments("user.address.city", "dots", "repeat"), [
    { type: "key", name: "user" },
    { type: "key", name: "address" },
    { type: "key", name: "city" },
  ]);
});

Deno.test("parseKeySegments: flat object + brackets array recognises `[]` append marker", () => {
  assertEquals(parseKeySegments("tags[]", "flat", "brackets"), [
    { type: "key", name: "tags" },
    { type: "append" },
  ]);
});

Deno.test("parseKeySegments: dots object + brackets array recognises trailing `[]`", () => {
  assertEquals(parseKeySegments("user.tags[]", "dots", "brackets"), [
    { type: "key", name: "user" },
    { type: "key", name: "tags" },
    { type: "append" },
  ]);
});

Deno.test("parseKeySegments: flat object + repeat array treats `[]` as literal", () => {
  assertEquals(parseKeySegments("tags[]", "flat", "repeat"), [
    { type: "key", name: "tags[]" },
  ]);
});

// =============================================================================
// parseFormEntries: schema-driven bracket parsing
// =============================================================================

const filterSchema: Schema = {
  type: "object",
  properties: {
    item_id: {
      type: "object",
      properties: { eq: { type: "string" } },
    },
    type: {
      type: "object",
      properties: {
        in: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
};

const arrayOfObjectsSchema: Schema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      key: { type: "string" },
      operator: { type: "string" },
      value: { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      type: { type: "string" },
      color: { type: "string" },
    },
  },
};

Deno.test("parseFormEntries: nested object with array-append property", () => {
  const entries: [string, string][] = [
    ["filter[type][in][]", "activity/call_occurred"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: { filter: filterSchema },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    filter: { type: { in: ["activity/call_occurred"] } },
  });
});

Deno.test("parseFormEntries: multiple array-append values", () => {
  const entries: [string, string][] = [
    ["filter[type][in][]", "call"],
    ["filter[type][in][]", "email"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: { filter: filterSchema },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    filter: { type: { in: ["call", "email"] } },
  });
});

Deno.test("parseFormEntries: mixed object and array-append", () => {
  const entries: [string, string][] = [
    ["filter[item_id][eq]", "eq"],
    ["filter[type][in][]", "activity/call_occurred"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: { filter: filterSchema },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    filter: {
      item_id: { eq: "eq" },
      type: { in: ["activity/call_occurred"] },
    },
  });
});

Deno.test("parseFormEntries: array-of-objects with append notation", () => {
  const entries: [string, string][] = [
    ["items[][name]", "a"],
    ["items[][value]", "1"],
    ["items[][name]", "b"],
    ["items[][value]", "2"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: { items: arrayOfObjectsSchema },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    items: [{ name: "a", value: "1" }, { name: "b", value: "2" }],
  });
});

// In bracket mode, property-access keys ([name]) are object notation.
// Arrays require explicit [] or [N] notation.

Deno.test("parseFormEntries: property-access keys produce object even with array schema", () => {
  const entries: [string, string][] = [
    ["filters[key]", "id"],
    ["filters[operator]", "eq"],
    ["filters[key]", "type"],
    ["filters[operator]", "contains"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: { filters: arrayOfObjectsSchema },
  };

  // Without [] notation, repeated property keys are last-write-wins.
  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    filters: { key: "type", operator: "contains" },
  });
});

Deno.test("parseFormEntries: property-access keys produce object for single element", () => {
  const entries: [string, string][] = [
    ["filters[key]", "id"],
    ["filters[operator]", "eq"],
    ["filters[value]", "string"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: { filters: arrayOfObjectsSchema },
  };

  // No bracket array notation, so this is an object, not a wrapped array.
  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    filters: { key: "id", operator: "eq", value: "string" },
  });
});

Deno.test("parseFormEntries: bare repeated key produces scalar even with array schema", () => {
  const entries: [string, string][] = [
    ["tags", "a"],
    ["tags", "b"],
    ["tags", "c"],
  ];
  const schema: Schema = {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
    },
  };

  // Without [] notation, last-write-wins.
  const result = parseFormEntries(entries, schema, BRACKETS);
  assertEquals(result, { tags: "c" });
});

Deno.test("parseFormEntries: append notation produces array", () => {
  const entries: [string, string][] = [
    ["tags[]", "a"],
    ["tags[]", "b"],
    ["tags[]", "c"],
  ];
  const schema: Schema = {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
    },
  };

  const result = parseFormEntries(entries, schema, BRACKETS);
  assertEquals(result, { tags: ["a", "b", "c"] });
});

Deno.test("parseFormEntries: indexed notation produces array", () => {
  const entries: [string, string][] = [
    ["tags[0]", "a"],
    ["tags[1]", "b"],
    ["tags[2]", "c"],
  ];
  const schema: Schema = {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
    },
  };

  const result = parseFormEntries(entries, schema, BRACKETS);
  assertEquals(result, { tags: ["a", "b", "c"] });
});

Deno.test("parseFormEntries: append array-of-objects still works", () => {
  const entries: [string, string][] = [
    ["filters[][key]", "id"],
    ["filters[][operator]", "eq"],
    ["filters[][key]", "type"],
    ["filters[][operator]", "contains"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: { filters: arrayOfObjectsSchema },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    filters: [
      { key: "id", operator: "eq" },
      { key: "type", operator: "contains" },
    ],
  });
});

Deno.test("parseFormEntries: indexed array-of-objects still works", () => {
  const entries: [string, string][] = [
    ["filters[0][key]", "id"],
    ["filters[0][operator]", "eq"],
    ["filters[1][key]", "type"],
    ["filters[1][operator]", "contains"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: { filters: arrayOfObjectsSchema },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    filters: [
      { key: "id", operator: "eq" },
      { key: "type", operator: "contains" },
    ],
  });
});

Deno.test("parseFormEntries: deep nested array-of-objects", () => {
  const entries: [string, string][] = [
    ["deep[][a][b]", "1"],
    ["deep[][a][b]", "2"],
  ];
  const deepSchema: Schema = {
    type: "object",
    properties: {
      deep: {
        type: "array",
        items: {
          type: "object",
          properties: {
            a: {
              type: "object",
              properties: { b: { type: "string" } },
            },
          },
        },
      },
    },
  };

  const result = parseFormEntries(entries, deepSchema, BRACKETS);
  assertEquals(result, {
    deep: [{ a: { b: "1" } }, { a: { b: "2" } }],
  });
});

Deno.test("parseFormEntries: coerces integer leaf values", () => {
  const entries: [string, string][] = [["count", "42"]];
  const schema: Schema = {
    type: "object",
    properties: { count: { type: "integer" } },
  };

  const result = parseFormEntries(entries, schema, BRACKETS);
  assertEquals(result, { count: 42 });
});

Deno.test("parseFormEntries: coerces boolean leaf values", () => {
  const entries: [string, string][] = [["active", "true"]];
  const schema: Schema = {
    type: "object",
    properties: { active: { type: "boolean" } },
  };

  const result = parseFormEntries(entries, schema, BRACKETS);
  assertEquals(result, { active: true });
});

Deno.test("parseFormEntries: no schema defaults to object", () => {
  const entries: [string, string][] = [
    ["name", "test"],
    ["count", "42"],
  ];

  const result = parseFormEntries(entries, null, BRACKETS);
  assertEquals(result, { name: "test", count: "42" });
});

// =============================================================================
// parseFormEntries: terminal handling across all format combinations
// =============================================================================

const REPEAT_FLAT: FormFormat = { array: "repeat", object: "flat" };
const REPEAT_DOTS: FormFormat = { array: "repeat", object: "dots" };
const COMMA_FLAT: FormFormat = { array: "comma", object: "flat" };
const BRACKETS_FLAT: FormFormat = { array: "brackets", object: "flat" };

Deno.test("parseFormEntries: repeat+flat repeated bare keys produce array", () => {
  const entries: [string, string][] = [
    ["tags", "a"],
    ["tags", "b"],
    ["tags", "c"],
  ];
  const schema: Schema = {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
    },
  };

  const result = parseFormEntries(entries, schema, REPEAT_FLAT);
  assertEquals(result, { tags: ["a", "b", "c"] });
});

Deno.test("parseFormEntries: repeat+flat single bare value with array schema produces array of one", () => {
  const entries: [string, string][] = [["tags", "a"]];
  const schema: Schema = {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
    },
  };

  const result = parseFormEntries(entries, schema, REPEAT_FLAT);
  assertEquals(result, { tags: ["a"] });
});

Deno.test("parseFormEntries: repeat+flat scalar schema with single value stays scalar", () => {
  const entries: [string, string][] = [["name", "sam"]];
  const schema: Schema = {
    type: "object",
    properties: { name: { type: "string" } },
  };

  const result = parseFormEntries(entries, schema, REPEAT_FLAT);
  assertEquals(result, { name: "sam" });
});

Deno.test("parseFormEntries: repeat+flat schemaless repeated keys still coalesce as array", () => {
  // With no schema, the kernel can't say "this is array" from type info,
  // but multiple bare entries for the same key still produce an array.
  const entries: [string, string][] = [
    ["tags", "a"],
    ["tags", "b"],
  ];

  const result = parseFormEntries(entries, null, REPEAT_FLAT);
  assertEquals(result, { tags: ["a", "b"] });
});

Deno.test("parseFormEntries: comma+flat splits comma-separated single value on array schema", () => {
  const entries: [string, string][] = [["tags", "a,b,c"]];
  const schema: Schema = {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
    },
  };

  const result = parseFormEntries(entries, schema, COMMA_FLAT);
  assertEquals(result, { tags: ["a", "b", "c"] });
});

Deno.test("parseFormEntries: comma+flat coerces each split item via items schema", () => {
  const entries: [string, string][] = [["ids", "1,2,3"]];
  const schema: Schema = {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "integer" } },
    },
  };

  const result = parseFormEntries(entries, schema, COMMA_FLAT);
  assertEquals(result, { ids: [1, 2, 3] });
});

Deno.test("parseFormEntries: comma+flat schemaless single value stays scalar", () => {
  // Without schema, we can't know the comma is a separator, so it's
  // the raw value.
  const entries: [string, string][] = [["value", "a,b,c"]];

  const result = parseFormEntries(entries, null, COMMA_FLAT);
  assertEquals(result, { value: "a,b,c" });
});

Deno.test("parseFormEntries: comma+flat non-array schema keeps value as scalar", () => {
  const entries: [string, string][] = [["description", "hello, world"]];
  const schema: Schema = {
    type: "object",
    properties: { description: { type: "string" } },
  };

  const result = parseFormEntries(entries, schema, COMMA_FLAT);
  assertEquals(result, { description: "hello, world" });
});

Deno.test("parseFormEntries: brackets+flat bare repeated keys coalesce via last-wins (unification rule)", () => {
  // This pins the behavior we unified: the kernel picks last-wins in
  // brackets mode regardless of object format. The legacy form-parser
  // non-brackets branch used first-wins; the refactor unifies on the
  // kernel's documented rule.
  const entries: [string, string][] = [
    ["tags", "a"],
    ["tags", "b"],
  ];
  const schema: Schema = {
    type: "object",
    properties: { tags: { type: "array", items: { type: "string" } } },
  };

  const result = parseFormEntries(entries, schema, BRACKETS_FLAT);
  assertEquals(result, { tags: "b" });
});

Deno.test("parseFormEntries: dots object format nests scalar values", () => {
  const entries: [string, string][] = [
    ["user.name", "sam"],
    ["user.email", "sam@example.com"],
  ];
  const schema: Schema = {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
        },
      },
    },
  };

  const result = parseFormEntries(entries, schema, REPEAT_DOTS);
  assertEquals(result, {
    user: { name: "sam", email: "sam@example.com" },
  });
});

Deno.test("parseFormEntries: dots object format coerces leaf integer", () => {
  const entries: [string, string][] = [["user.age", "30"]];
  const schema: Schema = {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: { age: { type: "integer" } },
      },
    },
  };

  const result = parseFormEntries(entries, schema, REPEAT_DOTS);
  assertEquals(result, { user: { age: 30 } });
});

Deno.test("parseFormEntries: dots+brackets handles trailing [] append marker", () => {
  const entries: [string, string][] = [
    ["user.tags[]", "a"],
    ["user.tags[]", "b"],
  ];
  const schema: Schema = {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  };

  const result = parseFormEntries(entries, schema, {
    array: "brackets",
    object: "dots",
  });
  assertEquals(result, { user: { tags: ["a", "b"] } });
});

Deno.test("parseFormEntries: File instance passes through kernel unchanged", () => {
  const f = new File(["hello"], "test.txt", { type: "text/plain" });
  const entries: Array<[string, string | File]> = [["upload", f]];
  const schema: Schema = {
    type: "object",
    properties: {
      upload: { type: "string", format: "binary" },
    },
  };

  const result = parseFormEntries(entries, schema, REPEAT_FLAT);
  assertEquals(result, { upload: f });
});

Deno.test("parseFormEntries: $ref in property schema resolves via resolver callback", () => {
  const target: Schema = {
    type: "object",
    properties: { anchor: { type: "string" } },
  };
  const schema: Schema = {
    type: "object",
    properties: {
      expires_after: { $ref: "#/components/schemas/ExpiresAfter" },
    },
  };
  const entries: [string, string][] = [["expires_after[anchor]", "created_at"]];

  const result = parseFormEntries(
    entries,
    schema,
    BRACKETS,
    (s) => "$ref" in s ? target : undefined,
  );
  assertEquals(result, {
    expires_after: { anchor: "created_at" },
  });
});

console.log("param-format tests loaded");

// =============================================================================
// Append grouping boundaries (Rack semantics)
// =============================================================================

// A single element whose nested object carries several keys must stay one
// element: the element boundary is a repeat of the full sub-path, not of the
// first segment name. (SDKs serialize `entries[][metadata][k]` once per map
// key; Rack-style parsers merge these into the same element.)
Deno.test("parseFormEntries: append element with multi-key nested object stays one element", () => {
  const entries: [string, string][] = [
    ["entries[][direction]", "credit"],
    ["entries[][amount]", "0"],
    ["entries[][metadata][key]", "value"],
    ["entries[][metadata][foo]", "bar"],
    ["entries[][metadata][extra]", "data"],
    ["entries[][balances][cash]", "1"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            direction: { type: "string" },
            amount: { type: "integer" },
            metadata: {
              type: "object",
              additionalProperties: { type: "string" },
            },
            balances: {
              type: "object",
              additionalProperties: { type: "integer" },
            },
          },
        },
      },
    },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    entries: [
      {
        direction: "credit",
        amount: 0,
        metadata: { key: "value", foo: "bar", extra: "data" },
        balances: { cash: 1 },
      },
    ],
  });
});

Deno.test("parseFormEntries: append starts a new element on full sub-path repeat", () => {
  const entries: [string, string][] = [
    ["entries[][meta][a]", "1"],
    ["entries[][meta][b]", "2"],
    ["entries[][meta][a]", "3"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            meta: { type: "object", additionalProperties: { type: "string" } },
          },
        },
      },
    },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    entries: [
      { meta: { a: "1", b: "2" } },
      { meta: { a: "3" } },
    ],
  });
});

Deno.test("parseFormEntries: nested append inside an element never starts a new element", () => {
  const entries: [string, string][] = [
    ["entries[][tags][]", "x"],
    ["entries[][tags][]", "y"],
    ["entries[][name]", "a"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" } },
            name: { type: "string" },
          },
        },
      },
    },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    entries: [{ tags: ["x", "y"], name: "a" }],
  });
});

// =============================================================================
// additionalProperties coercion
// =============================================================================

Deno.test("parseFormEntries: coerces values under additionalProperties schema", () => {
  const entries: [string, string][] = [
    ["balances[cash]", "0"],
    ["balances[credit]", "25"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: {
      balances: { type: "object", additionalProperties: { type: "integer" } },
    },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, { balances: { cash: 0, credit: 25 } });
});

Deno.test("parseFormEntries: multiple append elements each with multi-key nested objects", () => {
  const entries: [string, string][] = [
    ["entries[][name]", "a"],
    ["entries[][meta][x]", "1"],
    ["entries[][meta][y]", "2"],
    ["entries[][name]", "b"],
    ["entries[][meta][x]", "3"],
    ["entries[][meta][y]", "4"],
  ];
  const wrapperSchema: Schema = {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            meta: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
      },
    },
  };

  const result = parseFormEntries(entries, wrapperSchema, BRACKETS);
  assertEquals(result, {
    entries: [
      { name: "a", meta: { x: "1", y: "2" } },
      { name: "b", meta: { x: "3", y: "4" } },
    ],
  });
});
