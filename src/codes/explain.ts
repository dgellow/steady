/**
 * `steady explain` — detailed documentation for E-codes.
 *
 * Renders rich, user-centric explanations in the terminal, reusing the
 * compiler-style header format for consistency with diagnostic output.
 */

import { colorize, colors } from "../logging/colors.ts";
import { allCodes, type ECode, getCode, hasCode } from "./registry.ts";
import { EXPLANATIONS } from "./explanations.ts";

/**
 * Run the explain command.
 *
 * - No args: show all codes as a reference card grouped by range.
 * - One or more codes: show detailed explanation for each.
 */
export function explainCommand(args: string[], useColor: boolean): void {
  if (args.length === 0) {
    printAllCodes(useColor);
    return;
  }

  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    if (!raw) continue;

    const code = normalizeCode(raw);

    if (!code || !hasCode(code)) {
      console.error(
        `${
          colorize("error", colors.red + colors.bold, useColor)
        }: Unknown code ${raw}`,
      );
      console.error();
      console.error(
        "Run `steady explain` to see all available codes.",
      );
      Deno.exit(1);
    }

    printExplanation(code, useColor);

    if (i < args.length - 1) {
      console.log();
    }
  }
}

/**
 * Normalize user input to an ECode.
 * Accepts: E3008, e3008, 3008 → E3008
 */
function normalizeCode(input: string): string {
  const upper = input.toUpperCase();

  // Already has E prefix
  if (upper.startsWith("E")) {
    return upper;
  }

  // Just a number — add E prefix
  if (/^\d+$/.test(input)) {
    return `E${input}`;
  }

  return upper;
}

/**
 * Print all codes grouped by range — the reference card.
 */
function printAllCodes(useColor: boolean): void {
  const codes = allCodes();
  const entries = Object.entries(codes) as [ECode, (typeof codes)[ECode]][];

  const groups: { title: string; prefix: string }[] = [
    { title: "Spec Issues", prefix: "E1" },
    { title: "Routing", prefix: "E2" },
    { title: "Transport / Structural (SDK)", prefix: "E3" },
    { title: "Content Validation Notes", prefix: "E4" },
    { title: "Ambiguous", prefix: "E5" },
  ];

  console.log(colorize("Steady Diagnostic Codes", colors.bold, useColor));
  console.log();

  for (const group of groups) {
    const groupEntries = entries.filter(([code]) =>
      code.startsWith(group.prefix)
    );
    if (groupEntries.length === 0) continue;

    console.log(
      colorize(`  ${group.prefix}xxx — ${group.title}`, colors.bold, useColor),
    );
    console.log();

    for (const [code, def] of groupEntries) {
      const severityColor = def.severity === "error"
        ? colors.red
        : def.severity === "warning"
        ? colors.yellow
        : colors.blue;
      const badge = colorize(def.severity, severityColor, useColor);
      const fatal = def.fatal ? colorize(" (fatal)", colors.red, useColor) : "";
      console.log(`    ${code}  ${def.title}  [${badge}]${fatal}`);
    }

    console.log();
  }

  console.log(
    colorize(
      "Run `steady explain <code>` for details on any code.",
      colors.dim,
      useColor,
    ),
  );
}

/**
 * Print a detailed explanation for a single code.
 */
function printExplanation(code: ECode, useColor: boolean): void {
  const def = getCode(code);
  const explanation = EXPLANATIONS[code];

  // Header — same style as diagnostic output
  const severityColor = def.severity === "error"
    ? colors.red
    : def.severity === "warning"
    ? colors.yellow
    : colors.blue;
  const header = colorize(
    `${def.severity}[${code}]`,
    severityColor + colors.bold,
    useColor,
  );
  console.log(`${header}: ${def.title}`);

  // Category line
  const categoryLabels: Record<string, string> = {
    "sdk-issue": "SDK Issue (Transport)",
    "spec-issue": "Spec Issue",
    "content-note": "Content Note",
    "ambiguous": "Ambiguous",
  };
  const catLabel = categoryLabels[def.category] ?? def.category;
  console.log(colorize(`  Category: ${catLabel}`, colors.dim, useColor));
  console.log();

  // Description
  printSection("What this means", explanation.description, useColor);

  // Reasoning
  printSection(
    "Why it's categorized this way",
    explanation.reasoning,
    useColor,
  );

  // Example
  printSection("Example", explanation.example, useColor, true);

  // Fix
  printSection("What to do", explanation.fix, useColor);

  // See also
  if (explanation.seeAlso && explanation.seeAlso.length > 0) {
    const refs = explanation.seeAlso.map((ref) => {
      const refDef = getCode(ref);
      return `${ref} (${refDef.title})`;
    });
    console.log(
      `  ${colorize("See also:", colors.dim, useColor)} ${refs.join(", ")}`,
    );
  }
}

function printSection(
  heading: string,
  content: string,
  useColor: boolean,
  isCode = false,
): void {
  console.log(
    `  ${colorize(heading + ":", colors.bold, useColor)}`,
  );
  const indent = isCode ? "    " : "  ";
  for (const line of content.split("\n")) {
    console.log(`${indent}${line}`);
  }
  console.log();
}
