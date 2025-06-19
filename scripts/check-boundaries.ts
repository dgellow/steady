#!/usr/bin/env -S deno run --allow-read

// Simple script to verify that packages don't import from src/
// This enforces our import boundaries

const checkImportBoundaries = async () => {
  console.log("🔍 Checking import boundaries...");

  let violations = 0;

  // Find all TypeScript files in packages/
  for await (const entry of Deno.readDir("packages")) {
    if (entry.isDirectory) {
      const packagePath = `packages/${entry.name}`;
      await checkPackageImports(packagePath);
    }
  }

  async function checkPackageImports(packagePath: string) {
    for await (const entry of Deno.readDir(packagePath)) {
      if (
        entry.isFile &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ) {
        const filePath = `${packagePath}/${entry.name}`;
        const content = await Deno.readTextFile(filePath);

        // Look for imports from src/
        const srcImports = content.match(/import.*from\s+['"](\.\.\/)*src\//g);
        if (srcImports) {
          console.error(`❌ ${filePath} imports from src/:`);
          srcImports.forEach((imp) => console.error(`   ${imp}`));
          violations++;
        }
      }
    }
  }

  if (violations === 0) {
    console.log("✅ All packages respect import boundaries");
  } else {
    console.error(`❌ Found ${violations} boundary violations`);
    Deno.exit(1);
  }
};

if (import.meta.main) {
  await checkImportBoundaries();
}
