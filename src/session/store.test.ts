import { assertEquals } from "@std/assert";
import { SessionStore } from "./store.ts";
import type { Diagnostic } from "../diagnostic.ts";

function makeDiag(
  overrides: Partial<Diagnostic> & { code: string },
): Diagnostic {
  return {
    severity: "error",
    category: "sdk-issue",
    requestPath: "body",
    specPointer: "#/test",
    message: "test",
    attribution: { confidence: 1.0, reasoning: ["test"] },
    ...overrides,
  };
}

Deno.test("SessionStore", async (t) => {
  await t.step("addRequest creates session implicitly", () => {
    const store = new SessionStore();
    store.addRequest("session-1", "POST", "/users", [
      makeDiag({ code: "E3007" }),
    ]);

    const report = store.getSession("session-1");
    assertEquals(report?.sessionId, "session-1");
    assertEquals(report?.requests, 1);
  });

  await t.step("returns undefined for unknown session", () => {
    const store = new SessionStore();
    assertEquals(store.getSession("nonexistent"), undefined);
  });

  await t.step("accumulates requests in same session", () => {
    const store = new SessionStore();
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E3007" }),
    ]);
    store.addRequest("s1", "GET", "/users", []);
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E3008" }),
    ]);

    const report = store.getSession("s1");
    assertEquals(report?.requests, 3);
  });

  await t.step("groups diagnostics by category", () => {
    const store = new SessionStore();
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E3007", category: "sdk-issue" }),
      makeDiag({ code: "E4002", category: "content-note", severity: "info" }),
      makeDiag({ code: "E5001", category: "ambiguous", severity: "warning" }),
      makeDiag({ code: "E1010", category: "spec-issue", severity: "warning" }),
    ]);

    const report = store.getSession("s1");
    assertEquals(report?.sdkIssues.length, 1);
    assertEquals(report?.contentNotes.length, 1);
    assertEquals(report?.ambiguous.length, 1);
    assertEquals(report?.specIssues.length, 1);
  });

  await t.step("each diagnostic includes method, path, and severity", () => {
    const store = new SessionStore();
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E3007", requestPath: "body.email" }),
    ]);

    const report = store.getSession("s1");
    const issue = report?.sdkIssues[0];
    assertEquals(issue?.method, "POST");
    assertEquals(issue?.path, "/users");
    assertEquals(issue?.requestPath, "body.email");
    assertEquals(issue?.code, "E3007");
    assertEquals(issue?.severity, "error");
  });

  await t.step("multiple sessions are independent", () => {
    const store = new SessionStore();
    store.addRequest("a", "GET", "/users", [
      makeDiag({ code: "E3007" }),
    ]);
    store.addRequest("b", "POST", "/items", [
      makeDiag({ code: "E3008" }),
      makeDiag({ code: "E4002", category: "content-note", severity: "info" }),
    ]);

    const reportA = store.getSession("a");
    assertEquals(reportA?.requests, 1);
    assertEquals(reportA?.sdkIssues.length, 1);
    assertEquals(reportA?.contentNotes.length, 0);

    const reportB = store.getSession("b");
    assertEquals(reportB?.requests, 1);
    assertEquals(reportB?.sdkIssues.length, 1);
    assertEquals(reportB?.contentNotes.length, 1);
  });

  await t.step("diagnostics from multiple requests are merged", () => {
    const store = new SessionStore();
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E3007" }),
    ]);
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E3008" }),
    ]);

    const report = store.getSession("s1");
    assertEquals(report?.sdkIssues.length, 2);
  });

  await t.step("request with no diagnostics still counts", () => {
    const store = new SessionStore();
    store.addRequest("s1", "GET", "/users", []);

    const report = store.getSession("s1");
    assertEquals(report?.requests, 1);
    assertEquals(report?.sdkIssues.length, 0);
    assertEquals(report?.contentNotes.length, 0);
    assertEquals(report?.ambiguous.length, 0);
    assertEquals(report?.specIssues.length, 0);
  });

  await t.step("result is 'passed' when no SDK issues", () => {
    const store = new SessionStore();
    store.addRequest("s1", "GET", "/users", []);
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E4002", category: "content-note", severity: "info" }),
    ]);

    const report = store.getSession("s1");
    assertEquals(report?.result, "passed");
  });

  await t.step("result is 'failed' when SDK issues present", () => {
    const store = new SessionStore();
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E3007", category: "sdk-issue" }),
    ]);

    const report = store.getSession("s1");
    assertEquals(report?.result, "failed");
  });

  await t.step("summary has correct total/valid/invalid counts", () => {
    const store = new SessionStore();
    // Valid request (no sdk-issue)
    store.addRequest("s1", "GET", "/users", []);
    // Valid request (content-note only)
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E4002", category: "content-note", severity: "info" }),
    ]);
    // Invalid request (sdk-issue)
    store.addRequest("s1", "POST", "/users", [
      makeDiag({ code: "E3007", category: "sdk-issue" }),
    ]);

    const report = store.getSession("s1");
    assertEquals(report?.summary, { total: 3, valid: 2, invalid: 1 });
  });

  await t.step("coverage tracks tested endpoints via pathPattern", () => {
    const store = new SessionStore();
    store.setAllEndpoints([
      "GET /users",
      "POST /users",
      "GET /users/{id}",
    ]);
    store.addRequest("s1", "GET", "/users", [], "/users");
    store.addRequest("s1", "GET", "/users/42", [], "/users/{id}");

    const report = store.getSession("s1");
    assertEquals(report?.coverage?.total, 3);
    assertEquals(report?.coverage?.tested, 2);
    assertEquals(report?.coverage?.endpoints.sort(), [
      "GET /users",
      "GET /users/{id}",
    ]);
  });

  await t.step("coverage is omitted when allEndpoints not set", () => {
    const store = new SessionStore();
    store.addRequest("s1", "GET", "/users", [], "/users");

    const report = store.getSession("s1");
    assertEquals(report?.coverage, undefined);
  });

  await t.step(
    "duplicate requests to same endpoint count once in coverage",
    () => {
      const store = new SessionStore();
      store.setAllEndpoints(["GET /users", "POST /users"]);
      store.addRequest("s1", "GET", "/users", [], "/users");
      store.addRequest("s1", "GET", "/users", [], "/users");
      store.addRequest("s1", "GET", "/users", [], "/users");

      const report = store.getSession("s1");
      assertEquals(report?.coverage?.tested, 1);
    },
  );
});
