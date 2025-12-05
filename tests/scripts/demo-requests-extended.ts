#!/usr/bin/env -S deno run --allow-net

// Extended test script for Steady interactive mode
// Runs many varied requests to fully test the logger

const BASE_URL = "http://localhost:3000";

interface TestRequest {
  name: string;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number; // milliseconds to wait after this request
}

const requests: TestRequest[] = [
  // Basic successful requests
  {
    name: "Simple GET - no params",
    path: "/simple",
  },
  {
    name: "Simple GET - second request",
    path: "/simple",
    delay: 50,
  },
  {
    name: "Tree structure GET",
    path: "/tree",
  },
  {
    name: "Person with recursion",
    path: "/person",
  },

  // Query parameter variations
  {
    name: "Single invalid query param",
    path: "/simple?debug=true",
  },
  {
    name: "Two invalid query params",
    path: "/simple?debug=true&verbose=1",
  },
  {
    name: "Three invalid query params",
    path: "/simple?debug=true&verbose=1&format=json",
  },
  {
    name: "Many invalid query params",
    path: "/simple?a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8",
  },
  {
    name: "Query params with special characters",
    path: "/tree?filter=name%20with%20spaces&special=%40%23%24",
  },
  {
    name: "Query params with arrays",
    path: "/person?include[]=spouse&include[]=friends&include[]=parents",
  },
  {
    name: "Empty query param values",
    path: "/simple?empty=&another=&third=value",
  },

  // Path variations
  {
    name: "Root path",
    path: "/",
  },
  {
    name: "Path with trailing slash",
    path: "/simple/",
  },
  {
    name: "Path with double slash",
    path: "/simple//extra",
  },
  {
    name: "Non-existent nested path",
    path: "/api/v1/users/123/profile",
  },
  {
    name: "Path with dots",
    path: "/file.json",
  },
  {
    name: "Path with dashes and underscores",
    path: "/some-path_with_mixed-naming",
  },

  // Method variations
  {
    name: "POST to GET-only endpoint",
    method: "POST",
    path: "/simple",
    headers: { "Content-Type": "application/json" },
    body: { test: "data" },
  },
  {
    name: "PUT request",
    method: "PUT",
    path: "/person",
    headers: { "Content-Type": "application/json" },
    body: { name: "Updated Name", age: 35 },
  },
  {
    name: "DELETE request",
    method: "DELETE",
    path: "/tree",
  },
  {
    name: "PATCH request",
    method: "PATCH",
    path: "/simple",
    headers: { "Content-Type": "application/json" },
    body: { email: "new@example.com" },
  },
  {
    name: "OPTIONS preflight",
    method: "OPTIONS",
    path: "/person",
    headers: {
      "Origin": "https://example.com",
      "Access-Control-Request-Method": "POST",
    },
  },
  {
    name: "HEAD request",
    method: "HEAD",
    path: "/tree",
  },

  // Header variations
  {
    name: "Basic auth header",
    path: "/simple",
    headers: {
      "Authorization": "Basic dXNlcjpwYXNzd29yZA==",
    },
  },
  {
    name: "Bearer token with JWT",
    path: "/person",
    headers: {
      "Authorization":
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    },
  },
  {
    name: "Custom headers",
    path: "/tree",
    headers: {
      "X-Request-ID": "req-" + crypto.randomUUID(),
      "X-Client-Version": "2.0.0",
      "X-Feature-Flag": "new-ui",
    },
  },
  {
    name: "Many headers",
    path: "/simple",
    headers: {
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "User-Agent": "TestScript/1.0",
      "X-Forwarded-For": "192.168.1.1",
      "X-Real-IP": "10.0.0.1",
      "X-Custom-1": "value1",
      "X-Custom-2": "value2",
    },
  },
  {
    name: "Content negotiation headers",
    path: "/person",
    headers: {
      "Accept": "application/xml;q=0.9, application/json;q=1.0",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    },
  },

  // Body variations
  {
    name: "POST with simple body",
    method: "POST",
    path: "/users",
    headers: { "Content-Type": "application/json" },
    body: {
      name: "Simple User",
      email: "simple@example.com",
    },
  },
  {
    name: "POST with nested body",
    method: "POST",
    path: "/users",
    headers: { "Content-Type": "application/json" },
    body: {
      user: {
        profile: {
          personal: {
            name: "Deep Nested",
            age: 25,
          },
          professional: {
            title: "Developer",
            company: "Tech Corp",
          },
        },
      },
    },
  },
  {
    name: "POST with array body",
    method: "POST",
    path: "/bulk",
    headers: { "Content-Type": "application/json" },
    body: [
      { id: 1, name: "Item 1" },
      { id: 2, name: "Item 2" },
      { id: 3, name: "Item 3" },
    ],
  },
  {
    name: "POST with large body",
    method: "POST",
    path: "/data",
    headers: { "Content-Type": "application/json" },
    body: {
      items: Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        description: `This is a longer description for item ${
          i + 1
        } to make the body larger`,
        metadata: {
          created: new Date().toISOString(),
          tags: [`tag${i}`, `category${i % 5}`, "common"],
        },
      })),
    },
  },

  // Special endpoints
  {
    name: "Health check",
    path: "/_x-steady/health",
  },
  {
    name: "OpenAPI spec",
    path: "/_x-steady/spec",
  },

  // Error scenarios
  {
    name: "Invalid JSON body",
    method: "POST",
    path: "/users",
    headers: { "Content-Type": "application/json" },
    body: "{ invalid json }",
  },
  {
    name: "Wrong content type",
    method: "POST",
    path: "/simple",
    headers: { "Content-Type": "text/plain" },
    body: "Plain text body",
  },

  // Rapid fire requests
  {
    name: "Rapid request 1",
    path: "/simple",
    delay: 10,
  },
  {
    name: "Rapid request 2",
    path: "/tree",
    delay: 10,
  },
  {
    name: "Rapid request 3",
    path: "/person",
    delay: 10,
  },
  {
    name: "Rapid request 4",
    path: "/simple?fast=true",
    delay: 10,
  },
  {
    name: "Rapid request 5",
    path: "/tree?quick=yes",
    delay: 10,
  },

  // Mixed success and failure
  {
    name: "Success after failures",
    path: "/simple",
  },
  {
    name: "Another 404",
    path: "/not-found-again",
  },
  {
    name: "Final success",
    path: "/person",
  },
];

async function runRequest(req: TestRequest, index: number): Promise<void> {
  const prefix = `[${
    (index + 1).toString().padStart(2, "0")
  }/${requests.length}]`;
  console.log(`${prefix} ${req.name}`);

  const options: RequestInit = {
    method: req.method || "GET",
    headers: req.headers,
  };

  if (req.body) {
    if (typeof req.body === "string") {
      options.body = req.body;
    } else {
      options.body = JSON.stringify(req.body);
    }
  }

  try {
    const start = performance.now();
    const response = await fetch(`${BASE_URL}${req.path}`, options);
    const elapsed = Math.round(performance.now() - start);

    // For HEAD requests, no body
    if (req.method === "HEAD") {
      console.log(`Status: ${response.status} ${response.statusText}`);
    } else {
      let body: unknown;
      const contentType = response.headers.get("content-type");

      if (contentType?.includes("application/json")) {
        body = await response.json();
      } else {
        body = await response.text();
      }

      // Truncate large responses
      let output = JSON.stringify(body, null, 2);
      if (output.length > 300) {
        output = output.substring(0, 300) + "\n... (truncated)";
      }
      console.log(output);
    }

    console.log(`⏱️  ${elapsed}ms\n`);
  } catch (error) {
    console.error(`❌ Error: ${error}\n`);
  }

  // Add delay if specified
  if (req.delay) {
    await new Promise((resolve) => setTimeout(resolve, req.delay));
  }
}

async function main() {
  console.log("🧪 Running extended test requests for Steady...");
  console.log(`📊 Total requests to run: ${requests.length}`);
  console.log(
    "Make sure Steady is running with: steady -i tests/specs/test-recursive.yaml",
  );
  console.log("");

  const startTime = performance.now();

  for (let i = 0; i < requests.length; i++) {
    const request = requests[i];
    if (request) {
      await runRequest(request, i);
    }
  }

  const totalTime = Math.round(performance.now() - startTime);

  console.log("✅ Test requests completed!");
  console.log(`⏱️  Total time: ${totalTime}ms`);
  console.log("\n📊 Summary:");
  console.log(`- Total requests: ${requests.length}`);
  console.log(
    `- Average time per request: ${Math.round(totalTime / requests.length)}ms`,
  );
  console.log("\nCheck the interactive logger to explore request details!");
  console.log(
    "Try filtering with: /status:400, /status:404, /method:POST, etc.",
  );
}

if (import.meta.main) {
  await main();
}
