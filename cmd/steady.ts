import { parseArgs } from "@std/cli/parse-args";
import {
  ParseError,
  parseSpecFromFile,
  SpecValidationError,
  SteadyError,
} from "@steady/openapi";
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
import { analyzeSpec } from "../src/engine/spec-analyzer.ts";
import type { Diagnostic } from "../src/diagnostic.ts";
import { getCode } from "../src/codes/registry.ts";
import { colorize, colors } from "../src/logging/colors.ts";
import {
  formatDiagnostics,
  formatDiagnosticSummary,
  formatExplainHint,
} from "../src/logging/format-diagnostic.ts";

type LogFormat = "text" | "json";

/** Signals that spec analysis found fatal issues (unresolvable). */
class FatalSpecError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super("Fatal spec issues detected");
    this.name = "FatalSpecError";
  }
}

/**
 * Convert a ParseError or SpecValidationError into Diagnostic[] for
 * consistent CLI display through the diagnostics formatter.
 */
function errorToDiagnostics(
  error: ParseError | SpecValidationError,
): Diagnostic[] {
  const isParseError = error instanceof ParseError;
  const code = isParseError ? "E1001" : "E1002";
  const def = getCode(code);

  return [{
    code,
    severity: def.severity,
    category: def.category,
    requestPath: "",
    specPointer: "",
    message: error.message,
    attribution: {
      confidence: 1.0,
      reasoning: [
        isParseError
          ? "File could not be parsed as valid JSON or YAML"
          : "OpenAPI version is not supported",
      ],
    },
    suggestion: error.context.suggestion,
  }];
}

export async function main() {
  const args = parseArgs(Deno.args, {
    boolean: [
      "help",
      "version",
      "auto-reload",
      "log-bodies",
      "log",
      "reject-on-sdk-error",
      "interactive",
      "validator-strict-oneof",
      "no-color",
      "fail-on-ambiguous",
      "fail-on-warnings",
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

  // Resolve color: --no-color flag or NO_COLOR env force off, otherwise TTY detection
  const useColor = args["no-color"]
    ? false
    : Deno.env.get("NO_COLOR") !== undefined
    ? false
    : Deno.stderr.isTerminal();

  /** Format a CLI error prefix. */
  function cliError(msg: string): string {
    return `${colorize("ERROR:", colors.bold + colors.red, useColor)} ${msg}`;
  }

  if (args.version) {
    console.log(`steady ${VERSION}`);
    Deno.exit(0);
  }

  if (args.help || args._.length === 0) {
    printHelp(useColor);
    Deno.exit(0);
  }

  // Check for subcommands
  const firstArg = String(args._[0]);
  if (firstArg === "validate") {
    await validateCommand(args._.slice(1).map(String), useColor);
    return;
  }

  if (firstArg === "explain") {
    const { explainCommand } = await import("../src/codes/explain.ts");
    explainCommand(args._.slice(1).map(String), useColor);
    return;
  }

  // Parse options
  const specPath = firstArg;
  // Map "debug" to "full" for undocumented -v debug alias
  const logLevel =
    (args["log-level"] === "debug" ? "full" : args["log-level"]) as LogLevel;
  const logFormat = args["log-format"] as LogFormat;
  const portOverride = args.port ? parseInt(args.port, 10) : undefined;

  // Validate log format
  if (logFormat !== "text" && logFormat !== "json") {
    console.error(
      cliError(`Invalid --log-format: ${logFormat}`),
    );
    console.error(`Valid values: text, json`);
    Deno.exit(1);
  }

  // Determine reject-on-sdk-error
  const rejectOnSdkError = args["reject-on-sdk-error"] ?? false;

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
      cliError(`Invalid --validator-query-array-format: ${queryArrayFormat}`),
    );
    console.error(`Valid values: ${VALID_ARRAY_FORMATS.join(", ")}`);
    Deno.exit(1);
  }

  if (
    queryObjectFormat &&
    !VALID_OBJECT_FORMATS.includes(queryObjectFormat)
  ) {
    console.error(
      cliError(`Invalid --validator-query-object-format: ${queryObjectFormat}`),
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
      cliError(`Invalid --validator-form-array-format: ${formArrayFormat}`),
    );
    console.error(`Valid values: ${VALID_ARRAY_FORMATS.join(", ")}`);
    Deno.exit(1);
  }

  if (
    formObjectFormat &&
    !VALID_OBJECT_FORMATS.includes(formObjectFormat)
  ) {
    console.error(
      cliError(`Invalid --validator-form-object-format: ${formObjectFormat}`),
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
      cliError("Invalid --stream-count: must be between 1 and 1000"),
    );
    Deno.exit(1);
  }

  if (
    streamInterval !== undefined &&
    (isNaN(streamInterval) || streamInterval < 0 || streamInterval > 10000)
  ) {
    console.error(
      cliError("Invalid --stream-interval: must be between 0 and 10000"),
    );
    Deno.exit(1);
  }

  const options = {
    logLevel,
    logFormat,
    logBodies: args["log-bodies"],
    log: args.log,
    rejectOnSdkError,
    interactive: args.interactive,
    portOverride,
    host: args.host,
    color: useColor,
    failOnAmbiguous: args["fail-on-ambiguous"],
    failOnWarnings: args["fail-on-warnings"],
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
        `${
          colorize("Auto-reload enabled", colors.bold, useColor)
        } - restarting on changes to ${specPath}\n`,
      );
      await startWithWatch(specPath, options);
    } else {
      await startServer(specPath, options);
    }
  } catch (error) {
    if (error instanceof FatalSpecError) {
      console.error(formatDiagnostics(error.diagnostics, useColor));
      console.error();
      console.error(formatDiagnosticSummary(error.diagnostics, useColor));
      console.error(formatExplainHint(error.diagnostics, useColor));
      console.error();
      console.error("Steady cannot load this spec. Fix the error and retry.");
      Deno.exit(3);
    } else if (
      error instanceof ParseError || error instanceof SpecValidationError
    ) {
      const diagnostics = errorToDiagnostics(error);
      console.error(formatDiagnostics(diagnostics, useColor));
      console.error();
      console.error(formatDiagnosticSummary(diagnostics, useColor));
      console.error(formatExplainHint(diagnostics, useColor));
      Deno.exit(3);
    } else if (error instanceof SteadyError) {
      console.error(error.format());
    } else {
      console.error(
        cliError(error instanceof Error ? error.message : String(error)),
      );
    }
    console.error("FATAL ERROR, steady shutting down");
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
    rejectOnSdkError: boolean;
    interactive: boolean;
    portOverride?: number;
    host?: string;
    color: boolean;
    failOnAmbiguous?: boolean;
    failOnWarnings?: boolean;
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
  const { spec, defaultedFields } = await parseSpecFromFile(specPath);

  // Run spec analysis
  const baseUri = specPathToBaseUri(specPath);
  const analysis = await analyzeSpec(spec, { baseUri, defaultedFields });
  if (analysis.fatal) {
    throw new FatalSpecError(analysis.diagnostics);
  }

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
    rejectOnSdkError: options.rejectOnSdkError,
    verbose: options.log,
    logLevel: options.log ? options.logLevel : "summary",
    logFormat: options.logFormat,
    logBodies: options.logBodies,
    showValidation: true,
    interactive: options.interactive,
    color: options.color,
    validator: options.validator,
    generator: options.generator,
    streaming: options.streaming,
    startupDiagnostics: analysis.diagnostics,
    specPath,
    failOnAmbiguous: options.failOnAmbiguous,
    failOnWarnings: options.failOnWarnings,
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
    rejectOnSdkError: boolean;
    interactive: boolean;
    portOverride?: number;
    host?: string;
    color: boolean;
    failOnAmbiguous?: boolean;
    failOnWarnings?: boolean;
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
  const useColor = options.color;
  let server: { start: () => void; stop: () => Promise<void> } | null = null;

  // Initial start. Fatal spec errors exit immediately
  try {
    server = await startServer(specPath, options);
  } catch (error) {
    if (error instanceof FatalSpecError) {
      throw error; // Propagate to main() for exit code 3
    }
    if (error instanceof SteadyError) {
      console.error(error.format());
    } else {
      console.error(
        colorize("ERROR:", colors.bold + colors.red, useColor) + " " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  // Watch for changes
  const watcher = Deno.watchFs(specPath);
  for await (const event of watcher) {
    if (event.kind === "modify") {
      console.log(
        `\n${
          colorize("Detected change", colors.bold, useColor)
        } - restarting server...\n`,
      );

      // Stop existing server and wait for it to fully shut down
      if (server) {
        await server.stop();
      }

      // Restart
      try {
        server = await startServer(specPath, options);
      } catch (error) {
        server = null;
        if (error instanceof FatalSpecError) {
          console.error(formatDiagnostics(error.diagnostics, useColor));
          console.error();
          console.error(
            formatDiagnosticSummary(error.diagnostics, useColor),
          );
          console.error(formatExplainHint(error.diagnostics, useColor));
          console.error();
          console.error(
            "Steady cannot load this spec. Fix the error and retry.",
          );
        } else if (error instanceof SteadyError) {
          console.error(error.format());
        } else {
          console.error(
            colorize("ERROR:", colors.bold + colors.red, useColor) + " " +
              (error instanceof Error ? error.message : String(error)),
          );
        }
        console.error(
          `\n${
            colorize("Server not restarted", colors.bold, useColor)
          } - fix the error and save again\n`,
        );
      }
    }
  }
}

async function validateCommand(args: string[], useColor: boolean) {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
${
      colorize("steady validate", colors.bold, useColor)
    } - Check if spec will work with Steady

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
    console.error(
      colorize("ERROR:", colors.bold + colors.red, useColor) +
        " No spec file provided",
    );
    console.error(`\nUsage: steady validate <spec-file>`);
    Deno.exit(1);
  }

  try {
    // Parse the spec - this will throw if invalid
    const { spec, defaultedFields } = await parseSpecFromFile(specPath);

    // Run spec analysis
    const baseUri = specPathToBaseUri(specPath);
    const analysis = await analyzeSpec(spec, { baseUri, defaultedFields });

    if (analysis.diagnostics.length === 0) {
      console.log("All good");
      return;
    }

    // Display diagnostics using shared formatter
    console.error(formatDiagnostics(analysis.diagnostics, useColor));
    console.error();
    console.error(formatDiagnosticSummary(analysis.diagnostics, useColor));
    console.error(formatExplainHint(analysis.diagnostics, useColor));

    if (analysis.fatal) {
      Deno.exit(3);
    }
  } catch (error) {
    if (
      error instanceof ParseError || error instanceof SpecValidationError
    ) {
      const diagnostics = errorToDiagnostics(error);
      console.error(formatDiagnostics(diagnostics, useColor));
      console.error();
      console.error(formatDiagnosticSummary(diagnostics, useColor));
      console.error(formatExplainHint(diagnostics, useColor));
      Deno.exit(3);
    } else if (error instanceof SteadyError) {
      console.error(error.format());
    } else {
      console.error(
        colorize("ERROR:", colors.bold + colors.red, useColor) + " " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
    Deno.exit(1);
  }
}

function specPathToBaseUri(specPath: string): string {
  const isUrl = specPath.startsWith("http://") ||
    specPath.startsWith("https://");
  return isUrl ? specPath : `file://${specPath}`;
}

function printHelp(useColor: boolean) {
  console.log(`
${colorize("Steady", colors.bold, useColor)} - OpenAPI 3 mock server

Usage: steady [command] [options] <openapi-spec>

Commands:
  validate <spec>          Validate an OpenAPI specification
  explain [code...]        Explain diagnostic codes (e.g., steady explain E3008)
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
  --reject-on-sdk-error    Return 400 for SDK issues (E3xxx) instead of mock response
  --fail-on-ambiguous      Exit 1 if any ambiguous diagnostics found (CI mode)
  --fail-on-warnings       Exit 1 if any warning-level diagnostics found (CI mode)
  --no-color               Disable colored output (also respects NO_COLOR env)
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
  X-Steady-Reject-On-Error: true  Return 400 for SDK issues on this request
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
  X-Steady-Valid                   "true" if no SDK issues, "false" otherwise
  X-Steady-Error-Count             Number of validation diagnostics
  X-Steady-Error-N-Code            E-code for Nth diagnostic
  X-Steady-Error-N-Path            Request location (e.g., body.email)
  X-Steady-Error-N-Message         Human-readable description
  X-Steady-Matched-Path            Spec path pattern matched (e.g., /users/{id})
  X-Steady-Example-Source          "generated" if response was generated from schema,
                                   "none" if no response body

Examples:
  steady api.yaml                          # Start with default settings
  steady -p 4010 api.yaml                  # Start on port 4010
  steady validate api.yaml                 # Validate specification
  steady explain E3008                     # Explain a diagnostic code
  steady explain                           # List all diagnostic codes
  steady --log-level=details api.yaml      # Show detailed logs
  steady --log-format=json api.yaml        # NDJSON output for CI
  steady --log-bodies api.yaml             # Show bodies in summary mode
  steady --reject-on-sdk-error api.yaml    # 400 for SDK issues
  steady -r api.yaml                       # Auto-reload on file changes
  steady -i api.yaml                       # Interactive mode with expandable logs

`);
}

// Run the CLI
if (import.meta.main) {
  main();
}
