#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env

import { parseSpec, SteadyError } from "@steady/parser";
import { LogLevel } from "@steady/shared";
import { ServerConfig } from "../src/types.ts";

// ANSI colors
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

// Helper to extract flag values
function extractFlag(
  args: string[],
  flag: string,
  defaultValue: string,
): string {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    const value = args[index + 1];
    if (value !== undefined) {
      return value;
    }
  }
  // Also check for --flag=value syntax
  const prefix = `${flag}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  if (found) {
    return found.substring(prefix.length);
  }
  return defaultValue;
}

async function main() {
  // Parse command line arguments
  const args = Deno.args;

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    Deno.exit(0);
  }

  // Check for validate command
  if (args[0] === "validate") {
    await validateCommand(args.slice(1));
    return;
  }

  // Parse flags
  const autoReload = args.includes("--auto-reload") || args.includes("-r");
  const logLevel = extractFlag(args, "--log-level", "summary") as
    | "summary"
    | "details"
    | "full";
  const logBodies = args.includes("--log-bodies");
  const noLog = args.includes("--no-log");
  const strictMode = args.includes("--strict");
  const relaxedMode = args.includes("--relaxed");
  const interactive = args.includes("--interactive") || args.includes("-i");

  // Filter out all flags to get the spec path
  const filteredArgs = args.filter((arg) =>
    !arg.startsWith("--") &&
    !arg.startsWith("-") &&
    arg !== "summary" &&
    arg !== "details" &&
    arg !== "full"
  );

  const specPath = filteredArgs[0];
  if (!specPath) {
    console.error(`${RED}${BOLD}ERROR:${RESET} No spec file provided`);
    Deno.exit(1);
  }

  // Determine mode
  let mode: "strict" | "relaxed" = "strict";
  if (relaxedMode) mode = "relaxed";
  if (strictMode) mode = "strict"; // strict takes precedence

  const options = {
    logLevel,
    logBodies,
    noLog,
    mode,
    interactive,
  };

  try {
    if (autoReload) {
      console.log(
        `🔄 ${BOLD}Auto-reload enabled${RESET} - restarting on changes to ${specPath}\n`,
      );
      await startWithWatch(specPath, options);
    } else {
      await startServer(specPath, options);
    }
  } catch (error) {
    if (error instanceof SteadyError) {
      console.error(error.format());
    } else {
      console.error(
        `${RED}${BOLD}ERROR:${RESET} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    Deno.exit(1);
  }
}

async function startServer(
  specPath: string,
  options: {
    logLevel: LogLevel;
    logBodies: boolean;
    noLog: boolean;
    mode: "strict" | "relaxed";
    interactive: boolean;
  },
): Promise<{ start: () => void; stop: () => void }> {
  // Lazy import to avoid loading server code for validate command
  const { MockServer } = await import("../src/server.ts");
  // Parse the OpenAPI spec
  const spec = await parseSpec(specPath);

  // Determine port from spec or use default
  let port = 3000;
  if (spec.servers && spec.servers.length > 0 && spec.servers[0]) {
    const serverUrl = new URL(spec.servers[0].url);
    if (serverUrl.port) {
      port = parseInt(serverUrl.port);
    }
  }

  // Create server config
  const config: ServerConfig = {
    port,
    host: "localhost",
    mode: options.mode,
    verbose: !options.noLog,
    logLevel: options.noLog ? "summary" : options.logLevel,
    logBodies: options.logBodies,
    showValidation: true,
    interactive: options.interactive,
  };

  // Create and start server
  const server = new MockServer(spec, config);
  server.start();
  return server;
}

async function startWithWatch(
  specPath: string,
  options: {
    logLevel: LogLevel;
    logBodies: boolean;
    noLog: boolean;
    mode: "strict" | "relaxed";
    interactive: boolean;
  },
) {
  let server: { start: () => void; stop: () => void } | null = null;

  // Initial start
  try {
    server = await startServer(specPath, options);
  } catch (error) {
    if (error instanceof SteadyError) {
      console.error(error.format());
    } else {
      console.error(
        `${RED}${BOLD}ERROR:${RESET} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Watch for changes
  const watcher = Deno.watchFs(specPath);
  for await (const event of watcher) {
    if (event.kind === "modify") {
      console.log(
        `\n🔄 ${BOLD}Detected change${RESET} - restarting server...\n`,
      );

      // Stop existing server
      if (server) {
        server.stop();
        // Give it a moment to clean up
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Restart
      try {
        server = await startServer(specPath, options);
      } catch (error) {
        if (error instanceof SteadyError) {
          console.error(error.format());
          console.error(
            `\n⚠️  ${BOLD}Server not restarted${RESET} - fix the error and save again\n`,
          );
        } else {
          console.error(
            `${RED}${BOLD}ERROR:${RESET} ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }
}

async function validateCommand(args: string[]) {
  const GREEN = "\x1b[32m";

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
${BOLD}steady validate${RESET} - Check if spec will work with Steady

Usage: steady validate <openapi-spec>

Checks if an OpenAPI 3.0 or 3.1 specification file can be loaded by the mock server.
This is not a linter - it only verifies the spec is parseable and has required fields.

Examples:
  steady validate api.yaml
  steady validate openapi.json
`);
    Deno.exit(0);
  }

  const specPath = args[0];

  if (!specPath) {
    console.error(`${RED}${BOLD}ERROR:${RESET} No spec file provided`);
    console.error(`\nUsage: steady validate <spec-file>`);
    Deno.exit(1);
  }

  try {
    // Parse the spec - this will throw if invalid
    await parseSpec(specPath);

    // If we get here, spec is valid
    console.log(`${GREEN}✓${RESET} All good`);
  } catch (error) {
    if (error instanceof SteadyError) {
      console.error(error.format());
    } else {
      console.error(
        `${RED}${BOLD}ERROR:${RESET} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    Deno.exit(1);
  }
}

function printHelp() {
  console.log(`
${BOLD}Steady - The Reliable OpenAPI 3 Mock Server${RESET}

Usage: steady [command] [options] <openapi-spec>

Commands:
  validate <spec>          Validate an OpenAPI specification
  <spec>                   Start mock server (default command)

Arguments:
  <openapi-spec>    Path to OpenAPI 3.0/3.1 specification file (YAML or JSON)

Options:
  -r, --auto-reload        Auto-reload on spec file changes
  -i, --interactive        Interactive mode with expandable logs
  --log-level <level>      Set logging detail: summary|details|full (default: summary)
  --log-bodies             Show request/response bodies in summary mode
  --no-log                 Disable request logging
  --strict                 Strict validation mode (default)
  --relaxed                Relaxed validation mode
  -h, --help               Show this help message

Examples:
  steady api.yaml                          # Start with default settings
  steady validate api.yaml                 # Validate specification
  steady --log-level=details api.yaml      # Show detailed logs
  steady --log-bodies api.yaml             # Show bodies in summary mode
  steady --relaxed api.yaml                # Allow validation warnings
  steady -r api.yaml                       # Auto-reload on file changes
  steady -i api.yaml                       # Interactive mode with expandable logs

Steady provides rock-solid API mocking with excellent error messages.
`);
}

// Run the CLI
if (import.meta.main) {
  main();
}
