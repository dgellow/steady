import { LogLevel, ValidationResult } from "./types.ts";
import { RequestLogger } from "./logger.ts";

// ANSI codes
const ANSI = {
  // Cursor movement
  CLEAR_SCREEN: "\x1b[2J",
  CURSOR_HOME: "\x1b[H",
  CURSOR_UP: (n: number) => `\x1b[${n}A`,
  CURSOR_DOWN: (n: number) => `\x1b[${n}B`,
  CURSOR_SAVE: "\x1b[s",
  CURSOR_RESTORE: "\x1b[u",
  CLEAR_LINE: "\x1b[2K",
  CLEAR_BELOW: "\x1b[J",

  // Cursor visibility
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",

  // Mouse tracking
  ENABLE_MOUSE: "\x1b[?1000h\x1b[?1002h\x1b[?1015h\x1b[?1006h", // Enable SGR mouse mode
  DISABLE_MOUSE: "\x1b[?1000l\x1b[?1002l\x1b[?1015l\x1b[?1006l",

  // Colors
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  INVERSE: "\x1b[7m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  GRAY: "\x1b[90m",
};

type ExpansionState = "collapsed" | "basic" | "full";

interface StoredRequest {
  method: string;
  path: string;
  query: string;
  headers: Headers;
  body?: unknown;
  pathParams?: Record<string, string>;
}

interface StoredResponse {
  statusCode: number;
  statusText: string;
  headers: Headers;
  body?: unknown;
  timing: number;
}

interface LogEntry {
  id: string;
  timestamp: Date;
  request: StoredRequest;
  response: StoredResponse;
  validation?: ValidationResult;
  expansionState: ExpansionState;
  subSelections: Map<string, boolean>;
}

interface ExpandableSection {
  id: string;
  line: string;
  expandable: boolean;
  expanded: boolean;
}

export class InteractiveLogger extends RequestLogger {
  private entries: LogEntry[] = [];
  private maxEntries = 1000;
  private selectedIndex = 0;
  private subSelectedIndex = 0;
  private inSubSelection = false;
  private filterText = "";
  private filterMode = false;
  private running = false;
  private renderInterval?: number;
  private currentRequestId?: string;
  private pendingRequest?: Partial<LogEntry>;

  constructor(logLevel: LogLevel = "summary", logBodies = false) {
    super(logLevel, logBodies);
  }

  async start(): Promise<void> {
    this.running = true;

    // Clear screen, hide cursor, and enable mouse
    await this.write(
      ANSI.CLEAR_SCREEN + ANSI.CURSOR_HOME + ANSI.HIDE_CURSOR +
        ANSI.ENABLE_MOUSE,
    );

    // Handle SIGINT (Ctrl+C)
    Deno.addSignalListener("SIGINT", () => {
      this.stop();
    });

    // Start render loop
    this.renderLoop();

    // Start input handling
    this.handleInput();
  }

  stop(): void {
    this.running = false;
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
    }
    // Restore terminal state
    Deno.stdin.setRaw(false);
    // Show cursor, disable mouse, and clear screen
    Deno.stdout.writeSync(
      new TextEncoder().encode(
        ANSI.SHOW_CURSOR + ANSI.DISABLE_MOUSE + ANSI.CLEAR_SCREEN +
          ANSI.CURSOR_HOME,
      ),
    );
    // Exit the process
    Deno.exit(0);
  }

  // Override parent class methods to capture data
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
      request: {
        method: method.toUpperCase(),
        path,
        query: url.search,
        headers: req.headers,
        body: undefined, // TODO: capture body
      },
      validation,
      expansionState: "collapsed",
      subSelections: new Map(),
    };
  }

  override logResponse(
    statusCode: number,
    timing: number,
    validation?: ValidationResult,
  ): void {
    if (!this.pendingRequest || !this.currentRequestId) return;

    const entry: LogEntry = {
      ...this.pendingRequest as LogEntry,
      response: {
        statusCode,
        statusText: this.getStatusText(statusCode),
        headers: new Headers(), // TODO: capture response headers
        body: undefined, // TODO: capture response body
        timing,
      },
      validation: validation || this.pendingRequest.validation,
    };

    this.addEntry(entry);
    this.pendingRequest = undefined;
    this.currentRequestId = undefined;
  }

  override logResponseDetails(res: Response, body?: unknown): void {
    // Find the most recent entry and update it with response details
    if (this.entries.length > 0) {
      const lastEntry = this.entries[this.entries.length - 1];
      if (lastEntry && lastEntry.response) {
        lastEntry.response.headers = res.headers;
        lastEntry.response.body = body;
      }
    }
  }

  private addEntry(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    // Trigger render when new entry is added
    if (this.running) {
      this.render();
    }
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
    // Handle special key sequences
    if (input === "\x1b[A" || input === "k") { // Up arrow or k
      this.navigateUp();
    } else if (input === "\x1b[B" || input === "j") { // Down arrow or j
      this.navigateDown();
    } else if (input === "\r" || input === " ") { // Enter or Space
      this.toggleExpansion();
    } else if (input === "\x1b") { // Escape
      this.collapseCurrentEntry();
    } else if (input === "\t") { // Tab
      this.navigateToNextExpandable();
    } else if (input === "/") { // Filter
      this.filterMode = true;
    } else if (input === "c") { // Clear
      this.entries = [];
      this.selectedIndex = 0;
    } else if (input === "q" || input === "\x03") { // q or Ctrl+C
      this.stop();
      return;
    }

    // Handle filter mode input
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
    }

    // Render after any state change
    await this.render();
  }

  private navigateUp(): void {
    // Always allow navigating between entries
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    // Reset sub-selection when moving to a different entry
    this.inSubSelection = false;
    this.subSelectedIndex = 0;
  }

  private navigateDown(): void {
    const filtered = this.getFilteredEntries();
    // Always allow navigating between entries
    this.selectedIndex = Math.min(
      filtered.length - 1,
      this.selectedIndex + 1,
    );
    // Reset sub-selection when moving to a different entry
    this.inSubSelection = false;
    this.subSelectedIndex = 0;
  }

  private toggleExpansion(): void {
    const filtered = this.getFilteredEntries();
    const entry = filtered[this.selectedIndex];
    if (!entry) return;

    // Simple toggle between collapsed and expanded
    entry.expansionState = entry.expansionState === "collapsed"
      ? "basic"
      : "collapsed";
  }

  private collapseCurrentEntry(): void {
    const filtered = this.getFilteredEntries();
    const entry = filtered[this.selectedIndex];
    if (entry) {
      entry.expansionState = "collapsed";
      entry.subSelections.clear();
      this.inSubSelection = false;
      this.subSelectedIndex = 0;
    }
  }

  private navigateToNextExpandable(): void {
    if (!this.inSubSelection) {
      const filtered = this.getFilteredEntries();
      const entry = filtered[this.selectedIndex];
      if (entry?.expansionState !== "collapsed") {
        this.inSubSelection = true;
        this.subSelectedIndex = 0;
      }
    } else {
      this.subSelectedIndex++;
      const filtered = this.getFilteredEntries();
      const sections = this.getExpandableSections(filtered[this.selectedIndex]);
      if (this.subSelectedIndex >= sections.length) {
        this.inSubSelection = false;
        this.subSelectedIndex = 0;
        this.selectedIndex = Math.min(
          filtered.length - 1,
          this.selectedIndex + 1,
        );
      }
    }
  }

  private getFilteredEntries(): LogEntry[] {
    if (!this.filterText) return this.entries;

    return this.entries.filter((entry) => {
      const searchStr =
        `${entry.request.method} ${entry.request.path} ${entry.response.statusCode}`
          .toLowerCase();

      // Support special filters like "status:400"
      if (this.filterText.includes(":")) {
        const [type, value] = this.filterText.split(":", 2);
        if (!value) return searchStr.includes(this.filterText.toLowerCase());

        switch (type) {
          case "status":
            return entry.response.statusCode.toString().startsWith(value);
          case "method":
            return entry.request.method.toLowerCase() === value.toLowerCase();
          default:
            return searchStr.includes(this.filterText.toLowerCase());
        }
      }

      return searchStr.includes(this.filterText.toLowerCase());
    });
  }

  private getExpandableSections(
    entry: LogEntry | undefined,
  ): ExpandableSection[] {
    if (!entry || entry.expansionState === "collapsed") return [];

    const sections: ExpandableSection[] = [];

    // Add expandable sections based on what's available
    if (entry.request.body) {
      sections.push({
        id: "request-body",
        line: "Request Body",
        expandable: true,
        expanded: entry.subSelections.get("request-body") || false,
      });
    }

    if (entry.response.body) {
      sections.push({
        id: "response-body",
        line: "Response Body",
        expandable: true,
        expanded: entry.subSelections.get("response-body") || false,
      });
    }

    return sections;
  }

  private async renderLoop(): Promise<void> {
    // Initial render
    await this.render();

    // Don't constantly re-render, let processInput trigger renders
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async render(): Promise<void> {
    const lines: string[] = [];
    const filtered = this.getFilteredEntries();

    // Render each log entry
    filtered.forEach((entry, index) => {
      const isSelected = index === this.selectedIndex && !this.inSubSelection;
      lines.push(...this.renderEntry(entry, isSelected));

      // Render expanded content
      if (entry.expansionState !== "collapsed") {
        lines.push(
          ...this.renderExpandedContent(entry, index === this.selectedIndex),
        );
      }
    });

    // Status bar
    lines.push("");
    if (this.filterMode) {
      lines.push(`${ANSI.YELLOW}Filter: ${this.filterText}_${ANSI.RESET}`);
    } else {
      lines.push(
        `${ANSI.DIM}[↑↓] Navigate  [Enter] Expand  [Esc] Collapse  [/] Filter  [q] Quit${ANSI.RESET}`,
      );
    }

    // Clear screen and render
    await this.write(ANSI.CURSOR_HOME + ANSI.CLEAR_BELOW);
    await this.write(lines.join("\n"));
  }

  private renderEntry(entry: LogEntry, isSelected: boolean): string[] {
    const lines: string[] = [];
    const timestamp = entry.timestamp.toLocaleTimeString();
    const method = entry.request.method;
    const path = entry.request.path;
    const query = entry.request.query;
    const status = entry.response.statusCode;
    const timing = entry.response.timing;

    // Format the main line
    const methodColored = method;
    const queryColored = query ? `${ANSI.DIM}${query}${ANSI.RESET}` : "";
    const statusColored = this.formatStatus(status);
    const timingStr = `${ANSI.GRAY}(${timing}ms)${ANSI.RESET}`;

    let line =
      `${ANSI.GRAY}[${timestamp}]${ANSI.RESET} ${methodColored} ${path}${queryColored} → ${statusColored} ${timingStr}`;

    // Add expansion indicator
    if (entry.expansionState !== "collapsed") {
      line += ` ${ANSI.DIM}[▼]${ANSI.RESET}`;
    } else if (isSelected) {
      line += ` ${ANSI.DIM}[▶]${ANSI.RESET}`;
    }

    // Apply selection highlighting
    if (isSelected) {
      line = `${ANSI.INVERSE}${line}${ANSI.RESET}`;
    }

    lines.push(line);

    // Add validation summary if in collapsed mode
    if (
      entry.expansionState === "collapsed" && entry.validation &&
      !entry.validation.valid
    ) {
      const firstError = entry.validation.errors[0];
      if (firstError) {
        let errorLine =
          `           ${ANSI.YELLOW}⚠️  ${firstError.path}: ${firstError.message}${ANSI.RESET}`;
        if (entry.validation.errors.length > 1) {
          errorLine += ` ${ANSI.DIM}(+${
            entry.validation.errors.length - 1
          } more)${ANSI.RESET}`;
        }
        lines.push(errorLine);
      }
    }

    return lines;
  }

  private renderExpandedContent(
    entry: LogEntry,
    _isEntrySelected: boolean,
  ): string[] {
    const lines: string[] = [];
    const indent = "           ";

    // Validation errors (always show in expanded view)
    if (entry.validation && !entry.validation.valid) {
      lines.push(`${indent}${ANSI.RED}Validation Errors:${ANSI.RESET}`);
      entry.validation.errors.forEach((error, i) => {
        const prefix = i === entry.validation!.errors.length - 1 ? "└─" : "├─";
        lines.push(`${indent}${prefix} ${error.path}: ${error.message}`);
        if (error.expected && error.actual !== undefined) {
          lines.push(
            `${indent}   Expected: ${error.expected}, Got: ${error.actual}`,
          );
        }
      });
      lines.push("");
    }

    // Path parameters if present
    if (
      entry.request.pathParams &&
      Object.keys(entry.request.pathParams).length > 0
    ) {
      lines.push(`${indent}Path Parameters:`);
      const pathParamEntries = Object.entries(entry.request.pathParams);
      pathParamEntries.forEach(([key, value], i) => {
        const prefix = i === pathParamEntries.length - 1 ? "└─" : "├─";
        lines.push(`${indent}${prefix} ${key}: ${value}`);
      });
      lines.push("");
    }

    // Query parameters if present
    if (entry.request.query) {
      const params = new URLSearchParams(entry.request.query);
      const paramArray = Array.from(params.entries());
      if (paramArray.length > 0) {
        lines.push(`${indent}Query Parameters:`);
        paramArray.forEach(([key, value], i) => {
          const prefix = i === paramArray.length - 1 ? "└─" : "├─";
          lines.push(`${indent}${prefix} ${key}: ${value}`);
        });
        lines.push("");
      }
    }

    // Request headers
    const reqHeaders = this.formatHeadersArray(entry.request.headers);
    if (reqHeaders.length > 0) {
      lines.push(`${indent}Request Headers:`);
      reqHeaders.forEach((h, i) => {
        const prefix = i === reqHeaders.length - 1 ? "└─" : "├─";
        lines.push(`${indent}${prefix} ${h}`);
      });
      lines.push("");
    }

    // Request body if present
    if (entry.request.body) {
      lines.push(`${indent}Request Body:`);
      const bodyLines = this.formatJsonBody(entry.request.body, indent + "  ");
      lines.push(...bodyLines);
      lines.push("");
    }

    // Response headers
    if (entry.response.headers) {
      const respHeaders = this.formatHeadersArray(entry.response.headers);
      if (respHeaders.length > 0) {
        lines.push(`${indent}Response Headers:`);
        respHeaders.forEach((h, i) => {
          const prefix = i === respHeaders.length - 1 ? "└─" : "├─";
          lines.push(`${indent}${prefix} ${h}`);
        });
        lines.push("");
      }
    }

    // Response body if present
    if (entry.response.body) {
      lines.push(`${indent}Response Body:`);
      const bodyLines = this.formatJsonBody(entry.response.body, indent + "  ");
      lines.push(...bodyLines);
    }

    return lines;
  }

  protected override formatStatus(code: number): string {
    const text = this.getStatusText(code);
    if (code >= 200 && code < 300) {
      return `${code} ${text}`; // No color for success
    } else if (code >= 400 && code < 500) {
      return `${ANSI.YELLOW}${code} ${text}${ANSI.RESET}`;
    } else if (code >= 500) {
      return `${ANSI.RED}${code} ${text}${ANSI.RESET}`;
    }
    return `${code} ${text}`;
  }

  private formatHeadersArray(headers: Headers): string[] {
    const formatted: string[] = [];
    const sensitive = ["authorization", "cookie", "x-api-key"];

    headers.forEach((value, key) => {
      if (sensitive.includes(key.toLowerCase())) {
        formatted.push(`${key}: ${ANSI.DIM}(hidden)${ANSI.RESET}`);
      } else {
        formatted.push(`${key}: ${value}`);
      }
    });

    return formatted;
  }

  protected override getStatusText(code: number): string {
    const statuses: Record<number, string> = {
      200: "OK",
      201: "Created",
      204: "No Content",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      500: "Internal Server Error",
    };
    return statuses[code] || "";
  }

  private formatJsonBody(body: unknown, indent: string): string[] {
    const lines: string[] = [];

    if (typeof body === "object" && body !== null) {
      const json = JSON.stringify(body, null, 2);
      const jsonLines = json.split("\n");

      // In basic expansion, truncate large bodies
      if (jsonLines.length > 20) {
        lines.push(...jsonLines.slice(0, 20).map((line) => indent + line));
        lines.push(
          `${indent}${ANSI.DIM}... ${
            jsonLines.length - 20
          } more lines${ANSI.RESET}`,
        );
      } else {
        lines.push(...jsonLines.map((line) => indent + line));
      }
    } else {
      lines.push(indent + String(body));
    }

    return lines;
  }

  private async write(text: string): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode(text));
  }
}
