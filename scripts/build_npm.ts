#!/usr/bin/env -S deno run -A
/**
 * Build script for publishing the CLI to npm as @stdy/cli
 * Creates platform-specific packages like esbuild does:
 *   @stdy/cli           - Main package with wrapper (tiny)
 *   @stdy/cli-linux-x64 - Linux x64 binary
 *   @stdy/cli-linux-arm64 - Linux ARM64 binary
 *   @stdy/cli-darwin-x64 - macOS Intel binary
 *   @stdy/cli-darwin-arm64 - macOS Apple Silicon binary
 *   @stdy/cli-win32-x64 - Windows x64 binary
 *
 * Usage:
 *   deno run -A scripts/build_npm.ts              # Build all platforms
 *   deno run -A scripts/build_npm.ts --platform linux-x64  # Build only linux-x64
 */

import { parseArgs } from "@std/cli/parse-args";

const args = parseArgs(Deno.args, {
  string: ["platform"],
});

// Get version from deno.json
const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
const version = args._[0] as string || denoJson.version;

if (!version) {
  console.error(
    "Error: No version specified. Pass version as argument or ensure deno.json has a version field.",
  );
  Deno.exit(1);
}

console.log(`Building @stdy/cli version ${version}...`);

// Clean output directory
try {
  await Deno.remove("./npm", { recursive: true });
} catch {
  // Directory doesn't exist, ignore
}

// Platform configurations
const allPlatforms = [
  {
    target: "x86_64-unknown-linux-gnu",
    pkg: "@stdy/cli-linux-x64",
    os: "linux",
    cpu: "x64",
    binName: "steady",
  },
  {
    target: "aarch64-unknown-linux-gnu",
    pkg: "@stdy/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
    binName: "steady",
  },
  {
    target: "x86_64-apple-darwin",
    pkg: "@stdy/cli-darwin-x64",
    os: "darwin",
    cpu: "x64",
    binName: "steady",
  },
  {
    target: "aarch64-apple-darwin",
    pkg: "@stdy/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    binName: "steady",
  },
  {
    target: "x86_64-pc-windows-msvc",
    pkg: "@stdy/cli-win32-x64",
    os: "win32",
    cpu: "x64",
    binName: "steady.exe",
  },
];

// Filter platforms if --platform flag is provided
const platforms = args.platform
  ? allPlatforms.filter((p) => `${p.os}-${p.cpu}` === args.platform)
  : allPlatforms;

if (platforms.length === 0) {
  console.error(`Error: Unknown platform "${args.platform}"`);
  console.error(
    "Valid platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64",
  );
  Deno.exit(1);
}

// Create platform-specific packages
for (const platform of platforms) {
  const pkgDir = `./npm/${platform.pkg.replace("@stdy/", "")}`;
  await Deno.mkdir(`${pkgDir}/bin`, { recursive: true });

  console.log(`[build] Compiling for ${platform.target}...`);
  const cmd = new Deno.Command("deno", {
    args: [
      "compile",
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "--allow-env",
      "--target",
      platform.target,
      "--output",
      `${pkgDir}/bin/${platform.binName}`,
      "./cmd/steady.ts",
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  const result = await cmd.output();
  if (!result.success) {
    console.error(`Failed to compile for ${platform.target}`);
    Deno.exit(1);
  }

  // Create package.json for this platform
  const pkgJson = {
    name: platform.pkg,
    version,
    description:
      `Platform-specific binary for @stdy/cli (${platform.os}-${platform.cpu})`,
    license: "Elastic-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/stainless-api/steady.git",
    },
    os: [platform.os],
    cpu: [platform.cpu],
    bin: {
      steady: `./bin/${platform.binName}`,
    },
  };

  await Deno.writeTextFile(
    `${pkgDir}/package.json`,
    JSON.stringify(pkgJson, null, 2) + "\n",
  );

  // Show binary size
  const stat = await Deno.stat(`${pkgDir}/bin/${platform.binName}`);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  console.log(`  ${platform.pkg}: ${sizeMB} MB`);
}

// Create main @stdy/cli package
console.log("\n[build] Creating main @stdy/cli package...");
const mainPkgDir = "./npm/cli";
await Deno.mkdir(mainPkgDir, { recursive: true });

// Create the JavaScript wrapper
const wrapperCode = `#!/usr/bin/env node
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const platform = process.platform;
const arch = process.arch;

const PLATFORMS = {
  "linux-x64": "cli-linux-x64",
  "linux-arm64": "cli-linux-arm64",
  "darwin-x64": "cli-darwin-x64",
  "darwin-arm64": "cli-darwin-arm64",
  "win32-x64": "cli-win32-x64",
};

const key = \`\${platform}-\${arch}\`;
const pkgSuffix = PLATFORMS[key];

if (!pkgSuffix) {
  console.error(\`Unsupported platform: \${key}\`);
  console.error("Please use Deno directly: deno run -A jsr:@steady/cli");
  process.exit(1);
}

const binName = platform === "win32" ? "steady.exe" : "steady";
let binPath;

// Try multiple locations:
// 1. Sibling directory (for local dev/testing)
// 2. node_modules (for installed package)
const locations = [
  // Local dev: ../cli-linux-x64/bin/steady
  path.join(__dirname, "..", pkgSuffix, "bin", binName),
  // Installed: node_modules/@stdy/cli-linux-x64/bin/steady
  path.join(__dirname, "..", "..", pkgSuffix, "bin", binName),
];

for (const loc of locations) {
  if (fs.existsSync(loc)) {
    binPath = loc;
    break;
  }
}

if (!binPath) {
  // Try require.resolve as fallback
  try {
    const pkgPath = require.resolve(\`@stdy/\${pkgSuffix}/package.json\`);
    const pkgDir = path.dirname(pkgPath);
    binPath = path.join(pkgDir, "bin", binName);
  } catch (e) {
    console.error(\`Failed to find binary for \${key}\`);
    console.error("Try reinstalling: npm install @stdy/cli");
    process.exit(1);
  }
}

try {
  execFileSync(binPath, process.argv.slice(2), { stdio: "inherit" });
} catch (e) {
  if (e.status !== undefined) {
    process.exit(e.status);
  }
  throw e;
}
`;

await Deno.writeTextFile(`${mainPkgDir}/steady.js`, wrapperCode);

// Create main package.json with optionalDependencies
const mainPkgJson = {
  name: "@stdy/cli",
  version,
  description:
    "OpenAPI 3 mock server. Validates SDKs against OpenAPI specs with clear error attribution.",
  license: "Elastic-2.0",
  repository: {
    type: "git",
    url: "git+https://github.com/stainless-api/steady.git",
  },
  bugs: {
    url: "https://github.com/stainless-api/steady/issues",
  },
  homepage: "https://github.com/stainless-api/steady#readme",
  keywords: [
    "openapi",
    "mock-server",
    "api-testing",
    "sdk-testing",
    "json-schema",
    "validation",
  ],
  bin: {
    steady: "./steady.js",
  },
  files: ["steady.js"],
  engines: {
    node: ">=14.0.0",
  },
  optionalDependencies: {
    "@stdy/cli-linux-x64": version,
    "@stdy/cli-linux-arm64": version,
    "@stdy/cli-darwin-x64": version,
    "@stdy/cli-darwin-arm64": version,
    "@stdy/cli-win32-x64": version,
  },
};

await Deno.writeTextFile(
  `${mainPkgDir}/package.json`,
  JSON.stringify(mainPkgJson, null, 2) + "\n",
);

// Copy README and LICENSE to main package
await Deno.copyFile("LICENSE", `${mainPkgDir}/LICENSE`);
await Deno.copyFile("README.md", `${mainPkgDir}/README.md`);

console.log(`
Build complete! Output in ./npm

Packages created:
  npm/cli/           - @stdy/cli (main package)
  npm/cli-linux-x64/ - @stdy/cli-linux-x64
  npm/cli-linux-arm64/ - @stdy/cli-linux-arm64
  npm/cli-darwin-x64/ - @stdy/cli-darwin-x64
  npm/cli-darwin-arm64/ - @stdy/cli-darwin-arm64
  npm/cli-win32-x64/ - @stdy/cli-win32-x64

To publish all packages:
  for dir in npm/*/; do (cd "\$dir" && npm publish --access public); done
`);
