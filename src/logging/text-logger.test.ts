/**
 * TextLogger Tests - Verify logging output behavior
 */

import { assertEquals } from "@std/assert";
import { TextLogger } from "./text-logger.ts";
import type { RequestEvent } from "./types.ts";

function createMockRequestEvent(overrides: Partial<RequestEvent> = {}): RequestEvent {
  return {
    id: "test-1",
    timestamp: new Date("2024-01-01T12:00:00Z"),
    type: "request",
    request: {
      method: "GET",
      path: "/users",
      pathPattern: "/users",
      query: "",
      headers: new Headers(),
      body: { requestField: "value" },
    },
    response: {
      status: 200,
      statusText: "OK",
      timing: 10,
      headers: new Headers(),
      body: { responseField: "data" },
    },
    validation: {
      valid: true,
      errors: [],
      warnings: [],
    },
    ...overrides,
  };
}

Deno.test("TextLogger: logBodies option shows bodies in summary mode", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const logger = new TextLogger({
      level: "summary",
      color: false,
      logBodies: true,
    });

    const event = createMockRequestEvent();
    logger.request(event);

    // Should include response body in output
    const output = logs.join("\n");
    assertEquals(
      output.includes("responseField"),
      true,
      "Response body should be logged when logBodies is true",
    );
  } finally {
    console.log = originalLog;
  }
});

Deno.test("TextLogger: bodies not shown in summary mode without logBodies", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const logger = new TextLogger({
      level: "summary",
      color: false,
      // logBodies not set
    });

    const event = createMockRequestEvent();
    logger.request(event);

    // Should NOT include response body in output
    const output = logs.join("\n");
    assertEquals(
      output.includes("responseField"),
      false,
      "Response body should NOT be logged when logBodies is not set in summary mode",
    );
  } finally {
    console.log = originalLog;
  }
});

Deno.test("TextLogger: bodies shown in full mode regardless of logBodies", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const logger = new TextLogger({
      level: "full",
      color: false,
      // logBodies not set, but level is full
    });

    const event = createMockRequestEvent();
    logger.request(event);

    // Should include response body in output because level is "full"
    const output = logs.join("\n");
    assertEquals(
      output.includes("responseField"),
      true,
      "Response body should be logged when level is 'full'",
    );
  } finally {
    console.log = originalLog;
  }
});
