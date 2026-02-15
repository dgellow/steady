import { assertEquals } from "@std/assert";
import { CILogger } from "./ci-logger.ts";
import type { RequestEvent, ShutdownEvent, StartupEvent } from "./types.ts";
import type { Diagnostic } from "../diagnostic.ts";

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: "E3007",
    severity: "error",
    category: "sdk-issue",
    requestPath: "body.email",
    specPointer: "#/test",
    message: "Missing required property: email",
    attribution: { confidence: 1.0, reasoning: ["test"] },
    ...overrides,
  };
}

function makeRequestEvent(
  diagnostics: Diagnostic[] = [],
): RequestEvent {
  return {
    id: "req-1",
    timestamp: new Date("2025-01-01"),
    type: "request",
    request: {
      method: "POST",
      path: "/users",
      pathPattern: "/users",
      query: "",
      headers: new Headers(),
    },
    response: {
      status: 200,
      statusText: "OK",
      timing: 5,
      headers: new Headers(),
    },
    diagnostics,
  };
}

function captureLog(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

Deno.test("CILogger", async (t) => {
  await t.step("skips requests with no diagnostics", () => {
    const logger = new CILogger();
    const lines = captureLog(() => logger.request(makeRequestEvent([])));
    assertEquals(lines.length, 0);
  });

  await t.step("logs requests with diagnostics using annotations", () => {
    const logger = new CILogger();
    const lines = captureLog(() =>
      logger.request(makeRequestEvent([makeDiag()]))
    );
    assertEquals(lines.length, 2);
    assertEquals(lines[0]?.startsWith("STEADY:"), true);
    assertEquals(lines[1]?.startsWith("::error::"), true);
    assertEquals(lines[1]?.includes("E3007"), true);
  });

  await t.step("warning diagnostics use ::warning:: annotation", () => {
    const logger = new CILogger();
    const lines = captureLog(() =>
      logger.request(
        makeRequestEvent([makeDiag({ severity: "warning" })]),
      )
    );
    assertEquals(lines[1]?.startsWith("::warning::"), true);
  });

  await t.step("startup logs spec info", () => {
    const logger = new CILogger();
    const event: StartupEvent = {
      id: "s1",
      timestamp: new Date(),
      type: "startup",
      spec: { title: "Test API", version: "1.0", endpointCount: 5 },
      server: { url: "http://localhost:3000", rejectOnSdkError: false },
      diagnostics: [],
    };
    const lines = captureLog(() => logger.startup(event));
    assertEquals(lines.length, 2);
    assertEquals(lines[0]?.includes("Test API"), true);
    assertEquals(lines[0]?.includes("5 endpoints"), true);
  });

  await t.step("startup logs warning-severity diagnostics", () => {
    const logger = new CILogger();
    const event: StartupEvent = {
      id: "s1",
      timestamp: new Date(),
      type: "startup",
      spec: { title: "Test API", version: "1.0", endpointCount: 5 },
      server: { url: "http://localhost:3000", rejectOnSdkError: false },
      diagnostics: [
        makeDiag({
          code: "E1005",
          severity: "warning",
          category: "spec-issue",
          message: "Circular reference",
        }),
        makeDiag({
          code: "E1004",
          severity: "error",
          category: "spec-issue",
          message: "Unresolved ref",
        }),
      ],
    };
    const lines = captureLog(() => logger.startup(event));
    // Both error and warning annotations should be emitted
    assertEquals(
      lines.some((l) => l === "::error::STEADY E1004: Unresolved ref"),
      true,
    );
    assertEquals(
      lines.some((l) => l === "::warning::STEADY E1005: Circular reference"),
      true,
    );
  });

  await t.step("shutdown logs verdict and stats", () => {
    const logger = new CILogger();
    const event: ShutdownEvent = {
      id: "s2",
      timestamp: new Date(),
      type: "shutdown",
      session: {
        duration: 1000,
        requestCount: 10,
        failedCount: 2,
        validityRate: 0.8,
        categoryBreakdown: { "sdk-issue": 3 },
      },
      topIssues: [
        {
          code: "E3007",
          method: "POST",
          path: "/users",
          message: "Missing required field",
          count: 3,
          category: "sdk-issue",
          attribution: { confidence: 1.0, reasoning: ["test"] },
        },
      ],
    };
    const lines = captureLog(() => logger.shutdown(event));
    assertEquals(lines.some((l) => l.includes("FAILED")), true);
    assertEquals(lines.some((l) => l.includes("10 requests")), true);
    // Shutdown annotations include code and category
    const annotation = lines.find((l) => l.startsWith("::error::"));
    assertEquals(annotation?.includes("E3007"), true);
    assertEquals(annotation?.includes("[sdk-issue]"), true);
    assertEquals(annotation?.includes("x3"), true);
  });

  await t.step("shutdown logs PASSED when no sdk-issue", () => {
    const logger = new CILogger();
    const event: ShutdownEvent = {
      id: "s3",
      timestamp: new Date(),
      type: "shutdown",
      session: {
        duration: 500,
        requestCount: 5,
        failedCount: 0,
        validityRate: 1.0,
        categoryBreakdown: {},
      },
      topIssues: [],
    };
    const lines = captureLog(() => logger.shutdown(event));
    assertEquals(lines.some((l) => l.includes("PASSED")), true);
  });

  await t.step("shutdown logs coverage when present", () => {
    const logger = new CILogger();
    const event: ShutdownEvent = {
      id: "s4",
      timestamp: new Date(),
      type: "shutdown",
      session: {
        duration: 500,
        requestCount: 5,
        failedCount: 0,
        validityRate: 1.0,
        categoryBreakdown: {},
      },
      topIssues: [],
      coverage: {
        tested: 3,
        total: 5,
        untestedEndpoints: ["GET /a", "POST /b"],
      },
    };
    const lines = captureLog(() => logger.shutdown(event));
    assertEquals(
      lines.some((l) => l.includes("Coverage 3/5 endpoints")),
      true,
    );
  });

  await t.step("warning and error use annotations", () => {
    const logger = new CILogger();
    const warnLines = captureLog(() => logger.warning("test warning"));
    assertEquals(warnLines[0], "::warning::STEADY: test warning");

    const errLines = captureLog(() => logger.error("test error"));
    assertEquals(errLines[0], "::error::STEADY: test error");
  });
});
