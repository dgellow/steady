#!/usr/bin/env -S deno run -A
/**
 * Test Steady against SDK test suites
 *
 * Usage:
 *   deno run -A scripts/test-sdks.ts
 *   deno run -A scripts/test-sdks.ts --go
 *   deno run -A scripts/test-sdks.ts test-api-go
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { blue, green, red, yellow } from "@std/fmt/colors";

const log = (msg: string) => console.log(`${blue("==>")} ${msg}`);
const success = (msg: string) => console.log(`${green("✓")} ${msg}`);
const fail = (msg: string) => console.log(`${red("✗")} ${msg}`);
const warn = (msg: string) => console.log(`${yellow("⚠")} ${msg}`);

const STEADY_DIR = path.dirname(
  path.dirname(path.fromFileUrl(import.meta.url)),
);
const SDK_DIR = path.join(STEADY_DIR, "sdk-tests");
const PORT = 4010;

/**
 * Additional delay after mock server reports ready.
 * The bash script waits for health endpoint, but some SDKs need
 * a brief moment for their HTTP client pools to initialize.
 */
const POST_SERVER_READY_DELAY_MS = 500;

interface SDK {
  repo: string;
  name: string;
  language: "go" | "python";
}

// List of SDKs to test
const SDKS: SDK[] = [
  // Go SDKs
  {
    repo: "DefinitelyATestOrg/test-api-go",
    name: "test-api-go",
    language: "go",
  },
];

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
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
    log(`Using existing ${sdk.name} (rm -rf ${sdkPath} to refresh)`);
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
    throw new Error(
      `Failed to clone ${sdk.repo}: ${new TextDecoder().decode(result.stderr)}`,
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
        throw new Error(`Failed to download spec: ${response.status}`);
      }
      const specPath = path.join(sdkPath, "openapi-spec.yml");
      await Deno.writeTextFile(specPath, await response.text());
      return specPath;
    }
  }

  return null;
}

async function createMockScript(
  sdkPath: string,
  specPath: string,
): Promise<void> {
  const scriptsDir = path.join(sdkPath, "scripts");
  await ensureDir(scriptsDir);

  const mockScript = `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

SPEC="${specPath}"

echo "==> Starting Steady mock server with spec \${SPEC}"

if [ "$1" == "--daemon" ]; then
  deno task --cwd "${STEADY_DIR}" start --port ${PORT} --mode relaxed --validator-query-object-format=dots "\${SPEC}" &> .steady.log &

  # Wait for server to come online
  echo -n "Waiting for server"
  for i in {1..50}; do
    if curl --silent "http://localhost:${PORT}/_x-steady/health" >/dev/null 2>&1; then
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
  deno task --cwd "${STEADY_DIR}" start --port ${PORT} --mode relaxed --validator-query-object-format=dots "\${SPEC}"
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
    fail("  Failed to start mock server");
    return false;
  }

  // Brief delay after mock script reports ready
  await new Promise((resolve) =>
    setTimeout(resolve, POST_SERVER_READY_DELAY_MS)
  );

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

  // Show last 50 lines
  const lines = output.trim().split("\n");
  console.log(lines.slice(-50).join("\n"));

  // Save output for analysis
  await Deno.writeTextFile(path.join(sdkPath, ".test-output.log"), output);

  // Kill the server
  await killPort(PORT);

  // Check results - go test output format: "ok  \t<package>" or "FAIL\t<package>"
  const hasFailure = /^FAIL\s/m.test(output) || /FAIL\t/.test(output);
  const hasSuccess = /^ok\s/m.test(output) || /\nok\s/.test(output);

  if (hasFailure) {
    // Show server logs on failure
    const logPath = path.join(sdkPath, ".steady.log");
    if (await exists(logPath)) {
      log("  Steady server log (last 20 lines):");
      const logContent = await Deno.readTextFile(logPath);
      console.log(logContent.split("\n").slice(-20).join("\n"));
    }
    return false;
  }

  return hasSuccess;
}

async function testSDK(sdk: SDK): Promise<TestResult> {
  log(`Testing ${sdk.name}`);

  try {
    const sdkPath = await cloneRepo(sdk);
    const specPath = await findSpec(sdkPath);

    if (!specPath) {
      fail("  No OpenAPI spec found");
      return { name: sdk.name, passed: false, error: "No spec found" };
    }
    success(`  Spec ready: ${specPath}`);

    // Kill any existing server
    await killPort(PORT);

    // Create mock script
    await createMockScript(sdkPath, specPath);
    success("  Mock script created (using Steady)");

    // Run tests based on language
    let passed = false;
    if (sdk.language === "go") {
      passed = await runGoTests(sdkPath);
    } else {
      warn(`  Language ${sdk.language} not yet supported`);
      return { name: sdk.name, passed: false, error: "Language not supported" };
    }

    // Cleanup
    await killPort(PORT);

    if (passed) {
      success(`  ${sdk.name} PASSED`);
      return { name: sdk.name, passed: true };
    } else {
      fail(`  ${sdk.name} FAILED`);
      return { name: sdk.name, passed: false };
    }
  } catch (error) {
    fail(`  ${sdk.name} ERROR: ${error}`);
    return { name: sdk.name, passed: false, error: String(error) };
  }
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["go", "python", "help"],
    string: ["_"],
    alias: { h: "help" },
  });

  if (args.help) {
    console.log(`
Steady SDK Compatibility Test Runner

Usage:
  deno run -A scripts/test-sdks.ts [options] [sdk-name]

Options:
  --go        Test only Go SDKs
  --python    Test only Python SDKs (not yet implemented)
  -h, --help  Show this help

Examples:
  deno run -A scripts/test-sdks.ts              # Test all SDKs
  deno run -A scripts/test-sdks.ts --go         # Test Go SDKs only
  deno run -A scripts/test-sdks.ts test-api-go  # Test specific SDK
`);
    Deno.exit(0);
  }

  log("Steady SDK Compatibility Test Runner");
  log(`Using Steady from: ${STEADY_DIR}`);
  console.log();

  // Create SDK directory
  await ensureDir(SDK_DIR);

  // Filter SDKs based on arguments
  const sdkFilter = args._[0] as string | undefined;
  let sdksToTest = SDKS;

  if (sdkFilter) {
    sdksToTest = SDKS.filter((sdk) => sdk.name === sdkFilter);
    if (sdksToTest.length === 0) {
      fail(`SDK not found: ${sdkFilter}`);
      Deno.exit(1);
    }
  } else if (args.go) {
    sdksToTest = SDKS.filter((sdk) => sdk.language === "go");
  } else if (args.python) {
    sdksToTest = SDKS.filter((sdk) => sdk.language === "python");
  }

  console.log();
  log("Running tests...");
  console.log();

  // Test each SDK
  const results: TestResult[] = [];
  for (const sdk of sdksToTest) {
    const result = await testSDK(sdk);
    results.push(result);
    console.log();
  }

  // Summary
  console.log();
  log("Summary");
  console.log("========");

  let passCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.passed) {
      success(`${result.name}: PASS`);
      passCount++;
    } else {
      fail(`${result.name}: FAIL${result.error ? ` (${result.error})` : ""}`);
      failCount++;
    }
  }

  console.log();
  log(`Total: ${passCount} passed, ${failCount} failed`);

  Deno.exit(failCount > 0 ? 1 : 0);
}

main();
