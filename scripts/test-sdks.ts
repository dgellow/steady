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
import { blue, dim, green, red, yellow } from "@std/fmt/colors";

const log = (msg: string) => console.log(`${blue("==>")} ${msg}`);
const success = (msg: string) => console.log(`${green("✓")}   ${msg}`);
const fail = (msg: string) => console.log(`${red("✗")}   ${msg}`);
const warn = (msg: string) => console.log(`${yellow("⚠")}   ${msg}`);

const STEADY_DIR = path.dirname(
  path.dirname(path.fromFileUrl(import.meta.url)),
);
const SDK_DIR = path.join(STEADY_DIR, "sdk-tests");
const PORT = 4010;

interface SDK {
  repo: string;
  name: string;
  language: "go" | "python";
  /** Additional CLI flags for the validator */
  validatorFlags?: string[];
}

// List of SDKs to test
const SDKS: SDK[] = [
  // Go SDKs
  {
    repo: "DefinitelyATestOrg/test-api-go",
    name: "test-api-go",
    language: "go",
  },

  // Python SDKs - AI/LLM providers
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
    repo: "anthropics/anthropic-sdk-python",
    name: "anthropic-sdk-python",
    language: "python",
  },
  {
    repo: "groq/groq-python",
    name: "groq-python",
    language: "python",
  },
  {
    repo: "Cerebras/cerebras-cloud-sdk-python",
    name: "cerebras-cloud-sdk-python",
    language: "python",
  },
  {
    repo: "meta-llama/llama-stack-client-python",
    name: "llama-stack-client-python",
    language: "python",
  },
  {
    repo: "perplexityai/perplexity-py",
    name: "perplexity-py",
    language: "python",
  },

  // Python SDKs - Infrastructure
  {
    repo: "cloudflare/cloudflare-python",
    name: "cloudflare-python",
    language: "python",
  },
  {
    repo: "browserbase/sdk-python",
    name: "browserbase-python",
    language: "python",
  },

  // Python SDKs - Fintech
  {
    repo: "lithic-com/lithic-python",
    name: "lithic-python",
    language: "python",
  },
  {
    repo: "Modern-Treasury/modern-treasury-python",
    name: "modern-treasury-python",
    language: "python",
  },
  {
    repo: "Finch-API/finch-api-python",
    name: "finch-api-python",
    language: "python",
  },
  {
    repo: "orbcorp/orb-python",
    name: "orb-python",
    language: "python",
  },

  // Python SDKs - Other
  {
    repo: "writer/writer-python",
    name: "writer-python",
    language: "python",
  },
  {
    repo: "knocklabs/knock-python",
    name: "knock-python",
    language: "python",
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
  sdk: SDK,
): Promise<void> {
  const scriptsDir = path.join(sdkPath, "scripts");
  await ensureDir(scriptsDir);

  const validatorFlags = sdk.validatorFlags?.join(" ") ?? "";

  const mockScript = `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

SPEC="${specPath}"

echo "==> Starting Steady mock server with spec \${SPEC}"

if [ "$1" == "--daemon" ]; then
  deno task --cwd "${STEADY_DIR}" start --host 0.0.0.0 --port ${PORT} ${validatorFlags} "\${SPEC}" &> .steady.log &

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
  deno task --cwd "${STEADY_DIR}" start --host 0.0.0.0 --port ${PORT} ${validatorFlags} "\${SPEC}"
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
    fail("Failed to start mock server");
    return false;
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

  // Show last 30 lines
  const lines = output.trim().split("\n");
  console.log(lines.slice(-30).join("\n"));

  // Save output for analysis
  await Deno.writeTextFile(path.join(sdkPath, ".test-output.log"), output);

  // Kill the server
  await killPort(PORT);

  if (!testResult.success) {
    const logPath = path.join(sdkPath, ".steady.log");
    if (await exists(logPath)) {
      log("  Steady server log:");
      const logContent = await Deno.readTextFile(logPath);
      console.log(dim(logContent.split("\n").slice(-5).join("\n")));
    }
  }

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
    // Show last few lines of bootstrap
    console.log(output.trim().split("\n").slice(-5).join("\n"));

    if (!bootstrapResult.success) {
      warn("Bootstrap had issues, continuing anyway...");
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
    fail("Failed to start mock server");
    return false;
  }

  // Check if test script exists
  const testScriptPath = path.join(sdkPath, "scripts", "test");
  if (!(await exists(testScriptPath))) {
    warn("No ./scripts/test found");
    await killPort(PORT);
    return false;
  }

  // Check if tests directory exists
  const testsDir = path.join(sdkPath, "tests", "api_resources");
  if (!(await exists(testsDir))) {
    warn("No tests/api_resources directory found");
    await killPort(PORT);
    return false;
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

  // Show last 30 lines
  const lines = output.trim().split("\n");
  console.log(lines.slice(-30).join("\n"));

  // Show steady server log
  const logPath = path.join(sdkPath, ".steady.log");
  if (await exists(logPath)) {
    log("  Steady server log:");
    const logContent = await Deno.readTextFile(logPath);
    console.log(dim(logContent.split("\n").slice(-5).join("\n")));
  }

  // Kill the server
  await killPort(PORT);

  return testResult.success;
}

async function testSDK(sdk: SDK): Promise<TestResult> {
  log(`Testing ${sdk.name}`);

  try {
    const sdkPath = await cloneRepo(sdk);
    const specPath = await findSpec(sdkPath);

    if (!specPath) {
      fail("No OpenAPI spec found");
      return { name: sdk.name, passed: false, error: "No spec found" };
    }
    success("Spec ready");

    // Kill any existing server
    await killPort(PORT);

    // Create mock script
    await createMockScript(sdkPath, specPath, sdk);

    // Run tests based on language
    let passed = false;
    if (sdk.language === "go") {
      passed = await runGoTests(sdkPath);
    } else if (sdk.language === "python") {
      passed = await runPythonTests(sdkPath);
    } else {
      warn(`Language ${sdk.language} not yet supported`);
      return { name: sdk.name, passed: false, error: "Language not supported" };
    }

    // Cleanup
    await killPort(PORT);

    if (passed) {
      success(`${sdk.name} passed`);
      return { name: sdk.name, passed: true };
    } else {
      fail(`${sdk.name} failed`);
      return { name: sdk.name, passed: false };
    }
  } catch (error) {
    fail(`${sdk.name} ERROR: ${error}`);
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
  deno run -A scripts/test-sdks.ts [options] [filter]

Options:
  --go        Test only Go SDKs
  --python    Test only Python SDKs
  -h, --help  Show this help

Filter:
  Optionally provide a string to filter SDK names (e.g., "openai", "anthropic")

Examples:
  deno run -A scripts/test-sdks.ts              # Test all SDKs
  deno run -A scripts/test-sdks.ts --go         # Test Go SDKs only
  deno run -A scripts/test-sdks.ts --python     # Test Python SDKs only
  deno run -A scripts/test-sdks.ts openai       # Test SDKs matching "openai"
`);
    Deno.exit(0);
  }

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
