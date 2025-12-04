/**
 * Logger Tests
 *
 * Tests for the RequestLogger class
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { RequestLogger } from "./logger.ts";

// Helper to capture console.log output
function captureLog(fn: () => void): string[] {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return logs;
}

// =============================================================================
// formatHeaders Bug Test - headers.forEach.length issue
// =============================================================================

Deno.test("formatHeaders: correctly counts headers", () => {
  // Create headers with 5 entries
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set("X-Request-Id", "123");
  headers.set("X-Correlation-Id", "456");
  headers.set("Cache-Control", "no-cache");

  // Access the protected method via subclass
  class TestLogger extends RequestLogger {
    testFormatHeaders(h: Headers): string {
      return this.formatHeaders(h);
    }
  }

  const testLogger = new TestLogger("details", false);
  const result = testLogger.testFormatHeaders(headers);

  // In details mode, should show first 3 headers and "...and 2 more"
  // The bug causes it to show "...and -2 more" or wrong count
  // because headers.forEach.length is 1 (function arity), not header count

  // Should NOT contain negative numbers (like "-2" or "-1")
  // Note: the string contains "...and" which has a hyphen-like character
  const negativePattern = /-\d+/;  // matches negative numbers like -1, -2
  assertEquals(
    negativePattern.test(result),
    false,
    `Should not have negative count in: ${result}`,
  );

  // Should show "2 more" because we have 5 headers and show 3
  assertStringIncludes(result, "2 more", "Should show correct remaining count");
});

Deno.test("formatHeaders: shows all headers in full mode", () => {
  class TestLogger extends RequestLogger {
    testFormatHeaders(h: Headers): string {
      return this.formatHeaders(h);
    }
  }

  const testLogger = new TestLogger("full", false);

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set("X-Request-Id", "123");

  const result = testLogger.testFormatHeaders(headers);

  // In full mode, should NOT truncate
  assertEquals(result.includes("more"), false, "Full mode should not truncate");

  // Should include all headers (Headers normalizes keys to lowercase)
  assertStringIncludes(result, "content-type");
  assertStringIncludes(result, "accept");
  assertStringIncludes(result, "x-request-id");
});

Deno.test("formatHeaders: hides sensitive headers", () => {
  class TestLogger extends RequestLogger {
    testFormatHeaders(h: Headers): string {
      return this.formatHeaders(h);
    }
  }

  const testLogger = new TestLogger("full", false);

  const headers = new Headers();
  headers.set("Authorization", "Bearer secret-token");
  headers.set("Cookie", "session=abc123");
  headers.set("X-Api-Key", "my-api-key");
  headers.set("Content-Type", "application/json");

  const result = testLogger.testFormatHeaders(headers);

  // Should show "(hidden)" for sensitive headers
  assertStringIncludes(result, "(hidden)");

  // Should NOT show actual sensitive values
  assertEquals(
    result.includes("secret-token"),
    false,
    "Should not show authorization value",
  );
  assertEquals(
    result.includes("abc123"),
    false,
    "Should not show cookie value",
  );
  assertEquals(
    result.includes("my-api-key"),
    false,
    "Should not show api key value",
  );
});

Deno.test("formatHeaders: handles empty headers", () => {
  class TestLogger extends RequestLogger {
    testFormatHeaders(h: Headers): string {
      return this.formatHeaders(h);
    }
  }

  const testLogger = new TestLogger("details", false);
  const headers = new Headers();
  const result = testLogger.testFormatHeaders(headers);

  assertEquals(result, "", "Empty headers should return empty string");
});

// =============================================================================
// Status Code Formatting
// =============================================================================

Deno.test("formatStatus: 2xx codes are green", () => {
  class TestLogger extends RequestLogger {
    testFormatStatus(code: number): string {
      return this.formatStatus(code);
    }
  }

  const testLogger = new TestLogger("summary", false);

  const result200 = testLogger.testFormatStatus(200);
  const result201 = testLogger.testFormatStatus(201);

  // Green ANSI code is \x1b[32m
  assertStringIncludes(result200, "\x1b[32m");
  assertStringIncludes(result201, "\x1b[32m");
});

Deno.test("formatStatus: 4xx codes are yellow", () => {
  class TestLogger extends RequestLogger {
    testFormatStatus(code: number): string {
      return this.formatStatus(code);
    }
  }

  const testLogger = new TestLogger("summary", false);

  const result400 = testLogger.testFormatStatus(400);
  const result404 = testLogger.testFormatStatus(404);

  // Yellow ANSI code is \x1b[33m
  assertStringIncludes(result400, "\x1b[33m");
  assertStringIncludes(result404, "\x1b[33m");
});

Deno.test("formatStatus: 5xx codes are red", () => {
  class TestLogger extends RequestLogger {
    testFormatStatus(code: number): string {
      return this.formatStatus(code);
    }
  }

  const testLogger = new TestLogger("summary", false);

  const result500 = testLogger.testFormatStatus(500);

  // Red ANSI code is \x1b[31m
  assertStringIncludes(result500, "\x1b[31m");
});

// =============================================================================
// Request/Response Logging Integration
// =============================================================================

Deno.test("logRequest: summary mode stores pending line", () => {
  const logger = new RequestLogger("summary", false);

  const req = new Request("http://localhost/users?page=1", {
    method: "GET",
  });

  // In summary mode, logRequest should NOT immediately log
  const logs = captureLog(() => {
    logger.logRequest(req, "/users", "GET");
  });

  assertEquals(logs.length, 0, "Summary mode should not log in logRequest");
});

Deno.test("logRequest: details mode logs immediately", () => {
  const logger = new RequestLogger("details", false);

  const req = new Request("http://localhost/users", {
    method: "GET",
  });

  const logs = captureLog(() => {
    logger.logRequest(req, "/users", "GET");
  });

  assertEquals(logs.length > 0, true, "Details mode should log immediately");
  assertEquals(
    logs.some((l) => l.includes("GET") && l.includes("/users")),
    true,
  );
});

Deno.test("logResponse: summary mode outputs complete line", () => {
  const logger = new RequestLogger("summary", false);

  const req = new Request("http://localhost/users", {
    method: "GET",
  });

  // First log the request
  captureLog(() => {
    logger.logRequest(req, "/users", "GET");
  });

  // Then log the response
  const logs = captureLog(() => {
    logger.logResponse(200, 42);
  });

  assertEquals(logs.length, 1, "Summary mode should log one line for response");
  assertStringIncludes(logs[0]!, "GET");
  assertStringIncludes(logs[0]!, "/users");
  assertStringIncludes(logs[0]!, "200");
  assertStringIncludes(logs[0]!, "42ms");
});

Deno.test("logResponse: shows validation errors in summary mode", () => {
  const logger = new RequestLogger("summary", false);

  const req = new Request("http://localhost/users", {
    method: "POST",
  });

  captureLog(() => {
    logger.logRequest(req, "/users", "POST");
  });

  const logs = captureLog(() => {
    logger.logResponse(400, 10, {
      valid: false,
      errors: [
        { path: "body.email", message: "Invalid email format" },
        { path: "body.name", message: "Required field missing" },
      ],
      warnings: [],
    });
  });

  // Should show the first error
  assertStringIncludes(logs[0]!, "body.email");
  assertStringIncludes(logs[0]!, "Invalid email format");

  // Should indicate there are more errors
  assertStringIncludes(logs[0]!, "+1 more");
});
