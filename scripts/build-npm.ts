#!/usr/bin/env -S deno run -A
/**
 * Build script to create npm package from Deno source using dnt.
 *
 * Usage:
 *   deno task build:npm [version]
 *   deno run -A scripts/build-npm.ts 0.2.0
 *
 * This will create an npm-ready package in the ./npm directory.
 * To publish: cd npm && npm publish
 */

import { build, emptyDir } from "jsr:@deno/dnt@^0.41.3";

// Read version from deno.json or CLI arg
const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const version = Deno.args[0] || denoJson.version || "0.1.0";

console.log(`Building npm package v${version}...`);

await emptyDir("./npm");

await build({
  entryPoints: [
    "./mod.ts",
    {
      name: "./cli",
      path: "./cmd/steady.ts",
    },
  ],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  // Skip type checking since we handle it separately
  typeCheck: false,
  // Skip tests in npm build
  test: false,
  package: {
    name: "@stdy/cli",
    version,
    description: "",
    repository: {
      type: "git",
      url: "git+https://github.com/dgellow/steady.git",
    },
    bugs: {
      url: "https://github.com/dgellow/steady/issues",
    },
    keywords: [
      "openapi",
      "mock",
      "server",
      "api",
      "testing",
      "sdk",
      "validation",
    ],
    bin: {
      steady: "./esm/cmd/steady.js",
    },
  },
  // Map Deno std imports to npm equivalents
  mappings: {
    "jsr:@std/cli@^1.0.24/parse-args": {
      name: "@std/cli",
      version: "^1.0.24",
      subPath: "parse-args",
    },
    "jsr:@std/yaml@^1.0.10": {
      name: "@std/yaml",
      version: "^1.0.10",
    },
    "jsr:@std/assert@^1.0.16": {
      name: "@std/assert",
      version: "^1.0.16",
    },
  },
  compilerOptions: {
    lib: ["ES2022"],
  },
  async postBuild() {
    // Copy additional files
    const filesToCopy = ["README.md"];
    for (const file of filesToCopy) {
      try {
        await Deno.copyFile(file, `npm/${file}`);
      } catch {
        console.warn(`Warning: Could not copy ${file}`);
      }
    }

    // Copy LICENSE if it exists
    try {
      await Deno.copyFile("LICENSE", "npm/LICENSE");
    } catch {
      console.warn("Warning: No LICENSE file found");
    }
  },
});

console.log(`\n✓ npm package built successfully in ./npm`);
console.log(`\nTo publish:`);
console.log(`  cd npm && npm publish`);
