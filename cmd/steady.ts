import { parseArgs } from "@std/cli/parse-args";
import { parseSpecFromFile, SteadyError } from "@steady/openapi";
import type { LogLevel } from "../src/logging/mod.ts";
import {
  DEFAULT_PORT,
  type QueryArrayFormat,
  type QueryObjectFormat,
  type ServerConfig,
  type StreamingConfig,
  VALID_ARRAY_FORMATS,
  VALID_OBJECT_FORMATS,
  VERSION,
} from "../src/types.ts";

type LogFormat = "text" | "json";

// ANSI colors
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export async function main() {
  const args = parseArgs(Deno.args, {
    boolean: [
      "help",
      "version",
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
      "host",
      "log-level",
      "log-format",
      "validator-query-array-format",
      "validator-query-object-format",
      "validator-form-array-format",
      "validator-form-object-format",
      "generator-array-size",
      "generator-array-min",
      "generator-array-max",
      "generator-seed",
      "stream-count",
      "stream-interval",
    ],
    alias: {
      h: "help",
      r: "auto-reload",
      i: "interactive",
      p: "port",
      v: "log-level",
      verbose: "log-level",
    },
    default: {
      "log-level": "summary",
      "log-format": "text",
      "log": true,
    },
    negatable: ["log"],
  });

  if (args.version) {
    console.log(`steady ${VERSION}`);
    Deno.exit(0);
  }

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
  // Map "debug" to "full" for undocumented -v debug alias
  const logLevel = (args["log-level"] === "debug" ? "full" : args["log-level"]) as LogLevel;
  const logFormat = args["log-format"] as LogFormat;
  const portOverride = args.port ? parseInt(args.port, 10) : undefined;

  // Validate log format
  if (logFormat !== "text" && logFormat !== "json") {
    console.error(
      `${RED}${BOLD}ERROR:${RESET} Invalid --log-format: ${logFormat}`,
    );
    console.error(`Valid values: text, json`);
    Deno.exit(1);
  }

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

  // Validate form format args
  const formArrayFormat = args["validator-form-array-format"] as
    | QueryArrayFormat
    | undefined;
  const formObjectFormat = args["validator-form-object-format"] as
    | QueryObjectFormat
    | undefined;

  if (
    formArrayFormat &&
    !VALID_ARRAY_FORMATS.includes(formArrayFormat)
  ) {
    console.error(
      `${RED}${BOLD}ERROR:${RESET} Invalid --validator-form-array-format: ${formArrayFormat}`,
    );
    console.error(`Valid values: ${VALID_ARRAY_FORMATS.join(", ")}`);
    Deno.exit(1);
  }

  if (
    formObjectFormat &&
    !VALID_OBJECT_FORMATS.includes(formObjectFormat)
  ) {
    console.error(
      `${RED}${BOLD}ERROR:${RESET} Invalid --validator-form-object-format: ${formObjectFormat}`,
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

  // Parse streaming options
  const streamCount = args["stream-count"]
    ? parseInt(args["stream-count"], 10)
    : undefined;
  const streamInterval = args["stream-interval"]
    ? parseInt(args["stream-interval"], 10)
    : undefined;

  // Validate streaming options
  if (
    streamCount !== undefined &&
    (isNaN(streamCount) || streamCount < 1 || streamCount > 1000)
  ) {
    console.error(
      `${RED}${BOLD}ERROR:${RESET} Invalid --stream-count: must be between 1 and 1000`,
    );
    Deno.exit(1);
  }

  if (
    streamInterval !== undefined &&
    (isNaN(streamInterval) || streamInterval < 0 || streamInterval > 10000)
  ) {
    console.error(
      `${RED}${BOLD}ERROR:${RESET} Invalid --stream-interval: must be between 0 and 10000`,
    );
    Deno.exit(1);
  }

  const options = {
    logLevel,
    logFormat,
    logBodies: args["log-bodies"],
    log: args.log,
    mode,
    interactive: args.interactive,
    portOverride,
    host: args.host,
    validator: {
      strictOneOf: args["validator-strict-oneof"],
      queryArrayFormat,
      queryObjectFormat,
      formArrayFormat,
      formObjectFormat,
    },
    generator: {
      arrayMin: effectiveArrayMin,
      arrayMax: effectiveArrayMax,
      seed: generatorSeed,
    },
    streaming: {
      count: streamCount,
      interval: streamInterval,
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
    console.error("FATAL ERROR, steady shutting down")
    Deno.exit(1);
  }
}

async function startServer(
  specPath: string,
  options: {
    logLevel: LogLevel;
    logFormat: LogFormat;
    logBodies: boolean;
    log: boolean;
    mode: "strict" | "relaxed";
    interactive: boolean;
    portOverride?: number;
    host?: string;
    validator?: {
      strictOneOf?: boolean;
      queryArrayFormat?: QueryArrayFormat;
      queryObjectFormat?: QueryObjectFormat;
      formArrayFormat?: QueryArrayFormat;
      formObjectFormat?: QueryObjectFormat;
    };
    generator?: {
      arrayMin?: number;
      arrayMax?: number;
      seed?: number;
    };
    streaming?: StreamingConfig;
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
    host: options.host || "localhost",
    mode: options.mode,
    verbose: options.log,
    logLevel: options.log ? options.logLevel : "summary",
    logFormat: options.logFormat,
    logBodies: options.logBodies,
    showValidation: true,
    interactive: options.interactive,
    validator: options.validator,
    generator: options.generator,
    streaming: options.streaming,
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
    logFormat: LogFormat;
    logBodies: boolean;
    log: boolean;
    mode: "strict" | "relaxed";
    interactive: boolean;
    portOverride?: number;
    host?: string;
    validator?: {
      strictOneOf?: boolean;
      queryArrayFormat?: QueryArrayFormat;
      queryObjectFormat?: QueryObjectFormat;
      formArrayFormat?: QueryArrayFormat;
      formObjectFormat?: QueryObjectFormat;
    };
    generator?: {
      arrayMin?: number;
      arrayMax?: number;
      seed?: number;
    };
    streaming?: StreamingConfig;
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
  --host <host>            Bind to specific host (default: localhost)
  -r, --auto-reload        Auto-reload on spec file changes
  -i, --interactive        Interactive mode with expandable logs
  --log-level <level>      Set logging detail: summary|details|full (default: summary)
  --log-format <format>    Output format: text|json (default: text)
  --log-bodies             Show request/response bodies in summary mode
  --no-log                 Disable request logging
  --strict                 Strict validation mode (default)
  --relaxed                Relaxed validation mode
  -h, --help               Show this help message
  --version                Show version number

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

  --validator-form-array-format=<format>
                             How array form fields are serialized. Maps to OpenAPI style/explode:
                             - auto: read from OpenAPI spec's style/explode (default)
                             - repeat: tags=a&tags=b (style=form, explode=true)
                             - comma: tags=a,b (style=form, explode=false)
                             - space: tags=a%20b (style=spaceDelimited)
                             - pipe: tags=a|b (style=pipeDelimited)
                             - brackets: tags[]=a&tags[]=b (PHP/Rails style)

  --validator-form-object-format=<format>
                             How object form fields are serialized. Maps to OpenAPI style/explode:
                             - auto: read from OpenAPI spec's style/explode (default)
                             - flat: name=sam&age=30 (style=form, explode=true)
                             - flat-comma: id=role,admin,firstName,Alex (style=form, explode=false)
                             - brackets: user[name]=sam (style=deepObject)
                             - dots: user.name=sam (non-standard, SDK compat)

Generator Options:
  --generator-array-size=<n>   Exact array size for all arrays (sets both min and max)
  --generator-array-min=<n>    Minimum array size (default: 1)
                               If only min is set, arrays have exactly that size
  --generator-array-max=<n>    Maximum array size (default: 1)
                               If only max is set, arrays range from 1 to max
  --generator-seed=<n>         Seed for deterministic random generation
                               Use -1 for random (non-deterministic) results

Streaming Options:
  --stream-count=<n>           Number of items to stream (default: 5, max: 1000)
  --stream-interval=<n>        Interval between items in ms (default: 100)

Request Headers (per-request overrides):
  X-Steady-Mode: strict|relaxed   Override validation mode for this request
  X-Steady-Query-Array-Format     Override array query format for this request
  X-Steady-Query-Object-Format    Override object query format for this request
  X-Steady-Form-Array-Format      Override array form format for this request
  X-Steady-Form-Object-Format     Override object form format for this request
  X-Steady-Array-Size: <n>        Override array size (sets both min and max)
  X-Steady-Array-Min: <n>         Override minimum array size
  X-Steady-Array-Max: <n>         Override maximum array size
  X-Steady-Seed: <n>              Override seed (-1 for random)
  X-Steady-Stream-Count: <n>      Number of items to stream (default: 5, max: 1000)
  X-Steady-Stream-Interval-Ms: <n>  Interval between streamed items in ms (default: 100)

Response Headers (informational):
  X-Steady-Mode                   The validation mode used for this request
  X-Steady-Matched-Path           The OpenAPI path pattern that matched
  X-Steady-Example-Source         How the response was generated (generated|none)

Examples:
  steady api.yaml                          # Start with default settings
  steady -p 4010 api.yaml                  # Start on port 4010
  steady validate api.yaml                 # Validate specification
  steady --log-level=details api.yaml      # Show detailed logs
  steady --log-format=json api.yaml        # NDJSON output for CI
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
