import { assertEquals } from "@std/assert";
import { handleSessionRequest } from "./endpoints.ts";
import { SessionStore } from "./store.ts";
import type { Diagnostic } from "../diagnostic.ts";

function makeDiag(overrides: Partial<Diagnostic> & { code: string }): Diagnostic {
  return {
    severity: "error",
    category: "sdk-issue",
    requestPath: "body",
    specPointer: "#/test",
    message: "test",
    attribution: { confidence: 0.9, reasoning: ["test"] },
    ...overrides,
  };
}

Deno.test("handleSessionRequest", async (t) => {
  await t.step("returns 404 for unknown session", async () => {
    const store = new SessionStore();
    const response = handleSessionRequest("/unknown-id", store);

    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error, "Session not found");
  });

  await t.step("returns session report as JSON", async () => {
    const store = new SessionStore();
    store.addRequest("abc-123", "POST", "/users", [
      makeDiag({
        code: "E3007",
        message: "Missing required field",
        requestPath: "body.email",
        specPointer: "#/paths/~1users/post/requestBody/.../required",
      }),
    ]);
    store.addRequest("abc-123", "GET", "/users", []);

    const response = handleSessionRequest("/abc-123", store);

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), "application/json");

    const body = await response.json();
    assertEquals(body.session_id, "abc-123");
    assertEquals(body.requests, 2);
    assertEquals(body.sdk_issues.length, 1);
    assertEquals(body.sdk_issues[0].code, "E3007");
    assertEquals(body.sdk_issues[0].method, "POST");
    assertEquals(body.sdk_issues[0].path, "/users");
    assertEquals(body.content_notes.length, 0);
    assertEquals(body.ambiguous.length, 0);
    assertEquals(body.spec_issues.length, 0);
  });

  await t.step("includes attribution in each diagnostic", async () => {
    const store = new SessionStore();
    store.addRequest("s1", "POST", "/users", [
      makeDiag({
        code: "E3007",
        attribution: {
          confidence: 0.9,
          reasoning: ["Field 'email' is required", "Not present in body"],
        },
        suggestion: "Include 'email' field in request body",
      }),
    ]);

    const response = handleSessionRequest("/s1", store);
    const body = await response.json();
    const issue = body.sdk_issues[0];

    assertEquals(issue.attribution.category, "sdk-issue");
    assertEquals(issue.attribution.confidence, 0.9);
    assertEquals(issue.attribution.reasoning.length, 2);
    assertEquals(issue.suggestion, "Include 'email' field in request body");
  });
});
