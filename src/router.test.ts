import { assertEquals } from "@std/assert";
import type { OperationObject, PathItemObject } from "@steady/openapi";
import { Router } from "./router.ts";

Deno.test("Router", async (t) => {
  // Minimal valid operations for testing
  const GET_OP: OperationObject = {
    responses: { "200": { description: "OK" } },
  };
  const POST_OP: OperationObject = {
    responses: { "201": { description: "Created" } },
  };

  // ── Successful matches ────────────────────────────────────────────

  await t.step("exact path, correct method → match", () => {
    const router = new Router({ "/users": { get: GET_OP } });
    const result = router.match({ path: "/users", method: "get" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathPattern, "/users");
      assertEquals(result.pathParams, {});
      assertEquals(result.operation, GET_OP);
    }
  });

  await t.step("parameterized path → extracts params", () => {
    const router = new Router({ "/users/{id}": { get: GET_OP } });
    const result = router.match({ path: "/users/123", method: "get" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathPattern, "/users/{id}");
      assertEquals(result.pathParams, { id: "123" });
    }
  });

  await t.step("QUERY method → match", () => {
    const QUERY_OP: OperationObject = {
      requestBody: {
        content: {
          "application/json": { schema: { type: "object" } },
        },
      },
      responses: { "200": { description: "Results" } },
    };
    const router = new Router({ "/search": { query: QUERY_OP } });
    const result = router.match({ path: "/search", method: "query" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathPattern, "/search");
      assertEquals(result.operation, QUERY_OP);
    }
  });

  await t.step("case-insensitive method → match", () => {
    const router = new Router({ "/users": { post: POST_OP } });
    const result = router.match({ path: "/users", method: "POST" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.operation, POST_OP);
    }
  });

  await t.step("match includes pathItem", () => {
    const pathItem: PathItemObject = { get: GET_OP, post: POST_OP };
    const router = new Router({ "/users": pathItem });
    const result = router.match({ path: "/users", method: "get" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathItem, pathItem);
    }
  });

  await t.step("prefers exact match over parameterized", () => {
    const exactOp: OperationObject = {
      responses: { "200": { description: "exact" } },
    };
    const paramOp: OperationObject = {
      responses: { "200": { description: "param" } },
    };
    const router = new Router({
      "/users/{id}": { get: paramOp },
      "/users/me": { get: exactOp },
    });
    const result = router.match({ path: "/users/me", method: "get" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathPattern, "/users/me");
      assertEquals(result.operation, exactOp);
    }
  });

  await t.step("match includes statusCode", () => {
    const router = new Router({ "/users": { post: POST_OP } });
    const result = router.match({ path: "/users", method: "post" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.statusCode, "201");
    }
  });

  // ── E2001: Path not found ─────────────────────────────────────────

  await t.step("no matching path → E2001", () => {
    const router = new Router({ "/users": { get: GET_OP } });
    const result = router.match({ path: "/posts", method: "get" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E2001");
      assertEquals(result.diagnostics[0]!.category, "sdk-issue");
    }
  });

  await t.step("E2001 includes available paths in suggestion", () => {
    const router = new Router({
      "/users": { get: GET_OP },
      "/posts": { get: GET_OP },
    });
    const result = router.match({ path: "/items", method: "get" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      const diag = result.diagnostics[0]!;
      assertEquals(diag.code, "E2001");
      assertEquals(typeof diag.suggestion, "string");
    }
  });

  await t.step("E2001 default confidence 0.7", () => {
    const router = new Router({ "/users": { get: GET_OP } });
    const result = router.match({ path: "/posts", method: "get" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics[0]!.attribution.confidence, 0.7);
    }
  });

  // ── E2002: Method not allowed ─────────────────────────────────────

  await t.step("path matches, wrong method → E2002", () => {
    const router = new Router({ "/users": { get: GET_OP } });
    const result = router.match({ path: "/users", method: "post" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E2002");
      assertEquals(result.diagnostics[0]!.category, "sdk-issue");
    }
  });

  await t.step("E2002 includes available methods in suggestion", () => {
    const router = new Router({
      "/users": { get: GET_OP, post: POST_OP },
    });
    const result = router.match({ path: "/users", method: "delete" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      const diag = result.diagnostics[0]!;
      assertEquals(diag.code, "E2002");
      assertEquals(typeof diag.suggestion, "string");
    }
  });

  await t.step("E2002 on parameterized path", () => {
    const router = new Router({ "/users/{id}": { get: GET_OP } });
    const result = router.match({ path: "/users/123", method: "delete" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics[0]!.code, "E2002");
    }
  });

  await t.step("method not allowed reports the allowed methods", () => {
    const router = new Router({
      "/users": { post: POST_OP, get: GET_OP },
    });
    const result = router.match({ path: "/users", method: "delete" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.reason, "method-not-allowed");
      if (result.reason === "method-not-allowed") {
        // Canonical method order, independent of key order in the spec.
        assertEquals(result.allowedMethods, ["get", "post"]);
      }
    }
  });

  await t.step(
    "allowed methods are the union over every path template that matches",
    () => {
      // Two templates that match the same URLs (E1008). A request for a
      // method neither defines is allowed nothing but DELETE and POST.
      const router = new Router({
        "/secrets/{secret_id}": { delete: GET_OP },
        "/secrets/{secret_key}": { post: POST_OP },
      });
      const result = router.match({ path: "/secrets/abc", method: "put" });

      assertEquals(result.matched, false);
      if (!result.matched && result.reason === "method-not-allowed") {
        assertEquals(result.allowedMethods, ["post", "delete"]);
        assertEquals(
          result.diagnostics[0]!.suggestion,
          'Available methods for "/secrets/{secret_id}", "/secrets/{secret_key}": POST, DELETE',
        );
      } else {
        throw new Error("expected method-not-allowed");
      }
    },
  );

  await t.step("path not found has reason path-not-found", () => {
    const router = new Router({ "/users": { get: GET_OP } });
    const result = router.match({ path: "/nope", method: "get" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.reason, "path-not-found");
    }
  });

  // ── Double-? enrichment ───────────────────────────────────────────

  await t.step("E2001 with double-? in query → confidence 0.95", () => {
    const router = new Router({ "/users": { get: GET_OP } });
    const queryParams = new URLSearchParams();
    queryParams.set("key", "value?extra=true");

    const result = router.match({
      path: "/posts",
      method: "get",
      queryParams,
    });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics[0]!.code, "E2001");
      assertEquals(result.diagnostics[0]!.attribution.confidence, 0.95);
    }
  });

  await t.step("E2002 with double-? in query → confidence 0.95", () => {
    const router = new Router({ "/users": { get: GET_OP } });
    const queryParams = new URLSearchParams();
    queryParams.set("key", "value?extra=true");

    const result = router.match({
      path: "/users",
      method: "delete",
      queryParams,
    });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics[0]!.code, "E2002");
      assertEquals(result.diagnostics[0]!.attribution.confidence, 0.95);
    }
  });

  await t.step("no double-? → default confidence not boosted", () => {
    const router = new Router({ "/users": { get: GET_OP } });
    const queryParams = new URLSearchParams();
    queryParams.set("key", "normalvalue");

    const result = router.match({
      path: "/posts",
      method: "get",
      queryParams,
    });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics[0]!.attribution.confidence, 0.7);
    }
  });

  // ── Query disambiguation ──────────────────────────────────────────

  await t.step("query-disambiguated path matches with correct query", () => {
    const router = new Router({
      "/templates": { get: GET_OP },
      "/templates?desc=cached_upload": { post: POST_OP },
    });
    const queryParams = new URLSearchParams("desc=cached_upload");

    const result = router.match({
      path: "/templates",
      method: "post",
      queryParams,
    });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathPattern, "/templates?desc=cached_upload");
      assertEquals(result.operation, POST_OP);
      assertEquals(result.consumedQueryParams, ["desc"]);
    }
  });

  await t.step(
    "query-disambiguated path falls back to base path when query doesn't match",
    () => {
      const router = new Router({
        "/templates": { get: GET_OP },
        "/templates?desc=cached_upload": { post: POST_OP },
      });

      const result = router.match({
        path: "/templates",
        method: "get",
      });

      assertEquals(result.matched, true);
      if (result.matched) {
        assertEquals(result.pathPattern, "/templates");
        assertEquals(result.operation, GET_OP);
        assertEquals(result.consumedQueryParams, undefined);
      }
    },
  );

  await t.step(
    "query disambiguation with parameterized paths",
    () => {
      const router = new Router({
        "/items/{id}": { get: GET_OP },
        "/items/{id}?action=delete": { post: POST_OP },
      });
      const queryParams = new URLSearchParams("action=delete");

      const result = router.match({
        path: "/items/42",
        method: "post",
        queryParams,
      });

      assertEquals(result.matched, true);
      if (result.matched) {
        assertEquals(result.pathPattern, "/items/{id}?action=delete");
        assertEquals(result.pathParams, { id: "42" });
        assertEquals(result.consumedQueryParams, ["action"]);
      }
    },
  );

  await t.step(
    "multiple query-disambiguated paths pick the matching one",
    () => {
      const opA: OperationObject = {
        responses: { "200": { description: "A" } },
      };
      const opB: OperationObject = {
        responses: { "200": { description: "B" } },
      };
      const router = new Router({
        "/templates?desc=cached_upload": { post: opA },
        "/templates?desc=html": { post: opB },
      });
      const queryParams = new URLSearchParams("desc=html");

      const result = router.match({
        path: "/templates",
        method: "post",
        queryParams,
      });

      assertEquals(result.matched, true);
      if (result.matched) {
        assertEquals(result.pathPattern, "/templates?desc=html");
        assertEquals(result.operation, opB);
      }
    },
  );
});
