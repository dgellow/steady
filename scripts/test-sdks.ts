#!/usr/bin/env -S deno run -A
/**
 * Test Steady against SDK test suites
 *
 * Usage:
 *   deno run -A scripts/test-sdks.ts              # Test all SDKs
 *   deno run -A scripts/test-sdks.ts --go         # Test Go SDKs only
 *   deno run -A scripts/test-sdks.ts --python     # Test Python SDKs only
 *   deno run -A scripts/test-sdks.ts openai       # Test SDKs matching "openai"
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { blue, dim, green, red } from "@std/fmt/colors";

const log = (msg: string) => console.log(`${blue("==>")} ${msg}`);
const success = (msg: string) => console.log(`${green("✓")}   ${msg}`);
const fail = (msg: string) => console.log(`${red("✗")}   ${msg}`);

const STEADY_DIR = path.dirname(
  path.dirname(path.fromFileUrl(import.meta.url)),
);
const SDK_DIR = path.join(STEADY_DIR, "sdk-tests");
const PORT = 4010;

interface SDK {
  repo: string;
  name: string;
  language: "go" | "python" | "typescript";
  /**
   * Validator flags for the mock script this runner writes. Not used when
   * the SDK's own `scripts/mock` starts Steady: that script has its flags.
   */
  validatorFlags?: string[];
  /** Skip in CI (too slow, etc.) */
  ciSkip?: boolean;
}

// List of SDKs to test.
//
// An SDK belongs here when its repository carries what a run needs: a
// `scripts/mock` that starts Steady with the SDK's own spec, or an
// `openapi-spec.yml`. An SDK whose spec cannot be obtained, or whose
// repository cannot be cloned, is a red "not run" job on every pull request
// and says nothing about Steady.
const SDKS: SDK[] = [
  {
    repo: "openai/openai-python",
    name: "openai-python",
    language: "python",
    validatorFlags: [
      "--validator-query-array-format=brackets",
      "--validator-query-object-format=brackets",
      "--validator-form-array-format=brackets",
      "--validator-form-object-format=brackets",
    ],
  },
  {
    repo: "openai/openai-node",
    name: "openai-typescript",
    language: "typescript",
    validatorFlags: [
      "--validator-query-array-format=brackets",
      "--validator-query-object-format=brackets",
      "--validator-form-array-format=brackets",
      "--validator-form-object-format=brackets",
    ],
  },
  {
    repo: "anthropics/anthropic-sdk-python",
    name: "anthropic-sdk-python",
    language: "python",
  },
  {
    repo: "groq/groq-python",
    name: "groq-python",
    language: "python",
    validatorFlags: [
      "--validator-form-array-format=brackets",
    ],
  },
  {
    repo: "meta-llama/llama-stack-client-python",
    name: "llama-stack-client-python",
    language: "python",
  },
  {
    repo: "cloudflare/cloudflare-python",
    name: "cloudflare-python",
    language: "python",
    ciSkip: true, // ~20min, too slow for CI
    validatorFlags: [
      "--validator-query-object-format=dots",
    ],
  },
  {
    repo: "browserbase/sdk-python",
    name: "browserbase-python",
    language: "python",
  },
  {
    repo: "Finch-API/finch-api-python",
    name: "finch-api-python",
    language: "python",
    validatorFlags: [
      "--validator-query-array-format=brackets",
    ],
  },
  {
    repo: "orbcorp/orb-python",
    name: "orb-python",
    language: "python",
    validatorFlags: [
      "--validator-query-array-format=brackets",
    ],
  },
  {
    repo: "knocklabs/knock-python",
    name: "knock-python",
    language: "python",
  },
];

/**
 * The SDK's test suite could not be started against Steady: no clone, no
 * spec, no mock server, no test script. This says nothing about Steady or the
 * SDK, so it is never reported as a test failure.
 */
class HarnessError extends Error {
  override name = "HarnessError";
}

interface TestResultBase {
  name: string;
  /** Number of tests passed (if available) */
  testsPassed?: number;
  /** Number of tests failed (if available) */
  testsFailed?: number;
}

/** The suite ran against Steady. `passed` is its outcome. */
interface SuiteResult extends TestResultBase {
  ran: true;
  passed: boolean;
}

/** The suite did not run. `error` says why. */
interface NotRunResult extends TestResultBase {
  ran: false;
  passed: false;
  error: string;
}

type TestResult = SuiteResult | NotRunResult;

/** Exit codes of this script. The CI workflow tells them apart. */
const EXIT_SUITE_FAILED = 1;
const EXIT_NOT_RUN = 2;

interface TestReport {
  /** ISO timestamp of when tests were run */
  timestamp: string;
  /** Git commit SHA if available */
  commitSha?: string;
  /** Git branch name if available */
  branch?: string;
  /** Summary counts */
  summary: {
    total: number;
    passed: number;
    failed: number;
    /** SDKs whose suite could not be run. Not included in `failed`. */
    notRun: number;
  };
  /** Individual SDK results */
  results: TestResult[];
}

async function killPort(port: number): Promise<void> {
  try {
    const cmd = new Deno.Command("lsof", {
      args: ["-ti", `:${port}`],
      stdout: "piped",
      stderr: "null",
    });
    const result = await cmd.output();
    const pids = new TextDecoder().decode(result.stdout).trim().split("\n");

    for (const pid of pids) {
      if (pid) {
        try {
          Deno.kill(parseInt(pid), "SIGTERM");
        } catch {
          // Process may have already exited
        }
      }
    }
  } catch {
    // No process on port
  }
}

async function cloneRepo(sdk: SDK): Promise<string> {
  const sdkPath = path.join(SDK_DIR, sdk.name);

  if (await exists(sdkPath)) {
    return sdkPath;
  }

  log(`Cloning ${sdk.repo}...`);
  const cmd = new Deno.Command("git", {
    args: [
      "clone",
      "--depth",
      "1",
      `https://github.com/${sdk.repo}.git`,
      sdkPath,
    ],
    stdout: "null",
    stderr: "piped",
  });

  const result = await cmd.output();
  if (!result.success) {
    throw new HarnessError(
      `Failed to clone ${sdk.repo}: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    );
  }

  return sdkPath;
}

async function findSpec(sdkPath: string): Promise<string | null> {
  // Check for local spec files
  for (const name of ["openapi-spec.yml", "openapi-spec.yaml"]) {
    const specPath = path.join(sdkPath, name);
    if (await exists(specPath)) {
      return specPath;
    }
  }

  // Check .stats.yml for spec URL
  const statsPath = path.join(sdkPath, ".stats.yml");
  if (await exists(statsPath)) {
    const content = await Deno.readTextFile(statsPath);
    const match = content.match(/openapi_spec_url:\s*(.+)/);
    if (match && match[1]) {
      const url = match[1].trim();
      log(`  Downloading spec from ${url}...`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new HarnessError(
          `Failed to download spec from ${url}: HTTP ${response.status}`,
        );
      }
      const specPath = path.join(sdkPath, "openapi-spec.yml");
      await Deno.writeTextFile(specPath, await response.text());
      return specPath;
    }
  }

  return null;
}

/** Command that runs the Steady in this checkout. */
const LOCAL_STEADY =
  `deno run --config "${STEADY_DIR}/deno.json" --allow-read --allow-net --allow-env --allow-write "${STEADY_DIR}/cmd/steady.ts"`;

/**
 * The ways an SDK's own `scripts/mock` starts Steady. An SDK that uses Steady
 * as its mock server ships everything the run needs in that script: the spec
 * (embedded, or a file in the repository) and the validator flags its
 * generator chose. Only the Steady it starts has to change.
 */
const SDK_STEADY_LAUNCHERS = [
  // Released CLI from npm, pinned to a version.
  /npm exec --package=@stdy\/cli@\S+ -- steady/g,
  // Vendored launcher script.
  /\.\/scripts\/run-steady/g,
];

/**
 * Point the SDK's own `scripts/mock` at the Steady in this checkout.
 *
 * Returns false when the SDK has no `scripts/mock` or the script does not
 * start Steady (older SDKs start a different mock server). The caller then
 * has to provide a spec and a mock script itself.
 */
async function adoptSdkMockScript(sdkPath: string): Promise<boolean> {
  const mockPath = path.join(sdkPath, "scripts", "mock");
  if (!(await exists(mockPath))) return false;

  const original = await Deno.readTextFile(mockPath);
  let adopted = original;
  for (const launcher of SDK_STEADY_LAUNCHERS) {
    adopted = adopted.replace(launcher, LOCAL_STEADY);
  }
  // Already adopted on an earlier run of this checkout.
  if (adopted === original) return original.includes(LOCAL_STEADY);

  await Deno.writeTextFile(mockPath, adopted);
  return true;
}

async function createMockScript(
  sdkPath: string,
  specPath: string,
  sdk: SDK,
): Promise<void> {
  const scriptsDir = path.join(sdkPath, "scripts");
  await ensureDir(scriptsDir);

  const validatorFlags = sdk.validatorFlags?.join(" ") ?? "";

  // Use deno run directly instead of deno task to avoid spawning child processes
  const mockScript = `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

SPEC="${specPath}"

echo "==> Starting Steady mock server with spec \${SPEC}"

if [ "$1" == "--daemon" ]; then
  deno run --allow-read --allow-net --allow-env --allow-write "${STEADY_DIR}/cmd/steady.ts" --host 0.0.0.0 --port ${PORT} ${validatorFlags} "\${SPEC}" &> .steady.log &

  # Wait for server to come online
  echo -n "Waiting for server"
  for i in {1..50}; do
    if curl --silent "http://localhost:${PORT}" >/dev/null 2>&1; then
      echo " ready!"
      exit 0
    fi
    echo -n "."
    sleep 0.2
  done
  echo
  echo "Timeout waiting for server. Log:"
  cat .steady.log
  exit 1
else
  deno run --allow-read --allow-net --allow-env --allow-write "${STEADY_DIR}/cmd/steady.ts" --host 0.0.0.0 --port ${PORT} ${validatorFlags} "\${SPEC}"
fi
`;

  const mockPath = path.join(scriptsDir, "mock");
  await Deno.writeTextFile(mockPath, mockScript);
  await Deno.chmod(mockPath, 0o755);
}

async function runGoTests(sdkPath: string): Promise<boolean> {
  log("  Running Go tests...");

  // Start mock server
  const mockCmd = new Deno.Command("bash", {
    args: [path.join(sdkPath, "scripts", "mock"), "--daemon"],
    cwd: sdkPath,
    stdout: "inherit",
    stderr: "inherit",
  });

  const mockResult = await mockCmd.output();
  if (!mockResult.success) {
    throw new HarnessError("Mock server did not start");
  }

  // Brief delay after mock script reports ready
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Run go test
  const testCmd = new Deno.Command("go", {
    args: ["test", "./...", "-v", "-count=1"],
    cwd: sdkPath,
    stdout: "piped",
    stderr: "piped",
  });

  const testResult = await testCmd.output();
  const stdout = new TextDecoder().decode(testResult.stdout);
  const stderr = new TextDecoder().decode(testResult.stderr);
  const output = stdout + stderr;

  console.log(output.trimEnd());

  // Save output for analysis
  await Deno.writeTextFile(path.join(sdkPath, ".test-output.log"), output);

  // Kill the server
  await killPort(PORT);

  await printLogs(sdkPath, testResult);

  return testResult.success;
}

/**
 * Inject a conftest.py into tests/api_resources that removes
 * `@pytest.mark.skip` markers. SDK generators skip tests that their mock
 * server cannot handle ("Prism returns invalid data"), and those are the
 * tests worth running against Steady.
 *
 * `@pytest.mark.skipif` markers stay. Their condition is about the Python
 * environment, not the mock server. In the 17 SDK repositories surveyed on
 * 2026-11-14 the only `skipif` markers under tests/api_resources guard tests
 * that cannot run on Pydantic v1, and running them anyway fails inside the
 * SDK before a request is sent.
 *
 * Based on: https://github.com/pytest-dev/pytest/discussions/13311
 */
async function injectSkipRemovalConftest(sdkPath: string): Promise<void> {
  const conftestPath = path.join(
    sdkPath,
    "tests",
    "api_resources",
    "conftest.py",
  );

  // Check if conftest already exists
  let existingContent = "";
  if (await exists(conftestPath)) {
    existingContent = await Deno.readTextFile(conftestPath);
    // Don't modify if we've already injected
    if (existingContent.includes("steady_skip_removal")) {
      return;
    }
  }

  // Conftest hook that removes unconditional skip markers at collection time
  const skipRemovalHook = `
# steady_skip_removal: Injected by test-sdks.ts to run skipped tests
import pytest

def pytest_collection_modifyitems(config, items):
    """Remove unconditional skip markers so those tests run against the mock server."""
    for item in items:
        # Only affect tests in api_resources directory
        if "api_resources" not in str(item.fspath):
            continue
        original_markers = list(getattr(item, "own_markers", []))
        filtered_markers = [m for m in original_markers if m.name != "skip"]
        if len(filtered_markers) != len(original_markers):
            item.own_markers[:] = filtered_markers
`;

  // Prepend our hook to existing content (if any)
  const newContent = skipRemovalHook + "\n" + existingContent;
  await Deno.writeTextFile(conftestPath, newContent);
  log("  Injected skip-removal conftest.py");
}

async function runTypescriptTests(sdkPath: string): Promise<boolean> {
  // Run bootstrap if available
  const bootstrapPath = path.join(sdkPath, "scripts", "bootstrap");
  if (await exists(bootstrapPath)) {
    log("  Running bootstrap...");
    const bootstrapCmd = new Deno.Command("bash", {
      args: [bootstrapPath],
      cwd: sdkPath,
      stdout: "piped",
      stderr: "piped",
    });

    const bootstrapResult = await bootstrapCmd.output();
    const output = new TextDecoder().decode(bootstrapResult.stdout) +
      new TextDecoder().decode(bootstrapResult.stderr);
    console.log(output.trimEnd());

    if (!bootstrapResult.success) {
      // Without its dependencies the suite fails before it sends a request,
      // which would be reported as an SDK test failure.
      throw new HarnessError(
        `The SDK's scripts/bootstrap failed with exit code ${bootstrapResult.code}`,
      );
    }
  }

  // Start mock server
  log("  Starting mock server...");
  const mockCmd = new Deno.Command("bash", {
    args: [path.join(sdkPath, "scripts", "mock"), "--daemon"],
    cwd: sdkPath,
    stdout: "inherit",
    stderr: "inherit",
  });

  const mockResult = await mockCmd.output();
  if (!mockResult.success) {
    throw new HarnessError("Mock server did not start");
  }

  // Check if test script exists
  const testScriptPath = path.join(sdkPath, "scripts", "test");
  if (!(await exists(testScriptPath))) {
    await killPort(PORT);
    throw new HarnessError("The SDK has no ./scripts/test");
  }

  // Run tests
  log("  Running ./scripts/test...");
  const testCmd = new Deno.Command("bash", {
    args: [testScriptPath],
    cwd: sdkPath,
    stdout: "piped",
    stderr: "piped",
    env: {
      ...Deno.env.toObject(),
      // Ensure tests use our mock server
      TEST_API_BASE_URL: `http://127.0.0.1:${PORT}`,
    },
  });

  const testResult = await testCmd.output();
  const stdout = new TextDecoder().decode(testResult.stdout);
  const stderr = new TextDecoder().decode(testResult.stderr);
  const output = stdout + stderr;

  // Save output
  await Deno.writeTextFile(path.join(sdkPath, ".test-output.log"), output);

  console.log(output.trimEnd());

  await printLogs(sdkPath, testResult);

  // Kill the server
  await killPort(PORT);

  return testResult.success;
}

async function runPythonTests(sdkPath: string): Promise<boolean> {
  // Run bootstrap if available
  const bootstrapPath = path.join(sdkPath, "scripts", "bootstrap");
  if (await exists(bootstrapPath)) {
    log("  Running bootstrap...");
    const bootstrapCmd = new Deno.Command("bash", {
      args: [bootstrapPath],
      cwd: sdkPath,
      stdout: "piped",
      stderr: "piped",
    });

    const bootstrapResult = await bootstrapCmd.output();
    const output = new TextDecoder().decode(bootstrapResult.stdout) +
      new TextDecoder().decode(bootstrapResult.stderr);
    console.log(output.trimEnd());

    if (!bootstrapResult.success) {
      // Without its dependencies the suite fails before it sends a request,
      // which would be reported as an SDK test failure.
      throw new HarnessError(
        `The SDK's scripts/bootstrap failed with exit code ${bootstrapResult.code}`,
      );
    }
  }

  // Start mock server
  log("  Starting mock server...");
  const mockCmd = new Deno.Command("bash", {
    args: [path.join(sdkPath, "scripts", "mock"), "--daemon"],
    cwd: sdkPath,
    stdout: "inherit",
    stderr: "inherit",
  });

  const mockResult = await mockCmd.output();
  if (!mockResult.success) {
    throw new HarnessError("Mock server did not start");
  }

  // Check if test script exists
  const testScriptPath = path.join(sdkPath, "scripts", "test");
  if (!(await exists(testScriptPath))) {
    await killPort(PORT);
    throw new HarnessError("The SDK has no ./scripts/test");
  }

  // Check if tests directory exists
  const testsDir = path.join(sdkPath, "tests", "api_resources");
  if (!(await exists(testsDir))) {
    await killPort(PORT);
    throw new HarnessError("The SDK has no tests/api_resources directory");
  }

  // Inject conftest.py to remove skip markers so all tests run
  await injectSkipRemovalConftest(sdkPath);

  // Run tests
  log("  Running ./scripts/test...");
  const testCmd = new Deno.Command("bash", {
    args: [testScriptPath],
    cwd: sdkPath,
    stdout: "piped",
    stderr: "piped",
    env: {
      ...Deno.env.toObject(),
      // Ensure tests use our mock server
      TEST_API_BASE_URL: `http://127.0.0.1:${PORT}`,
    },
  });

  const testResult = await testCmd.output();
  const stdout = new TextDecoder().decode(testResult.stdout);
  const stderr = new TextDecoder().decode(testResult.stderr);
  const output = stdout + stderr;

  // Save output
  await Deno.writeTextFile(path.join(sdkPath, ".test-output.log"), output);

  console.log(output.trimEnd());

  await printLogs(sdkPath, testResult);

  // Kill the server
  await killPort(PORT);

  return testResult.success;
}

async function testSDK(sdk: SDK): Promise<TestResult> {
  log(`Testing ${sdk.name}`);

  try {
    const sdkPath = await cloneRepo(sdk);

    // Kill any existing server
    await killPort(PORT);

    if (await adoptSdkMockScript(sdkPath)) {
      success("Using the SDK's scripts/mock (its spec and validator flags)");
    } else {
      // The SDK does not start Steady itself. Find a spec and write a mock
      // script with the flags from the SDK list above.
      const specPath = await findSpec(sdkPath);
      if (!specPath) {
        throw new HarnessError(
          "No OpenAPI spec found. The SDK's scripts/mock does not start " +
            "Steady, the repository has no openapi-spec.yml, and its " +
            ".stats.yml has no openapi_spec_url",
        );
      }
      success("Spec ready");
      await createMockScript(sdkPath, specPath, sdk);
    }

    // Run tests based on language
    let passed = false;
    if (sdk.language === "go") {
      passed = await runGoTests(sdkPath);
    } else if (sdk.language === "python") {
      passed = await runPythonTests(sdkPath);
    } else if (sdk.language === "typescript") {
      passed = await runTypescriptTests(sdkPath);
    } else {
      throw new HarnessError(`Language ${sdk.language} is not supported`);
    }

    // Cleanup
    await killPort(PORT);

    if (passed) {
      success(`${sdk.name} passed`);
    } else {
      fail(`${sdk.name} failed`);
    }
    return { name: sdk.name, ran: true, passed };
  } catch (error) {
    await killPort(PORT);
    // Anything thrown here happened outside the SDK's test suite.
    const reason = error instanceof Error ? error.message : String(error);
    fail(`${sdk.name} NOT RUN: ${reason}`);
    return { name: sdk.name, ran: false, passed: false, error: reason };
  }
}

async function getGitInfo(): Promise<{ sha?: string; branch?: string }> {
  try {
    const shaCmd = new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "null",
    });
    const shaResult = await shaCmd.output();
    const sha = new TextDecoder().decode(shaResult.stdout).trim();

    const branchCmd = new Deno.Command("git", {
      args: ["rev-parse", "--abbrev-ref", "HEAD"],
      stdout: "piped",
      stderr: "null",
    });
    const branchResult = await branchCmd.output();
    const branch = new TextDecoder().decode(branchResult.stdout).trim();

    return { sha: sha || undefined, branch: branch || undefined };
  } catch {
    return {};
  }
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["go", "python", "typescript", "help", "json", "list"],
    string: ["_", "output"],
    alias: { h: "help", o: "output" },
  });

  if (args.help) {
    console.log(`
Steady SDK Compatibility Test Runner

Usage:
  deno run -A scripts/test-sdks.ts [options] [filter]

Options:
  --go           Test only Go SDKs
  --python       Test only Python SDKs
  --typescript   Test only TypeScript SDKs
  --list         Output SDK list as JSON (for CI matrix)
  --json         Output results as JSON (to stdout or file with --output)
  -o, --output   Write JSON results to file (implies --json)
  -h, --help     Show this help

Filter:
  Optionally provide a string to filter SDK names (e.g., "openai", "anthropic")

Examples:
  deno run -A scripts/test-sdks.ts                    # Test all SDKs
  deno run -A scripts/test-sdks.ts --go               # Test Go SDKs only
  deno run -A scripts/test-sdks.ts --python           # Test Python SDKs only
  deno run -A scripts/test-sdks.ts openai             # Test SDKs matching "openai"
  deno run -A scripts/test-sdks.ts --json             # Output JSON to stdout
  deno run -A scripts/test-sdks.ts -o results.json    # Save JSON to file
`);
    Deno.exit(0);
  }

  if (args.list) {
    const sdks = SDKS.filter((sdk) => !sdk.ciSkip).map((sdk) => ({
      name: sdk.name,
      language: sdk.language,
    }));
    console.log(JSON.stringify(sdks));
    Deno.exit(0);
  }

  const jsonOutput = args.json || !!args.output;

  log("Steady SDK Compatibility Test Runner");
  console.log();

  // Create SDK directory
  await ensureDir(SDK_DIR);

  // Filter SDKs based on arguments
  const sdkFilter = args._[0] as string | undefined;
  let sdksToTest = SDKS;

  if (sdkFilter) {
    sdksToTest = SDKS.filter((sdk) =>
      sdk.name.toLowerCase().includes(sdkFilter.toLowerCase())
    );
    if (sdksToTest.length === 0) {
      fail(`No SDKs matching: ${sdkFilter}`);
      console.log("\nAvailable SDKs:");
      for (const sdk of SDKS) {
        console.log(`  ${sdk.name} (${sdk.language})`);
      }
      Deno.exit(1);
    }
  }

  if (args.go) {
    sdksToTest = sdksToTest.filter((sdk) => sdk.language === "go");
  } else if (args.python) {
    sdksToTest = sdksToTest.filter((sdk) => sdk.language === "python");
  } else if (args.typescript) {
    sdksToTest = sdksToTest.filter((sdk) => sdk.language === "typescript");
  }

  log("Running tests...");
  console.log();

  // Test each SDK
  const results: TestResult[] = [];
  for (const sdk of sdksToTest) {
    const result = await testSDK(sdk);
    results.push(result);
    console.log();
  }

  // Calculate summary
  const passCount = results.filter((r) => r.passed).length;
  const notRunCount = results.filter((r) => !r.ran).length;
  const failCount = results.length - passCount - notRunCount;

  // Build report
  const gitInfo = await getGitInfo();
  const report: TestReport = {
    timestamp: new Date().toISOString(),
    commitSha: gitInfo.sha,
    branch: gitInfo.branch,
    summary: {
      total: results.length,
      passed: passCount,
      failed: failCount,
      notRun: notRunCount,
    },
    results,
  };

  // Output results
  if (jsonOutput) {
    const jsonStr = JSON.stringify(report, null, 2);
    if (args.output) {
      await Deno.writeTextFile(args.output, jsonStr);
      log(`Results written to ${args.output}`);
    } else {
      console.log(jsonStr);
    }
  } else {
    // Text summary
    console.log();
    log("Summary");
    console.log("========");

    for (const result of results) {
      if (!result.ran) {
        fail(`${result.name}: NOT RUN (${result.error})`);
      } else if (result.passed) {
        success(`${result.name}: PASS`);
      } else {
        fail(`${result.name}: FAIL`);
      }
    }

    console.log();
    log(
      `Total: ${passCount} passed, ${failCount} failed, ${notRunCount} not run`,
    );
  }

  // A suite that did not run outranks a suite that failed: it is the harness
  // that needs attention, and CI fails the job on it.
  if (notRunCount > 0) Deno.exit(EXIT_NOT_RUN);
  Deno.exit(failCount > 0 ? EXIT_SUITE_FAILED : 0);
}

main();

async function printLogs(sdkPath: string, testResult: Deno.CommandOutput) {
  // ".steady.log" is written by the mock script this runner creates,
  // ".stdy.log" by an SDK's own scripts/mock.
  for (const name of [".steady.log", ".stdy.log"]) {
    const logPath = path.join(sdkPath, name);
    if (!(await exists(logPath))) continue;
    log(`  Steady server log file at ${logPath}`);
    if (!testResult.success) {
      log("  Log content:");
      const logContent = await Deno.readTextFile(logPath);
      console.log(dim(logContent.trimEnd()));
    }
  }
}
