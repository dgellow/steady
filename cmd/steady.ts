import { parseArgs } from "@std/cli/parse-args";
import { parseSpecFromFile, SteadyError } from "@steady/openapi";
import { LogLevel } from "../src/logging/mod.ts";
import {
  DEFAULT_PORT,
  type QueryArrayFormat,
  type QueryObjectFormat,
  type ServerConfig,
  VALID_ARRAY_FORMATS,
  VALID_OBJECT_FORMATS,
} from "../src/types.ts";

// ANSI colors
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export async function main() {
  const args = parseArgs(Deno.args, {
    boolean: [
      "help",
      "auto-reload",
      "log-bodies",
      "log",
      "strict",
      "relaxed",
      "interactive",
      "validator-strict-oneof",
    ],
    string: [
      "port",
      "log-level",
      "validator-query-array-format",
      "validator-query-object-format",
      "generator-array-size",
      "generator-array-min",
      "generator-array-max",
      "generator-seed",
    ],
    alias: {
      h: "help",
      r: "auto-reload",
      i: "interactive",
      p: "port",
    },
    default: {
      "log-level": "summary",
      "log": true,
    },
    negatable: ["log"],
  });

  if (args.help || args._.length === 0) {
    printHelp();
    Deno.exit(0);
  }

  // Check for validate command
  const firstArg = String(args._[0]);
  if (firstArg === "validate") {
    await validateCommand(args._.slice(1).map(String));
    return;
  }

  // Parse options
  const specPath = firstArg;
  const logLevel = args["log-level"] as "summary" | "details" | "full";
  const portOverride = args.port ? parseInt(args.port, 10) : undefined;

  // Determine mode
  let mode: "strict" | "relaxed" = "strict";
  if (args.relaxed) mode = "relaxed";
  if (args.strict) mode = "strict"; // strict takes precedence

  // Validate query format args
  const queryArrayFormat = args["validator-query-array-format"] as
    | QueryArrayFormat
    | undefined;
  const queryObjectFormat = args["validator-query-object-format"] as
    | QueryObjectFormat
    | undefined;

  if (
    queryArrayFormat &&
    !VALID_ARRAY_FORMATS.includes(queryArrayFormat)
  ) {
    console.error(
      `${RED}${BOLD}ERROR:${RESET} Invalid --validator-query-array-format: ${queryArrayFormat}`,
    );
    console.error(`Valid values: ${VALID_ARRAY_FORMATS.join(", ")}`);
    Deno.exit(1);
  }

  if (
    queryObjectFormat &&
    !VALID_OBJECT_FORMATS.includes(queryObjectFormat)
  ) {
    console.error(
      `${RED}${BOLD}ERROR:${RESET} Invalid --validator-query-object-format: ${queryObjectFormat}`,
    );
    console.error(`Valid values: ${VALID_OBJECT_FORMATS.join(", ")}`);
    Deno.exit(1);
  }

  // Parse generator options
  const generatorArraySize = args["generator-array-size"]
    ? parseInt(args["generator-array-size"], 10)
    : undefined;
  const generatorArrayMin = args["generator-array-min"]
    ? parseInt(args["generator-array-min"], 10)
    : undefined;
  const generatorArrayMax = args["generator-array-max"]
    ? parseInt(args["generator-array-max"], 10)
    : undefined;
  const generatorSeed = args["generator-seed"]
    ? parseInt(args["generator-seed"], 10)
    : undefined;

  // If array-size is set, it overrides both min and max
  const effectiveArrayMin = generatorArraySize ?? generatorArrayMin;
  const effectiveArrayMax = generatorArraySize ?? generatorArrayMax;

  const options = {
    logLevel,
    logBodies: args["log-bodies"],
    log: args.log,
    mode,
    interactive: args.interactive,
    portOverride,
    validator: {
      strictOneOf: args["validator-strict-oneof"],
      queryArrayFormat,
      queryObjectFormat,
    },
    generator: {
      arrayMin: effectiveArrayMin,
      arrayMax: effectiveArrayMax,
      seed: generatorSeed,
    },
  };

  try {
    if (args["auto-reload"]) {
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
    log: boolean;
    mode: "strict" | "relaxed";
    interactive: boolean;
    portOverride?: number;
    validator?: {
      strictOneOf?: boolean;
      queryArrayFormat?: QueryArrayFormat;
      queryObjectFormat?: QueryObjectFormat;
    };
    generator?: {
      arrayMin?: number;
      arrayMax?: number;
      seed?: number;
    };
  },
): Promise<{ start: () => void; stop: () => Promise<void> }> {
  // Lazy import to avoid loading server code for validate command
  const { MockServer } = await import("../src/server.ts");
  // Parse the OpenAPI spec
  const spec = await parseSpecFromFile(specPath);

  // Determine port: CLI flag > spec > default
  let port = options.portOverride ?? DEFAULT_PORT;
  if (
    !options.portOverride && spec.servers && spec.servers.length > 0 &&
    spec.servers[0]
  ) {
    try {
      const serverUrl = new URL(spec.servers[0].url);
      if (serverUrl.port) {
        port = parseInt(serverUrl.port, 10);
      }
    } catch {
      // Invalid URL in spec.servers - ignore and use default port
    }
  }

  // Create server config
  const config: ServerConfig = {
    port,
    host: "localhost",
    mode: options.mode,
    verbose: options.log,
    logLevel: options.log ? options.logLevel : "summary",
    logBodies: options.logBodies,
    showValidation: true,
    interactive: options.interactive,
    validator: options.validator,
    generator: options.generator,
  };

  // Create and start server
  const server = new MockServer(spec, config);
  await server.init();
  server.start();
  return server;
}

async function startWithWatch(
  specPath: string,
  options: {
    logLevel: LogLevel;
    logBodies: boolean;
    log: boolean;
    mode: "strict" | "relaxed";
    interactive: boolean;
    portOverride?: number;
    validator?: {
      strictOneOf?: boolean;
      queryArrayFormat?: QueryArrayFormat;
      queryObjectFormat?: QueryObjectFormat;
    };
    generator?: {
      arrayMin?: number;
      arrayMax?: number;
      seed?: number;
    };
  },
) {
  let server: { start: () => void; stop: () => Promise<void> } | null = null;

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

      // Stop existing server and wait for it to fully shut down
      if (server) {
        await server.stop();
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
    await parseSpecFromFile(specPath);

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
${BOLD}Steady${RESET} - OpenAPI 3 mock server

Usage: steady [command] [options] <openapi-spec>

Commands:
  validate <spec>          Validate an OpenAPI specification
  <spec>                   Start mock server (default command)

Arguments:
  <openapi-spec>    Path to OpenAPI 3.0/3.1 specification file (YAML or JSON)

Options:
  -p, --port <port>        Override server port (default: from spec or 3000)
  -r, --auto-reload        Auto-reload on spec file changes
  -i, --interactive        Interactive mode with expandable logs
  --log-level <level>      Set logging detail: summary|details|full (default: summary)
  --log-bodies             Show request/response bodies in summary mode
  --no-log                 Disable request logging
  --strict                 Strict validation mode (default)
  --relaxed                Relaxed validation mode
  -h, --help               Show this help message

Validator Options:
  --validator-strict-oneof   Require exactly one oneOf variant to match (strict JSON Schema)
                             Default: false (union-like, any variant matching is OK)

  --validator-query-array-format=<format>
                             How array query params are serialized. Maps to OpenAPI style/explode:
                             - auto: read from OpenAPI spec's style/explode (default)
                             - repeat: colors=red&colors=green (style=form, explode=true)
                             - comma: colors=red,green,blue (style=form, explode=false)
                             - space: colors=red%20green%20blue (style=spaceDelimited)
                             - pipe: colors=red|green|blue (style=pipeDelimited)
                             - brackets: colors[]=red&colors[]=green (PHP/Rails style)

  --validator-query-object-format=<format>
                             How object query params are serialized. Maps to OpenAPI style/explode:
                             - auto: read from OpenAPI spec's style/explode (default)
                             - flat: role=admin&firstName=Alex (style=form, explode=true)
                             - flat-comma: id=role,admin,firstName,Alex (style=form, explode=false)
                             - brackets: id[role]=admin&id[firstName]=Alex (style=deepObject)
                             - dots: id.role=admin&id.firstName=Alex (non-standard, SDK compat)

Generator Options:
  --generator-array-size=<n>   Exact array size for all arrays (sets both min and max)
  --generator-array-min=<n>    Minimum array size (default: 1)
                               If only min is set, arrays have exactly that size
  --generator-array-max=<n>    Maximum array size (default: 1)
                               If only max is set, arrays range from 1 to max
  --generator-seed=<n>         Seed for deterministic random generation
                               Use -1 for random (non-deterministic) results

Request Headers (per-request overrides):
  X-Steady-Mode: strict|relaxed   Override validation mode for this request
  X-Steady-Query-Array-Format     Override array query format for this request
  X-Steady-Query-Object-Format    Override object query format for this request
  X-Steady-Array-Size: <n>        Override array size (sets both min and max)
  X-Steady-Array-Min: <n>         Override minimum array size
  X-Steady-Array-Max: <n>         Override maximum array size
  X-Steady-Seed: <n>              Override seed (-1 for random)

Response Headers (informational):
  X-Steady-Mode                   The validation mode used for this request
  X-Steady-Matched-Path           The OpenAPI path pattern that matched
  X-Steady-Example-Source         How the response was generated (generated|none)

Examples:
  steady api.yaml                          # Start with default settings
  steady -p 4010 api.yaml                  # Start on port 4010
  steady validate api.yaml                 # Validate specification
  steady --log-level=details api.yaml      # Show detailed logs
  steady --log-bodies api.yaml             # Show bodies in summary mode
  steady --relaxed api.yaml                # Allow validation warnings
  steady -r api.yaml                       # Auto-reload on file changes
  steady -i api.yaml                       # Interactive mode with expandable logs

`);
}

// Run the CLI
if (import.meta.main) {
  main();
}
