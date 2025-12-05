#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-sys

import type { LogLevel, StoredRequest } from "./types.ts";
import { RequestLogger, type ValidationResult } from "./logger.ts";

// Simple ANSI codes for essential formatting only
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const LIGHT_PINK = "\x1b[38;5;217m"; // Light pink for diagnostics
const YELLOW = "\x1b[33m"; // Yellow for HTTP status codes
const RED = "\x1b[31m";
const CLEAR_SCREEN = "\x1b[2J";
const CURSOR_HOME = "\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export class SimpleLogger extends RequestLogger {
  private entries: StoredRequest[] = [];
  private selectedIndex = 0;
  private filterText = "";
  private filterMode = false;
  private jumpMode = false;
  private jumpText = "";
  private expandedId: string | null = null;
  private running = false;
  private currentRequestId?: string;
  private pendingRequest?: Partial<StoredRequest>;
  private viewportTop = 0;
  private terminalHeight = 24; // Default, will be updated
  private showTimestamps = false;

  constructor(logLevel: LogLevel = "summary", logBodies = false) {
    super(logLevel, logBodies);
  }

  async start(): Promise<void> {
    this.running = true;

    // Get terminal dimensions
    this.updateTerminalSize();

    // Clear screen, hide cursor, and enable mouse wheel tracking
    await this.write(
      CLEAR_SCREEN + CURSOR_HOME + HIDE_CURSOR + "\x1b[?1000h\x1b[?1006h",
    );

    // Initial render
    await this.render();

    // Handle Ctrl+C gracefully
    Deno.addSignalListener("SIGINT", () => {
      this.stop();
    });

    // Start input handling
    this.handleInput();
  }

  private updateTerminalSize(): void {
    try {
      const size = Deno.consoleSize();
      this.terminalHeight = size.rows;
    } catch {
      this.terminalHeight = 24; // Fallback
    }
  }

  stop(): void {
    this.running = false;
    // Show cursor, disable mouse tracking, and clear screen
    Deno.stdout.writeSync(
      new TextEncoder().encode(
        SHOW_CURSOR + "\x1b[?1000l\x1b[?1006l" + CLEAR_SCREEN + CURSOR_HOME,
      ),
    );
    Deno.exit(0);
  }

  override logRequest(
    req: Request,
    path: string,
    method: string,
    validation?: ValidationResult,
  ): void {
    const url = new URL(req.url);
    const id = crypto.randomUUID();
    this.currentRequestId = id;

    this.pendingRequest = {
      id,
      timestamp: new Date(),
      method: method.toUpperCase(),
      path,
      query: url.search,
      headers: req.headers,
      validation,
    };
  }

  override logResponse(
    statusCode: number,
    timing: number,
    validation?: ValidationResult,
  ): void {
    if (!this.pendingRequest || !this.currentRequestId) return;

    const entry: StoredRequest = {
      ...this.pendingRequest as StoredRequest,
      statusCode,
      statusText: this.getStatusText(statusCode),
      timing,
      validation: validation || this.pendingRequest.validation,
    };

    this.addEntry(entry);
    this.pendingRequest = undefined;
    this.currentRequestId = undefined;
  }

  override logResponseDetails(res: Response, body?: unknown): void {
    const lastEntry = this.entries[this.entries.length - 1];
    if (lastEntry) {
      lastEntry.responseHeaders = res.headers;
      lastEntry.responseBody = body;
    }
  }

  private addEntry(entry: StoredRequest): void {
    this.entries.push(entry);
    if (this.entries.length > 1000) {
      this.entries.shift();
      // Adjust selected index if needed
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
      }
    }
    this.updateViewport();
    // Re-render when new entry is added
    if (this.running) {
      this.render();
    }
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

  private async handleInput(): Promise<void> {
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(16);

    // Set stdin to raw mode
    await Deno.stdin.setRaw(true);

    while (this.running) {
      const n = await Deno.stdin.read(buffer);
      if (n === null) break;

      const input = decoder.decode(buffer.slice(0, n));
      await this.processInput(input);
    }

    // Restore normal mode
    await Deno.stdin.setRaw(false);
  }

  private async processInput(input: string): Promise<void> {
    // Handle mouse wheel events (SGR format: ESC[<button;x;y;M/m)
    if (input.startsWith("\x1b[<")) {
      // deno-lint-ignore no-control-regex
      const mouseMatch = input.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (mouseMatch && mouseMatch[1] && mouseMatch[4]) {
        const button = parseInt(mouseMatch[1]);
        const press = mouseMatch[4] === "M";

        if (press) {
          if (button === 64) { // Wheel up
            this.navigateUp();
            this.navigateUp();
            this.navigateUp(); // Scroll by 3 lines
          } else if (button === 65) { // Wheel down
            this.navigateDown();
            this.navigateDown();
            this.navigateDown(); // Scroll by 3 lines
          }
        }
      }
      await this.render();
      return;
    }

    // Handle jump mode
    if (this.jumpMode) {
      if (input === "\x1b") { // Escape
        this.jumpMode = false;
        this.jumpText = "";
        this.selectedIndex = 0; // Reset selection
        this.updateViewport();
      } else if (input === "\r") { // Enter - jump to selected entry
        const filtered = this.getFilteredEntries();
        if (filtered.length > 0 && this.selectedIndex < filtered.length) {
          // Find the original index of the selected filtered entry
          const selectedEntry = filtered[this.selectedIndex];
          if (selectedEntry) {
            const originalIndex = this.entries.findIndex((entry) =>
              entry.id === selectedEntry.id
            );
            if (originalIndex >= 0) {
              this.jumpMode = false;
              this.jumpText = "";
              this.selectedIndex = originalIndex;
              this.updateViewport();
            }
          }
        }
      } else if (input === "\x7f") { // Backspace
        this.jumpText = this.jumpText.slice(0, -1);
        this.selectedIndex = 0; // Reset to first match
        this.updateViewport();
      } else if (input.length === 1 && (input >= " " && input <= "~")) {
        // Accept any printable character for jump text
        this.jumpText += input.toLowerCase();
        this.selectedIndex = 0; // Reset to first match
        this.updateViewport();
      }
      await this.render();
      return;
    }

    // Handle filter mode
    if (this.filterMode) {
      if (input === "\x1b") { // Escape
        this.filterMode = false;
        this.filterText = "";
      } else if (input === "\r") { // Enter
        this.filterMode = false;
      } else if (input === "\x7f") { // Backspace
        this.filterText = this.filterText.slice(0, -1);
      } else if (input.length === 1 && input >= " ") {
        this.filterText += input;
      }
      await this.render();
      return;
    }

    // Navigation and actions
    if (input === "j" || input === "\x1b[B" || input === "\x0e") { // Down arrow, j, or Ctrl+N
      this.navigateDown();
    } else if (input === "k" || input === "\x1b[A" || input === "\x10") { // Up arrow, k, or Ctrl+P
      this.navigateUp();
    } else if (input === "g") { // Jump mode
      this.jumpMode = true;
      this.jumpText = "";
    } else if (input === "G") { // Go to bottom
      this.jumpToEnd();
    } else if (input === "\x01") { // Ctrl+A - go to first
      this.jumpToStart();
    } else if (input === "\x05") { // Ctrl+E - go to last
      this.jumpToEnd();
    } else if (input === "\r") { // Enter
      this.toggleExpansion();
    } else if (input === "/") { // Filter
      this.filterMode = true;
    } else if (input === "q" || input === "\x03") { // q or Ctrl+C
      this.stop();
      return;
    } else if (input === "c") { // Clear
      this.entries = [];
      this.selectedIndex = 0;
      this.expandedId = null;
      this.updateViewport();
    } else if (input === "t") { // Toggle timestamps
      this.showTimestamps = !this.showTimestamps;
    } else if (input === " " || input === "\x06") { // Space or Ctrl+F - Page down
      this.pageDown();
    } else if (input === "b" || input === "\x02") { // b or Ctrl+B - Page up
      this.pageUp();
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

  private updateViewport(): void {
    const contentHeight = this.terminalHeight - 5; // 3 header lines + 2 footer lines

    // Ensure selected item is visible
    if (this.selectedIndex < this.viewportTop) {
      this.viewportTop = this.selectedIndex;
    } else if (this.selectedIndex >= this.viewportTop + contentHeight) {
      this.viewportTop = this.selectedIndex - contentHeight + 1;
    }

    // Keep viewport in bounds
    const filtered = this.getFilteredEntries();
    this.viewportTop = Math.max(
      0,
      Math.min(this.viewportTop, Math.max(0, filtered.length - contentHeight)),
    );
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

  private toggleExpansion(): void {
    const filtered = this.getFilteredEntries();
    const entry = filtered[this.selectedIndex];
    if (!entry) return;

    this.expandedId = this.expandedId === entry.id ? null : entry.id;
  }

  private getFilteredEntries(): StoredRequest[] {
    let filtered = this.entries;

    // Apply regular filter first
    if (this.filterText) {
      filtered = filtered.filter((entry) => {
        const searchStr = `${entry.method} ${entry.path} ${entry.statusCode}`
          .toLowerCase();

        // Support special filters like "status:400"
        if (this.filterText.includes(":")) {
          const [type, value] = this.filterText.split(":", 2);
          if (!value) return searchStr.includes(this.filterText.toLowerCase());

          switch (type) {
            case "status":
              return entry.statusCode.toString().startsWith(value);
            case "method":
              return entry.method.toLowerCase() === value.toLowerCase();
            default:
              return searchStr.includes(this.filterText.toLowerCase());
          }
        }

        return searchStr.includes(this.filterText.toLowerCase());
      });
    }

    // Apply jump mode filter
    if (this.jumpMode && this.jumpText) {
      const jumpEntries = this.entries.map((entry, index) => ({
        entry,
        originalIndex: index,
      }));

      if (this.jumpText.startsWith("#")) {
        // Hex ID jump - find entry with matching hex ID
        const hexId = this.jumpText.slice(1); // Remove # prefix
        const targetIndex = parseInt(hexId, 16);
        const matchingEntry = jumpEntries.find((item) =>
          item.originalIndex === targetIndex
        );
        return matchingEntry ? [matchingEntry.entry] : [];
      } else {
        // General search - filter by method and path
        const searchText = this.jumpText.toLowerCase();
        return jumpEntries
          .filter((item) => {
            const searchStr = `${item.entry.method} ${item.entry.path}`
              .toLowerCase();
            return searchStr.includes(searchText);
          })
          .map((item) => item.entry);
      }
    }

    return filtered;
  }

  private async render(): Promise<void> {
    const lines: string[] = [];
    const filtered = this.getFilteredEntries();
    const contentHeight = this.terminalHeight - 6; // More space for fixed UI elements

    const totalEntries = filtered.length;
    const viewportEnd = Math.min(
      this.viewportTop + contentHeight,
      totalEntries,
    );

    // Fixed header (line 1)
    let headerLine = "Steady Interactive Logger";
    if (this.filterText) {
      headerLine +=
        ` ${DIM}(showing ${totalEntries} of ${this.entries.length} entries)${RESET}`;
    }
    lines.push(headerLine);

    // Fixed top scroll indicator (line 2)
    if (totalEntries > contentHeight && this.viewportTop > 0) {
      lines.push(`${DIM}↑ ${this.viewportTop} more entries above${RESET}`);
    } else {
      lines.push(""); // Empty line to maintain fixed layout
    }

    // Empty separator line (line 3)
    lines.push("");

    // Render visible log entries
    const visibleEntries = filtered.slice(
      this.viewportTop,
      this.viewportTop + contentHeight,
    );
    visibleEntries.forEach((entry, viewIndex) => {
      const actualIndex = this.viewportTop + viewIndex;
      const isSelected = actualIndex === this.selectedIndex;
      const isExpanded = this.expandedId === entry.id;

      // Main line with hex ID
      const hexId = this.formatHexId(actualIndex);
      const statusColor = this.getStatusColor(entry.statusCode);
      const queryString = entry.query ? `${DIM}${entry.query}${RESET}` : "";

      let line = "";

      // Optional timestamp
      if (this.showTimestamps) {
        const timestamp = entry.timestamp.toLocaleTimeString("en-GB", {
          hour12: false,
        });
        line += `[${timestamp}] `;
      }

      line += `${hexId}  ${entry.method.padEnd(6)} ${entry.path}${queryString}`;
      line += `  ${statusColor}${entry.statusCode} ${entry.statusText}${RESET}`;
      line += `  ${DIM}${entry.timing}ms${RESET}`;

      // Selection indicator
      if (isSelected) {
        line = `> ${line}`;
      } else {
        line = `  ${line}`;
      }

      lines.push(line);

      // Show validation error inline if collapsed
      if (!isExpanded && entry.validation && !entry.validation.valid) {
        const firstError = entry.validation.errors[0];
        if (firstError) {
          let errorLine =
            `    ${LIGHT_PINK}${firstError.path}: ${firstError.message}${RESET}`;
          if (entry.validation.errors.length > 1) {
            errorLine += ` ${DIM}(+${
              entry.validation.errors.length - 1
            } more)${RESET}`;
          }
          lines.push(errorLine);
        }
      }

      // Expanded details (similar to before but more compact for viewport)
      if (isExpanded) {
        lines.push("    Request:");
        lines.push(`      Method: ${entry.method}`);
        lines.push(`      Path: ${entry.path}`);

        if (entry.query) {
          lines.push(`      Query: ${entry.query}`);
        }

        // Headers (filtered)
        const headers = this.formatHeadersList(entry.headers);
        if (headers.length > 0) {
          lines.push("      Headers:");
          headers.slice(0, 3).forEach((h) => lines.push(`        ${h}`)); // Limit for viewport
        }

        // Request body (truncated for viewport)
        if (entry.body) {
          lines.push("      Body:");
          const bodyStr = JSON.stringify(entry.body, null, 2);
          bodyStr.split("\n").slice(0, 5).forEach((line) =>
            lines.push(`        ${line}`)
          );
        }

        // Validation errors
        if (entry.validation && !entry.validation.valid) {
          lines.push("");
          lines.push(`    ${RED}Validation Errors:${RESET}`);
          entry.validation.errors.slice(0, 3).forEach((error) => {
            lines.push(`      ${error.path}: ${error.message}`);
          });
        }

        // Response (compact)
        lines.push("");
        lines.push("    Response:");
        lines.push(
          `      Status: ${statusColor}${entry.statusCode} ${entry.statusText}${RESET}`,
        );

        if (entry.responseBody) {
          lines.push("      Body:");
          const bodyStr = JSON.stringify(entry.responseBody, null, 2);
          bodyStr.split("\n").slice(0, 5).forEach((line) =>
            lines.push(`        ${line}`)
          );
        }

        lines.push("");
      }
    });

    // Pad remaining space to maintain fixed layout
    // We need exactly terminalHeight lines total:
    // 3 fixed lines at top + content + 2 fixed lines at bottom = terminalHeight
    const targetContentLines = this.terminalHeight - 5;
    const currentContentLines = lines.length - 3; // Subtract the 3 header lines
    const paddingNeeded = targetContentLines - currentContentLines;

    for (let i = 0; i < paddingNeeded; i++) {
      lines.push("");
    }

    // Fixed bottom scroll indicator (second to last line)
    if (totalEntries > contentHeight && viewportEnd < totalEntries) {
      lines.push(
        `${DIM}↓ ${totalEntries - viewportEnd} more entries below${RESET}`,
      );
    } else {
      lines.push(""); // Empty line to maintain fixed layout
    }

    // Fixed status line (last line)
    if (this.jumpMode) {
      const jumpResults = this.getFilteredEntries().length;
      lines.push(
        `Jump: ${this.jumpText}_ (${jumpResults} match${
          jumpResults !== 1 ? "es" : ""
        })`,
      );
    } else if (this.filterMode) {
      lines.push(`Filter: ${this.filterText}_`);
    } else {
      // Show active filter in status line
      const filterIndicator = this.filterText
        ? `${LIGHT_PINK}/:filter("${this.filterText}")${RESET}`
        : `/:filter`;
      lines.push(
        `${DIM}j/k:nav space/b:page g:jump ${filterIndicator} t:time q:quit${RESET}`,
      );
    }

    // Clear and render
    await this.write(CLEAR_SCREEN + CURSOR_HOME);
    await this.write(lines.join("\n"));
  }

  private getStatusColor(code: number): string {
    if (code >= 400 && code < 500) return YELLOW;
    if (code >= 500) return RED;
    return "";
  }

  private formatHeadersList(headers: Headers): string[] {
    const formatted: string[] = [];
    const sensitive = ["authorization", "cookie", "x-api-key"];

    headers.forEach((value, key) => {
      if (sensitive.includes(key.toLowerCase())) {
        formatted.push(`${key}: ${DIM}(hidden)${RESET}`);
      } else {
        formatted.push(`${key}: ${value}`);
      }
    });

    return formatted.slice(0, 5); // Only show first 5 headers
  }

  private async write(text: string): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode(text));
  }
}
