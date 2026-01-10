/**
 * TuiLogger - Interactive terminal UI for request navigation
 *
 * Same complete context as TextLogger, but interactive:
 * - Scrollable request list
 * - Expand to see full validation details
 * - Filter/search
 * - Keyboard navigation
 */

import { BaseLogger } from "./logger.ts";
import {
  attributionColor,
  attributionLabel,
  colorize,
  colors,
  formatStatus,
} from "./colors.ts";
import { formatActual } from "./format-expected.ts";
import type {
  LoggerOptions,
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
} from "./types.ts";

// Terminal control codes
const CLEAR_SCREEN = "\x1b[2J";
const CURSOR_HOME = "\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1006l";

export class TuiLogger extends BaseLogger {
  private entries: RequestEvent[] = [];
  private selectedIndex = 0;
  private filterText = "";
  private filterMode = false;
  private jumpMode = false;
  private jumpText = "";
  private expandedId: string | null = null;
  private running = false;
  private viewportTop = 0;
  private terminalHeight = 24;
  private terminalWidth = 80;
  private showTimestamps = false;
  private startupEvent: StartupEvent | null = null;
  private statusMessage: string | null = null;

  constructor(options: Partial<LoggerOptions> = {}) {
    super({ ...options, color: true }); // TUI always uses color
  }

  async start(): Promise<void> {
    this.running = true;
    this.updateTerminalSize();

    // Clear screen, hide cursor, enable mouse
    await this.write(CLEAR_SCREEN + CURSOR_HOME + HIDE_CURSOR + ENABLE_MOUSE);

    // Initial render
    await this.render();

    // Start input handling
    this.handleInput();
  }

  private updateTerminalSize(): void {
    try {
      const size = Deno.consoleSize();
      this.terminalHeight = size.rows;
      this.terminalWidth = size.columns;
    } catch {
      this.terminalHeight = 24;
      this.terminalWidth = 80;
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    // Restore terminal state
    Deno.stdout.writeSync(
      new TextEncoder().encode(
        SHOW_CURSOR + DISABLE_MOUSE + CLEAR_SCREEN + CURSOR_HOME,
      ),
    );
  }

  request(event: RequestEvent): void {
    this.entries.push(event);

    // Keep max 1000 entries
    if (this.entries.length > 1000) {
      this.entries.shift();
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
      }
    }

    this.updateViewport();

    if (this.running) {
      this.render();
    }
  }

  startup(event: StartupEvent): void {
    this.startupEvent = event;

    if (this.running) {
      this.render();
    }
  }

  shutdown(_event: ShutdownEvent): void {
    // TUI handles shutdown via stop()
    this.stop();
  }

  warning(message: string, _context?: Record<string, unknown>): void {
    this.statusMessage = `Warning: ${message}`;
    if (this.running) {
      this.render();
    }
  }

  error(message: string, _context?: Record<string, unknown>): void {
    this.statusMessage = `Error: ${message}`;
    if (this.running) {
      this.render();
    }
  }

  private async handleInput(): Promise<void> {
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(16);

    await Deno.stdin.setRaw(true);

    while (this.running) {
      const n = await Deno.stdin.read(buffer);
      if (n === null) break;

      const input = decoder.decode(buffer.slice(0, n));
      await this.processInput(input);
    }

    await Deno.stdin.setRaw(false);
  }

  private async processInput(input: string): Promise<void> {
    // Handle mouse wheel (SGR format)
    if (input.startsWith("\x1b[<")) {
      // deno-lint-ignore no-control-regex
      const mouseMatch = input.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (mouseMatch && mouseMatch[1] && mouseMatch[4]) {
        const button = parseInt(mouseMatch[1], 10);
        const press = mouseMatch[4] === "M";

        if (press) {
          if (button === 64) {
            // Wheel up - scroll 3 lines
            for (let i = 0; i < 3; i++) this.navigateUp();
          } else if (button === 65) {
            // Wheel down - scroll 3 lines
            for (let i = 0; i < 3; i++) this.navigateDown();
          }
        }
      }
      await this.render();
      return;
    }

    // Jump mode
    if (this.jumpMode) {
      if (input === "\x1b") {
        this.jumpMode = false;
        this.jumpText = "";
        this.selectedIndex = 0;
        this.updateViewport();
      } else if (input === "\r") {
        const filtered = this.getFilteredEntries();
        if (filtered.length > 0 && this.selectedIndex < filtered.length) {
          const selectedEntry = filtered[this.selectedIndex];
          if (selectedEntry) {
            const originalIndex = this.entries.findIndex(
              (e) => e.id === selectedEntry.id,
            );
            if (originalIndex >= 0) {
              this.jumpMode = false;
              this.jumpText = "";
              this.selectedIndex = originalIndex;
              this.updateViewport();
            }
          }
        }
      } else if (input === "\x7f") {
        this.jumpText = this.jumpText.slice(0, -1);
        this.selectedIndex = 0;
        this.updateViewport();
      } else if (input.length === 1 && input >= " " && input <= "~") {
        this.jumpText += input.toLowerCase();
        this.selectedIndex = 0;
        this.updateViewport();
      }
      await this.render();
      return;
    }

    // Filter mode
    if (this.filterMode) {
      if (input === "\x1b") {
        this.filterMode = false;
        this.filterText = "";
      } else if (input === "\r") {
        this.filterMode = false;
      } else if (input === "\x7f") {
        this.filterText = this.filterText.slice(0, -1);
      } else if (input.length === 1 && input >= " ") {
        this.filterText += input;
      }
      await this.render();
      return;
    }

    // Normal navigation
    switch (input) {
      case "j":
      case "\x1b[B":
      case "\x0e":
        this.navigateDown();
        break;
      case "k":
      case "\x1b[A":
      case "\x10":
        this.navigateUp();
        break;
      case "g":
        this.jumpMode = true;
        this.jumpText = "";
        break;
      case "G":
        this.jumpToEnd();
        break;
      case "\x01": // Ctrl+A
        this.jumpToStart();
        break;
      case "\x05": // Ctrl+E
        this.jumpToEnd();
        break;
      case "\r":
        this.toggleExpansion();
        break;
      case "/":
        this.filterMode = true;
        break;
      case "q":
      case "\x03": // Ctrl+C
        this.stop();
        return;
      case "c":
        this.entries = [];
        this.selectedIndex = 0;
        this.expandedId = null;
        this.updateViewport();
        break;
      case "t":
        this.showTimestamps = !this.showTimestamps;
        break;
      case " ":
      case "\x06": // Ctrl+F
        this.pageDown();
        break;
      case "b":
      case "\x02": // Ctrl+B
        this.pageUp();
        break;
    }

    await this.render();
  }

  private navigateUp(): void {
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.updateViewport();
  }

  private navigateDown(): void {
    const filtered = this.getFilteredEntries();
    this.selectedIndex = Math.min(filtered.length - 1, this.selectedIndex + 1);
    this.updateViewport();
  }

  private jumpToStart(): void {
    this.selectedIndex = 0;
    this.updateViewport();
  }

  private jumpToEnd(): void {
    const filtered = this.getFilteredEntries();
    this.selectedIndex = Math.max(0, filtered.length - 1);
    this.updateViewport();
  }

  private pageDown(): void {
    const contentHeight = this.terminalHeight - 6;
    const filtered = this.getFilteredEntries();
    this.selectedIndex = Math.min(
      filtered.length - 1,
      this.selectedIndex + contentHeight,
    );
    this.updateViewport();
  }

  private pageUp(): void {
    const contentHeight = this.terminalHeight - 6;
    this.selectedIndex = Math.max(0, this.selectedIndex - contentHeight);
    this.updateViewport();
  }

  private updateViewport(): void {
    const contentHeight = this.terminalHeight - 5;

    if (this.selectedIndex < this.viewportTop) {
      this.viewportTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.viewportTop + contentHeight) {
      this.viewportTop = this.selectedIndex - contentHeight + 1;
    }

    const filtered = this.getFilteredEntries();
    this.viewportTop = Math.max(
      0,
      Math.min(this.viewportTop, Math.max(0, filtered.length - contentHeight)),
    );
  }

  private toggleExpansion(): void {
    const filtered = this.getFilteredEntries();
    const entry = filtered[this.selectedIndex];
    if (!entry) return;

    this.expandedId = this.expandedId === entry.id ? null : entry.id;
  }

  private getFilteredEntries(): RequestEvent[] {
    let filtered = this.entries;

    // Regular filter
    if (this.filterText) {
      const lowerFilter = this.filterText.toLowerCase();
      filtered = filtered.filter((entry) => {
        const searchStr =
          `${entry.request.method} ${entry.request.path} ${entry.response.status}`
            .toLowerCase();

        if (lowerFilter.includes(":")) {
          const [type, value] = lowerFilter.split(":", 2);
          if (!value) return searchStr.includes(lowerFilter);

          switch (type) {
            case "status":
              return entry.response.status.toString().startsWith(value);
            case "method":
              return entry.request.method.toLowerCase() === value;
            case "valid":
              return value === "false"
                ? !entry.validation.valid
                : entry.validation.valid;
            default:
              return searchStr.includes(lowerFilter);
          }
        }

        return searchStr.includes(lowerFilter);
      });
    }

    // Jump mode filter
    if (this.jumpMode && this.jumpText) {
      if (this.jumpText.startsWith("#")) {
        const hexId = this.jumpText.slice(1);
        const targetIndex = parseInt(hexId, 16);
        return this.entries[targetIndex] ? [this.entries[targetIndex]] : [];
      }

      const searchText = this.jumpText.toLowerCase();
      filtered = filtered.filter((entry) => {
        const searchStr = `${entry.request.method} ${entry.request.path}`
          .toLowerCase();
        return searchStr.includes(searchText);
      });
    }

    return filtered;
  }

  private getHexDigits(): number {
    const count = this.getFilteredEntries().length;
    if (count <= 16) return 1;
    if (count <= 256) return 2;
    return 3;
  }

  private formatHexId(index: number): string {
    const digits = this.getHexDigits();
    return index.toString(16).padStart(digits, "0");
  }

  private async render(): Promise<void> {
    const lines: string[] = [];
    const filtered = this.getFilteredEntries();
    const contentHeight = this.terminalHeight - 6;
    const totalEntries = filtered.length;
    const viewportEnd = Math.min(
      this.viewportTop + contentHeight,
      totalEntries,
    );

    // Header
    let headerLine = colorize("Steady", colors.bold, this.useColor);
    if (this.startupEvent) {
      const { spec } = this.startupEvent;
      headerLine += colorize(
        ` - ${spec.title} v${spec.version}`,
        colors.dim,
        this.useColor,
      );
    }
    if (this.filterText) {
      headerLine += colorize(
        ` (${totalEntries}/${this.entries.length} shown)`,
        colors.dim,
        this.useColor,
      );
    }
    lines.push(headerLine);

    // Scroll indicator (top)
    if (totalEntries > contentHeight && this.viewportTop > 0) {
      lines.push(
        colorize(
          `\u2191 ${this.viewportTop} more above`,
          colors.dim,
          this.useColor,
        ),
      );
    } else {
      lines.push("");
    }

    // Separator
    lines.push("");

    // Visible entries
    const visibleEntries = filtered.slice(
      this.viewportTop,
      this.viewportTop + contentHeight,
    );

    for (let viewIndex = 0; viewIndex < visibleEntries.length; viewIndex++) {
      const entry = visibleEntries[viewIndex];
      if (!entry) continue;

      const actualIndex = this.viewportTop + viewIndex;
      const isSelected = actualIndex === this.selectedIndex;
      const isExpanded = this.expandedId === entry.id;

      // Main line
      const hexId = colorize(
        this.formatHexId(actualIndex),
        colors.dim,
        this.useColor,
      );
      const method = entry.request.method.toUpperCase().padEnd(6);
      const path = entry.request.path;
      const query = entry.request.query
        ? colorize(entry.request.query, colors.dim, this.useColor)
        : "";
      const status = formatStatus(entry.response.status, this.useColor);
      const timing = colorize(
        `${entry.response.timing}ms`,
        colors.dim,
        this.useColor,
      );

      let line = "";

      if (this.showTimestamps) {
        const ts = entry.timestamp.toLocaleTimeString("en-GB", {
          hour12: false,
        });
        line += `[${ts}] `;
      }

      line += `${hexId}  ${method} ${path}${query}  ${status}  ${timing}`;

      if (isSelected) {
        line = `${colorize(">", colors.cyan, this.useColor)} ${line}`;
      } else {
        line = `  ${line}`;
      }

      // Truncate to terminal width
      lines.push(this.truncateLine(line));

      // Collapsed error summary
      if (!isExpanded && !entry.validation.valid) {
        const firstError = entry.validation.errors[0];
        if (firstError) {
          const x = colorize("\u2717", colors.red, this.useColor);
          const errorPath = firstError.path;
          const expected = firstError.expected;
          const actual = formatActual(firstError.actual, 30);
          const attr = this.formatAttribution(firstError);

          let errorLine =
            `    ${x} ${errorPath}: expected ${expected}, got ${actual} ${attr}`;

          if (entry.validation.errors.length > 1) {
            errorLine += colorize(
              ` (+${entry.validation.errors.length - 1} more)`,
              colors.dim,
              this.useColor,
            );
          }

          lines.push(errorLine);
        }
      }

      // Expanded details
      if (isExpanded) {
        lines.push(...this.renderExpandedEntry(entry));
      }
    }

    // Pad to fixed height
    const targetContentLines = this.terminalHeight - 5;
    const currentContentLines = lines.length - 3;
    const paddingNeeded = targetContentLines - currentContentLines;

    for (let i = 0; i < paddingNeeded; i++) {
      lines.push("");
    }

    // Scroll indicator (bottom)
    if (totalEntries > contentHeight && viewportEnd < totalEntries) {
      lines.push(
        colorize(
          `\u2193 ${totalEntries - viewportEnd} more below`,
          colors.dim,
          this.useColor,
        ),
      );
    } else {
      lines.push("");
    }

    // Status line
    if (this.statusMessage) {
      // Show status message (warning/error) and clear it
      const msg = this.statusMessage;
      this.statusMessage = null;
      lines.push(colorize(msg, colors.yellow, this.useColor));
    } else if (this.jumpMode) {
      const jumpResults = this.getFilteredEntries().length;
      lines.push(
        `Jump: ${this.jumpText}_ (${jumpResults} match${
          jumpResults !== 1 ? "es" : ""
        })`,
      );
    } else if (this.filterMode) {
      lines.push(`Filter: ${this.filterText}_`);
    } else {
      const filterIndicator = this.filterText
        ? colorize(`/:filter("${this.filterText}")`, colors.cyan, this.useColor)
        : "/:filter";
      lines.push(
        colorize(
          `j/k:nav space/b:page g:jump ${filterIndicator} t:time q:quit`,
          colors.dim,
          this.useColor,
        ),
      );
    }

    await this.write(CLEAR_SCREEN + CURSOR_HOME);
    await this.write(lines.join("\n"));
  }

  private renderExpandedEntry(entry: RequestEvent): string[] {
    const lines: string[] = [];
    const indent = "    ";

    // Request section
    lines.push(`${indent}Request:`);
    lines.push(`${indent}  Method: ${entry.request.method}`);
    lines.push(`${indent}  Path: ${entry.request.path}`);
    if (entry.request.pathPattern !== entry.request.path) {
      lines.push(
        `${indent}  Pattern: ${
          colorize(entry.request.pathPattern, colors.dim, this.useColor)
        }`,
      );
    }
    if (entry.request.query) {
      lines.push(`${indent}  Query: ${entry.request.query}`);
    }

    // Request headers (limited)
    const reqHeaders = this.formatHeaders(entry.request.headers, 3);
    if (reqHeaders.length > 0) {
      lines.push(`${indent}  Headers:`);
      for (const h of reqHeaders) {
        lines.push(`${indent}    ${h}`);
      }
    }

    // Request body
    if (entry.request.body !== undefined && this.showFull()) {
      lines.push(`${indent}  Body:`);
      const bodyLines = this.formatBody(entry.request.body, 5);
      for (const line of bodyLines) {
        lines.push(`${indent}    ${line}`);
      }
    }

    // Validation errors
    if (!entry.validation.valid && entry.validation.errors.length > 0) {
      lines.push("");
      lines.push(
        `${indent}${colorize("Validation Errors:", colors.red, this.useColor)}`,
      );

      for (const error of entry.validation.errors) {
        lines.push("");
        lines.push(`${indent}  Path: ${error.path}`);
        lines.push(`${indent}  Expected: ${error.expected}`);
        lines.push(`${indent}  Received: ${formatActual(error.actual)}`);
        lines.push(
          `${indent}  Spec: ${
            colorize(error.specPointer, colors.dim, this.useColor)
          }`,
        );

        // Attribution
        const attrColor = attributionColor(error.attribution.type);
        const attrLabel = attributionLabel(error.attribution.type);
        const confidence = Math.round(error.attribution.confidence * 100);
        lines.push(
          `${indent}  ${
            colorize(
              `${attrLabel} (${confidence}% confidence)`,
              attrColor,
              this.useColor,
            )
          }`,
        );

        // Suggestion
        if (error.suggestion) {
          lines.push(
            `${indent}  ${
              colorize("\u2192", colors.cyan, this.useColor)
            } ${error.suggestion}`,
          );
        }
      }
    }

    // Validation warnings
    if (entry.validation.warnings.length > 0) {
      lines.push("");
      lines.push(
        `${indent}${colorize("Warnings:", colors.yellow, this.useColor)}`,
      );
      for (const warning of entry.validation.warnings) {
        lines.push(`${indent}  ${warning.path}: ${warning.message}`);
      }
    }

    // Response section
    lines.push("");
    lines.push(`${indent}Response:`);
    lines.push(
      `${indent}  Status: ${
        formatStatus(entry.response.status, this.useColor)
      } ${entry.response.statusText}`,
    );
    lines.push(
      `${indent}  Timing: ${
        colorize(`${entry.response.timing}ms`, colors.dim, this.useColor)
      }`,
    );

    // Response headers
    if (this.showFull()) {
      const resHeaders = this.formatHeaders(entry.response.headers, 5);
      if (resHeaders.length > 0) {
        lines.push(`${indent}  Headers:`);
        for (const h of resHeaders) {
          lines.push(`${indent}    ${h}`);
        }
      }
    }

    // Response body
    if (entry.response.body !== undefined && this.showFull()) {
      lines.push(`${indent}  Body:`);
      const bodyLines = this.formatBody(entry.response.body, 5);
      for (const line of bodyLines) {
        lines.push(`${indent}    ${line}`);
      }
    }

    lines.push("");
    return lines;
  }

  private formatAttribution(error: {
    attribution: { type: string; confidence: number };
  }): string {
    const color = attributionColor(
      error.attribution.type as "sdk-issue" | "spec-issue" | "ambiguous",
    );
    const label = attributionLabel(
      error.attribution.type as "sdk-issue" | "spec-issue" | "ambiguous",
    );
    const confidence = Math.round(error.attribution.confidence * 100);
    return colorize(`[${label} ${confidence}%]`, color, this.useColor);
  }

  private formatHeaders(headers: Headers, limit: number): string[] {
    const formatted: string[] = [];
    const sensitive = ["authorization", "cookie", "x-api-key"];

    let count = 0;
    headers.forEach((value, key) => {
      if (count >= limit) return;
      count++;

      if (sensitive.includes(key.toLowerCase())) {
        formatted.push(
          `${key}: ${colorize("(hidden)", colors.dim, this.useColor)}`,
        );
      } else {
        formatted.push(`${key}: ${value}`);
      }
    });

    return formatted;
  }

  private formatBody(body: unknown, maxLines: number): string[] {
    if (body === undefined) {
      return [colorize("(empty)", colors.dim, this.useColor)];
    }

    try {
      const json = JSON.stringify(body, null, 2);
      const lines = json.split("\n");

      if (lines.length <= maxLines) {
        return lines;
      }

      const result = lines.slice(0, maxLines);
      result.push(
        colorize(
          `... ${lines.length - maxLines} more lines`,
          colors.dim,
          this.useColor,
        ),
      );
      return result;
    } catch {
      return [String(body)];
    }
  }

  /**
   * Truncate a line to fit terminal width, accounting for ANSI codes
   */
  private truncateLine(line: string): string {
    // Strip ANSI codes to get visible length
    // deno-lint-ignore no-control-regex
    const visibleLength = line.replace(/\x1b\[[0-9;]*m/g, "").length;

    if (visibleLength <= this.terminalWidth) {
      return line;
    }

    // Need to truncate - this is tricky with ANSI codes
    // For simplicity, just truncate and add ellipsis
    let visible = 0;
    let i = 0;
    while (i < line.length && visible < this.terminalWidth - 3) {
      if (line[i] === "\x1b") {
        // Skip ANSI sequence
        const end = line.indexOf("m", i);
        if (end !== -1) {
          i = end + 1;
          continue;
        }
      }
      visible++;
      i++;
    }

    return line.slice(0, i) + "...";
  }

  private async write(text: string): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode(text));
  }
}
