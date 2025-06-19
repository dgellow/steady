#!/usr/bin/env -S deno run --allow-net

// Test script for Steady interactive mode
// Runs various requests to demonstrate logging capabilities

const BASE_URL = "http://localhost:3000";

interface TestRequest {
  name: string;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

const requests: TestRequest[] = [
  {
    name: "Basic GET request",
    path: "/simple",
  },
  {
    name: "GET with query parameters (will fail validation)",
    path: "/simple?name=john&age=30&extra=param",
  },
  {
    name: "Recursive tree structure",
    path: "/tree",
  },
  {
    name: "Person with circular references",
    path: "/person",
  },
  {
    name: "Non-existent path",
    path: "/users/123",
  },
  {
    name: "Wrong HTTP method",
    method: "POST",
    path: "/simple",
  },
  {
    name: "Another wrong method",
    method: "DELETE",
    path: "/person",
  },
  {
    name: "Request with authorization header",
    path: "/simple",
    headers: {
      "Authorization": "Bearer my-secret-token",
    },
  },
  {
    name: "Request with multiple headers",
    path: "/tree",
    headers: {
      "X-API-Key": "abc123",
      "X-Request-ID": "req-789",
      "Accept": "application/json",
    },
  },
  {
    name: "Single unknown query param",
    path: "/tree?filter=active",
  },
  {
    name: "Multiple unknown query params",
    path: "/person?include=spouse&include=friends&depth=2&format=detailed",
  },
  {
    name: "Health check endpoint",
    path: "/_x-steady/health",
  },
  {
    name: "OpenAPI spec endpoint (truncated)",
    path: "/_x-steady/spec",
  },
  {
    name: "Path with trailing slash",
    path: "/simple/",
  },
  {
    name: "OPTIONS request",
    method: "OPTIONS",
    path: "/simple",
  },
  {
    name: "HEAD request",
    method: "HEAD",
    path: "/person",
  },
  {
    name: "Path that looks like it has params",
    path: "/users/john/posts/123",
  },
  {
    name: "Very long query string",
    path:
      "/simple?param1=value1&param2=value2&param3=value3&param4=value4&param5=value5&param6=value6&param7=value7&param8=value8&param9=value9&param10=value10",
  },
  {
    name: "POST with complex nested body",
    method: "POST",
    path: "/users",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      user: {
        id: 12345,
        name: "John Doe",
        email: "john@example.com",
        profile: {
          age: 30,
          address: {
            street: "123 Main St",
            city: "Anytown",
            state: "CA",
            coordinates: { lat: 37.7749, lng: -122.4194 },
          },
          preferences: {
            theme: "dark",
            notifications: {
              email: true,
              push: false,
              sms: true,
            },
          },
        },
      },
      items: [
        { id: 1, name: "Widget", price: 19.99, quantity: 3 },
        { id: 2, name: "Gadget", price: 39.99, quantity: 1 },
      ],
    },
  },
  {
    name: "Final request with consistent response",
    path: "/simple",
  },
];

async function runRequest(req: TestRequest, index: number): Promise<void> {
  console.log(`${index + 1}. ${req.name}`);

  const options: RequestInit = {
    method: req.method || "GET",
    headers: req.headers,
  };

  if (req.body) {
    options.body = JSON.stringify(req.body);
  }

  try {
    const start = performance.now();
    const response = await fetch(`${BASE_URL}${req.path}`, options);
    const elapsed = Math.round(performance.now() - start);

    let body: unknown;
    const contentType = response.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    // For spec endpoint, truncate the output
    if (req.path === "/_x-steady/spec" && typeof body === "object") {
      console.log(JSON.stringify(body, null, 2).substring(0, 200) + "...");
    } else {
      console.log(JSON.stringify(body, null, 2));
    }

    console.log(`⏱️  ${elapsed}ms\n`);
  } catch (error) {
    console.error(`❌ Error: ${error}\n`);
  }
}

async function main() {
  console.log("🧪 Running test requests for Steady...");
  console.log(
    "Make sure Steady is running with: steady -i test-recursive.yaml",
  );
  console.log("");

  // Add a small delay between requests to make them easier to follow
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i];
    if (request) {
      await runRequest(request, i);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log("✅ Test requests completed!");
  console.log("Check the interactive logger to explore request details");
}

if (import.meta.main) {
  await main();
}
