/**
 * TextLogger Tests - Verify logging output behavior
 */

import { assertEquals } from "@std/assert";
import { TextLogger } from "./text-logger.ts";
import type { RequestEvent } from "./types.ts";
import type { Diagnostic } from "../diagnostic.ts";

function makeDiagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: "E3008",
    severity: "error",
    category: "sdk-issue",
    requestPath: "body.email",
    specPointer: "#/components/schemas/User/properties/email",
    message: "expected string, got integer",
    expected: "string",
    actual: 42,
    attribution: { confidence: 1.0, reasoning: ["test"] },
    ...overrides,
  };
}

function createMockRequestEvent(
  overrides: Partial<RequestEvent> = {},
): RequestEvent {
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
    diagnostics: [],
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
    });

    const event = createMockRequestEvent();
    logger.request(event);

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

Deno.test("TextLogger: summary mode shows response warning marker", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const logger = new TextLogger({
      level: "summary",
      color: false,
    });

    const event = createMockRequestEvent({
      response: {
        status: 200,
        statusText: "OK",
        timing: 10,
        headers: new Headers(),
        body: {},
        bodySize: 2,
        responseWarning: "minimal",
      },
    });
    logger.request(event);

    const output = logs.join("\n");
    assertEquals(
      output.includes("minimal response"),
      true,
      "Summary line should include warning marker for minimal response",
    );
  } finally {
    console.log = originalLog;
  }
});

Deno.test("TextLogger: detailed mode shows response warning marker", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const logger = new TextLogger({
      level: "details",
      color: false,
    });

    const event = createMockRequestEvent({
      response: {
        status: 200,
        statusText: "OK",
        timing: 10,
        headers: new Headers(),
        body: {},
        bodySize: 2,
        responseWarning: "minimal",
      },
    });
    logger.request(event);

    const output = logs.join("\n");
    assertEquals(
      output.includes("minimal response"),
      true,
      "Detailed output should include warning marker for minimal response",
    );
  } finally {
    console.log = originalLog;
  }
});

Deno.test("TextLogger: summary mode shows E-code for diagnostics", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const logger = new TextLogger({
      level: "summary",
      color: false,
    });

    const event = createMockRequestEvent({
      diagnostics: [makeDiagnostic()],
    });
    logger.request(event);

    const output = logs.join("\n");
    assertEquals(
      output.includes("E3008"),
      true,
      "Summary mode should show E-code",
    );
    assertEquals(
      output.includes("body.email"),
      true,
      "Summary mode should show request path",
    );
  } finally {
    console.log = originalLog;
  }
});

Deno.test("TextLogger: detailed mode uses compiler-style format", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const logger = new TextLogger({
      level: "details",
      color: false,
    });

    const event = createMockRequestEvent({
      diagnostics: [makeDiagnostic()],
    });
    logger.request(event);

    const output = logs.join("\n");
    // Compiler-style: "error[E3008]: ..."
    assertEquals(
      output.includes("error[E3008]"),
      true,
      "Detailed mode should show compiler-style diagnostic header",
    );
  } finally {
    console.log = originalLog;
  }
});

Deno.test("TextLogger: full mode shows reasoning chain", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const logger = new TextLogger({
      level: "full",
      color: false,
    });

    const event = createMockRequestEvent({
      diagnostics: [makeDiagnostic({
        attribution: {
          confidence: 1.0,
          reasoning: ["Schema requires string", "Request sent integer"],
        },
      })],
    });
    logger.request(event);

    const output = logs.join("\n");
    assertEquals(
      output.includes("Schema requires string"),
      true,
      "Full mode should show reasoning chain",
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
    });

    const event = createMockRequestEvent();
    logger.request(event);

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
