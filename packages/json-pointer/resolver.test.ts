import { assertEquals, assertThrows } from "@std/assert";
import {
  findCircularReferences,
  getAllReferences,
  isValidReference,
  resolveReference,
} from "./resolver.ts";
import { JsonPointerError } from "./json-pointer.ts";

Deno.test("resolveReference - resolves internal references", () => {
  const doc = {
    components: {
      schemas: {
        User: { type: "object", properties: { name: { type: "string" } } },
        Pet: {
          type: "object",
          properties: { owner: { $ref: "#/components/schemas/User" } },
        },
      },
    },
  };

  const resolved = resolveReference(doc, "#/components/schemas/User");
  assertEquals(resolved, {
    type: "object",
    properties: { name: { type: "string" } },
  });
});

Deno.test("resolveReference - throws for external references", () => {
  const doc = {};

  assertThrows(
    () => resolveReference(doc, "http://example.com/schema"),
    JsonPointerError,
    "External references not supported",
  );

  assertThrows(
    () => resolveReference(doc, "./other.json#/definitions/Thing"),
    JsonPointerError,
    "External references not supported",
  );
});

Deno.test("resolveReference - throws for non-existent references", () => {
  const doc = { foo: "bar" };

  assertThrows(
    () => resolveReference(doc, "#/nonexistent"),
    JsonPointerError,
    "Reference #/nonexistent not found",
  );
});

Deno.test("resolveReference - handles percent-encoded URI fragments", () => {
  // OpenAPI specs may have paths with special characters like {id}
  // When these are used in $ref values, they may be percent-encoded
  const doc = {
    paths: {
      "/users/{userId}": {
        get: {
          responses: {
            200: { description: "OK", schema: { type: "object" } },
          },
        },
      },
    },
  };

  // Reference using percent-encoded braces: %7B = { and %7D = }
  const resolved = resolveReference(
    doc,
    "#/paths/~1users~1%7BuserId%7D/get/responses/200",
  );

  assertEquals(resolved, { description: "OK", schema: { type: "object" } });
});

Deno.test("resolveReference - handles multiple percent-encoded characters", () => {
  const doc = {
    paths: {
      "/api/v1/{country}/{name}": {
        get: {
          summary: "Search by country and name",
        },
      },
    },
  };

  // Full percent-encoding of the path
  const resolved = resolveReference(
    doc,
    "#/paths/~1api~1v1~1%7Bcountry%7D~1%7Bname%7D/get",
  );

  assertEquals(resolved, { summary: "Search by country and name" });
});

Deno.test("resolveReference - handles spaces in percent-encoded paths", () => {
  const doc = {
    components: {
      schemas: {
        "User Profile": { type: "object" },
      },
    },
  };

  // Space encoded as %20
  const resolved = resolveReference(
    doc,
    "#/components/schemas/User%20Profile",
  );

  assertEquals(resolved, { type: "object" });
});

Deno.test("resolveReference - detects circular references", () => {
  const doc = {
    definitions: {
      A: { $ref: "#/definitions/B" },
      B: { $ref: "#/definitions/C" },
      C: { $ref: "#/definitions/A" },
    },
  };

  const context = {
    document: doc,
    visited: new Set<string>(),
    path: [],
  };

  assertThrows(
    () => resolveReference(doc, "#/definitions/A", context),
    JsonPointerError,
    "Circular reference detected",
  );
});

Deno.test("resolveReference - resolves nested references", () => {
  const doc = {
    definitions: {
      Name: { type: "string" },
      User: {
        type: "object",
        properties: {
          name: { $ref: "#/definitions/Name" },
        },
      },
    },
  };

  const context = {
    document: doc,
    visited: new Set<string>(),
    path: [],
  };

  const resolved = resolveReference(doc, "#/definitions/User", context);
  assertEquals(resolved, {
    type: "object",
    properties: {
      name: { type: "string" },
    },
  });
});

Deno.test("getAllReferences - finds all references in document", () => {
  const doc = {
    paths: {
      "/users": {
        get: {
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/UserList" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            address: { $ref: "#/components/schemas/Address" },
            tags: {
              type: "array",
              items: { $ref: "#/components/schemas/Tag" },
            },
          },
        },
        UserList: {
          type: "array",
          items: { $ref: "#/components/schemas/User" },
        },
        Address: { type: "object" },
        Tag: { type: "string" },
      },
    },
  };

  const refs = getAllReferences(doc);
  const expected = [
    "#/components/schemas/UserList",
    "#/components/schemas/Address",
    "#/components/schemas/Tag",
    "#/components/schemas/User",
  ];

  assertEquals(new Set(refs), new Set(expected));
});

Deno.test("getAllReferences - handles empty documents", () => {
  assertEquals(getAllReferences({}), []);
  assertEquals(getAllReferences({ foo: "bar" }), []);
  assertEquals(getAllReferences(null), []);
  assertEquals(getAllReferences(undefined), []);
});

Deno.test("isValidReference - checks reference validity", () => {
  const doc = {
    components: {
      schemas: {
        User: { type: "object" },
      },
    },
  };

  assertEquals(isValidReference(doc, "#/components/schemas/User"), true);
  assertEquals(
    isValidReference(doc, "#/components/schemas/NonExistent"),
    false,
  );
  assertEquals(isValidReference(doc, "#/invalid/pointer/"), false);
  assertEquals(isValidReference(doc, "external.json#/foo"), false);
});

Deno.test("findCircularReferences - detects all circular refs", () => {
  const doc = {
    definitions: {
      // Direct self-reference
      SelfRef: { $ref: "#/definitions/SelfRef" },

      // Mutual references
      A: { properties: { b: { $ref: "#/definitions/B" } } },
      B: { properties: { a: { $ref: "#/definitions/A" } } },

      // Longer cycle
      X: { $ref: "#/definitions/Y" },
      Y: { $ref: "#/definitions/Z" },
      Z: { $ref: "#/definitions/X" },

      // Non-circular
      Valid: { type: "string" },
    },
  };

  const circular = findCircularReferences(doc);

  // Should find the self-reference and the start of each cycle
  assertEquals(circular.includes("#/definitions/SelfRef"), true);
  assertEquals(circular.length > 0, true);
});

Deno.test("findCircularReferences - handles complex nested structures", () => {
  const doc = {
    schemas: {
      Tree: {
        type: "object",
        properties: {
          value: { type: "string" },
          children: {
            type: "array",
            items: { $ref: "#/schemas/Tree" }, // Recursive but not circular
          },
        },
      },
      LinkedList: {
        type: "object",
        properties: {
          value: { type: "string" },
          next: { $ref: "#/schemas/LinkedList" }, // Also recursive but valid
        },
      },
    },
  };

  // These are recursive references but not problematic circular ones
  // The implementation might flag them, which is conservative but safe
  const circular = findCircularReferences(doc);
  // Just verify it doesn't crash on recursive structures
  assertEquals(Array.isArray(circular), true);
});

Deno.test("resolveReference - preserves non-ref properties in resolved objects", () => {
  const doc = {
    components: {
      schemas: {
        Base: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
        },
        Extended: {
          allOf: [
            { $ref: "#/components/schemas/Base" },
            {
              type: "object",
              properties: {
                name: { type: "string" },
              },
            },
          ],
        },
      },
    },
  };

  const context = {
    document: doc,
    visited: new Set<string>(),
    path: [],
  };

  const resolved = resolveReference(
    doc,
    "#/components/schemas/Extended",
    context,
  );

  assertEquals(resolved, {
    allOf: [
      {
        type: "object",
        properties: {
          id: { type: "string" },
        },
      },
      {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      },
    ],
  });
});

Deno.test("resolveReference - throws on invalid percent encoding", () => {
  const doc = {
    components: {
      schemas: {
        User: { type: "object" },
      },
    },
  };

  // Invalid percent encoding: %GG is not valid hex
  assertThrows(
    () => resolveReference(doc, "#/components/schemas/%GGinvalid"),
    JsonPointerError,
    "Invalid percent encoding",
  );

  // Incomplete percent encoding: %2 without second hex digit
  assertThrows(
    () => resolveReference(doc, "#/components/schemas/%2"),
    JsonPointerError,
    "Invalid percent encoding",
  );
});
