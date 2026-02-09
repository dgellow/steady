import { assertEquals } from "@std/assert";
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

  await t.step("each diagnostic includes method and path", () => {
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
});
