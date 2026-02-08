import { assertEquals } from "@std/assert";
import type {
  OperationObject,
  PathItemObject,
  PathsObject,
} from "@steady/openapi";
import { matchRoute } from "./routing.ts";

Deno.test("matchRoute", async (t) => {
  // Minimal valid operations for testing
  const GET_OP: OperationObject = {
    responses: { "200": { description: "OK" } },
  };
  const POST_OP: OperationObject = {
    responses: { "201": { description: "Created" } },
  };

  // ── Successful matches ────────────────────────────────────────────

  await t.step("exact path, correct method → match", () => {
    const paths: PathsObject = { "/users": { get: GET_OP } };
    const result = matchRoute(paths, { path: "/users", method: "get" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathPattern, "/users");
      assertEquals(result.pathParams, {});
      assertEquals(result.operation, GET_OP);
    }
  });

  await t.step("parameterized path → extracts params", () => {
    const paths: PathsObject = { "/users/{id}": { get: GET_OP } };
    const result = matchRoute(paths, { path: "/users/123", method: "get" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathPattern, "/users/{id}");
      assertEquals(result.pathParams, { id: "123" });
    }
  });

  await t.step("case-insensitive method → match", () => {
    const paths: PathsObject = { "/users": { post: POST_OP } };
    const result = matchRoute(paths, { path: "/users", method: "POST" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.operation, POST_OP);
    }
  });

  await t.step("match includes pathItem", () => {
    const pathItem: PathItemObject = { get: GET_OP, post: POST_OP };
    const paths: PathsObject = { "/users": pathItem };
    const result = matchRoute(paths, { path: "/users", method: "get" });

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
    const paths: PathsObject = {
      "/users/{id}": { get: paramOp },
      "/users/me": { get: exactOp },
    };
    const result = matchRoute(paths, { path: "/users/me", method: "get" });

    assertEquals(result.matched, true);
    if (result.matched) {
      assertEquals(result.pathPattern, "/users/me");
      assertEquals(result.operation, exactOp);
    }
  });

  // ── E2001: Path not found ─────────────────────────────────────────

  await t.step("no matching path → E2001", () => {
    const paths: PathsObject = { "/users": { get: GET_OP } };
    const result = matchRoute(paths, { path: "/posts", method: "get" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E2001");
      assertEquals(result.diagnostics[0]!.category, "sdk-issue");
    }
  });

  await t.step("E2001 includes available paths in suggestion", () => {
    const paths: PathsObject = {
      "/users": { get: GET_OP },
      "/posts": { get: GET_OP },
    };
    const result = matchRoute(paths, { path: "/items", method: "get" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      const diag = result.diagnostics[0]!;
      assertEquals(diag.code, "E2001");
      assertEquals(typeof diag.suggestion, "string");
    }
  });

  await t.step("E2001 default confidence 0.7", () => {
    const paths: PathsObject = { "/users": { get: GET_OP } };
    const result = matchRoute(paths, { path: "/posts", method: "get" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics[0]!.attribution.confidence, 0.7);
    }
  });

  // ── E2002: Method not allowed ─────────────────────────────────────

  await t.step("path matches, wrong method → E2002", () => {
    const paths: PathsObject = { "/users": { get: GET_OP } };
    const result = matchRoute(paths, { path: "/users", method: "post" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics.length, 1);
      assertEquals(result.diagnostics[0]!.code, "E2002");
      assertEquals(result.diagnostics[0]!.category, "sdk-issue");
    }
  });

  await t.step("E2002 includes available methods in suggestion", () => {
    const paths: PathsObject = { "/users": { get: GET_OP, post: POST_OP } };
    const result = matchRoute(paths, { path: "/users", method: "delete" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      const diag = result.diagnostics[0]!;
      assertEquals(diag.code, "E2002");
      assertEquals(typeof diag.suggestion, "string");
    }
  });

  await t.step("E2002 on parameterized path", () => {
    const paths: PathsObject = { "/users/{id}": { get: GET_OP } };
    const result = matchRoute(paths, { path: "/users/123", method: "delete" });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics[0]!.code, "E2002");
    }
  });

  // ── Double-? enrichment ───────────────────────────────────────────

  await t.step("E2001 with double-? in query → confidence 0.95", () => {
    const paths: PathsObject = { "/users": { get: GET_OP } };
    const queryParams = new URLSearchParams();
    queryParams.set("key", "value?extra=true");

    const result = matchRoute(paths, {
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
    const paths: PathsObject = { "/users": { get: GET_OP } };
    const queryParams = new URLSearchParams();
    queryParams.set("key", "value?extra=true");

    const result = matchRoute(paths, {
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
    const paths: PathsObject = { "/users": { get: GET_OP } };
    const queryParams = new URLSearchParams();
    queryParams.set("key", "normalvalue");

    const result = matchRoute(paths, {
      path: "/posts",
      method: "get",
      queryParams,
    });

    assertEquals(result.matched, false);
    if (!result.matched) {
      assertEquals(result.diagnostics[0]!.attribution.confidence, 0.7);
    }
  });
});
