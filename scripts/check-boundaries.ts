#!/usr/bin/env -S deno run --allow-read

/**
 * Import Boundary Enforcer
 *
 * Verifies that packages don't import from src/ to enforce clean architecture.
 * This script recursively checks all TypeScript files in packages/.
 */

const checkImportBoundaries = async () => {
  console.log("Checking import boundaries...");

  let violations = 0;
  let filesChecked = 0;

  // Recursively check all TypeScript files
  async function checkDirectory(dirPath: string): Promise<void> {
    for await (const entry of Deno.readDir(dirPath)) {
      const fullPath = `${dirPath}/${entry.name}`;

      if (entry.isDirectory) {
        // Skip node_modules and test-suite directories
        if (entry.name === "node_modules" || entry.name === "test-suite") {
          continue;
        }
        await checkDirectory(fullPath);
      } else if (
        entry.isFile &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ) {
        filesChecked++;
        await checkFile(fullPath);
      }
    }
  }

  async function checkFile(filePath: string): Promise<void> {
    const content = await Deno.readTextFile(filePath);

    // Look for imports from src/
    const srcImports = content.match(
      /import\s+.*?\s+from\s+['"](\.\.\/)*(\.\.\/)*src\//g,
    );
    if (srcImports) {
      console.error(`\x1b[31m[ERROR]\x1b[0m ${filePath} imports from src/:`);
      srcImports.forEach((imp) => console.error(`   ${imp}`));
      violations++;
    }

    // Also check for dynamic imports from src/
    const dynamicImports = content.match(
      /import\s*\(\s*['"](\.\.\/)*(\.\.\/)*src\//g,
    );
    if (dynamicImports) {
      console.error(
        `\x1b[31m[ERROR]\x1b[0m ${filePath} has dynamic import from src/:`,
      );
      dynamicImports.forEach((imp) => console.error(`   ${imp}`));
      violations++;
    }
  }

  // Check all packages
  await checkDirectory("packages");

  console.log(`\nChecked ${filesChecked} files`);

  if (violations === 0) {
    console.log("\x1b[32m[OK]\x1b[0m All packages respect import boundaries");
  } else {
    console.error(
      `\x1b[31m[FAIL]\x1b[0m Found ${violations} boundary violations`,
    );
    Deno.exit(1);
  }
};

if (import.meta.main) {
  await checkImportBoundaries();
}
