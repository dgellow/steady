#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-sys --allow-net

import React, { useEffect, useState } from "npm:react";
import { Box, render, Text, useApp, useInput, useStdout } from "npm:ink";
// import fullscreen from "npm:fullscreen-ink"; // Not used currently
import process from "node:process";
import { LogLevel, ValidationResult } from "./types.ts";
import { RequestLogger } from "./logger.ts";

// Debug logging to file
const debugLog = (message: string) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    Deno.writeTextFileSync("ink-logger-debug.log", logMessage, {
      append: true,
    });
  } catch (_e) {
    // Ignore errors
  }
};

// ANSI codes we'll use directly
const DIM = "\x1b[2m";
const LIGHT_PINK = "\x1b[38;5;217m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

interface StoredRequest {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  query: string;
  headers: Headers;
  body?: unknown;
  statusCode: number;
  statusText: string;
  responseHeaders?: Headers;
  responseBody?: unknown;
  timing: number;
  validation?: ValidationResult;
}

export class InkSimpleLogger extends RequestLogger {
  private entries: StoredRequest[] = [];
  private currentRequestId?: string;
  private pendingRequest?: Partial<StoredRequest>;
  private onUpdate?: () => void;
  private app?: { unmount: () => void; waitUntilExit: () => Promise<void> };

  constructor(logLevel: LogLevel = "summary", logBodies = false) {
    super(logLevel, logBodies);
  }

  setOnUpdate(callback: () => void) {
    this.onUpdate = callback;
  }

  setApp(app: { unmount: () => void; waitUntilExit: () => Promise<void> }) {
    this.app = app;
  }

  getEntries(): StoredRequest[] {
    return this.entries;
  }

  stop() {
    if (this.app) {
      this.app.unmount();
    }
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

    this.entries.push(entry);
    debugLog(
      `Added entry ${this.entries.length - 1}: ${entry.method} ${entry.path}`,
    );

    if (this.entries.length > 1000) {
      this.entries.shift();
    }

    if (this.onUpdate) {
      this.onUpdate();
    }

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
}

// Simpler App component using Box with fixed dimensions
const App = ({ logger }: { logger: InkSimpleLogger }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [, forceUpdate] = useState({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [jumpMode, setJumpMode] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(false);

  const terminalHeight = stdout.rows - 1; // Subtract 1 to account for terminal quirks
  const terminalWidth = stdout.columns;

  useEffect(() => {
    logger.setOnUpdate(() => forceUpdate({}));
  }, [logger]);

  const entries = logger.getEntries();

  // Filter entries
  const getFilteredEntries = (): StoredRequest[] => {
    let filtered = entries;

    if (filterText) {
      filtered = filtered.filter((entry) => {
        const searchStr = `${entry.method} ${entry.path} ${entry.statusCode}`
          .toLowerCase();
        return searchStr.includes(filterText.toLowerCase());
      });
    }

    if (jumpMode && jumpText) {
      if (jumpText.startsWith("#")) {
        const hexId = jumpText.slice(1);
        const targetIndex = parseInt(hexId, 16);
        const entry = entries[targetIndex];
        return entry ? [entry] : [];
      } else {
        const searchText = jumpText.toLowerCase();
        return entries.filter((entry) => {
          const searchStr = `${entry.method} ${entry.path}`.toLowerCase();
          return searchStr.includes(searchText);
        });
      }
    }

    return filtered;
  };

  const filtered = getFilteredEntries();

  // Get hex digits needed
  const getHexDigits = () => {
    const count = filtered.length;
    if (count <= 16) return 1;
    if (count <= 256) return 2;
    return 3;
  };

  const formatHexId = (index: number): string => {
    return index.toString(16).padStart(getHexDigits(), "0");
  };

  // Calculate viewport first to determine if we need scroll indicator
  const baseContentHeight = Math.max(1, terminalHeight - 1 - 2); // 1 for header, 2 for footer initially
  let viewportStart = 0;
  if (selectedIndex >= baseContentHeight) {
    viewportStart = selectedIndex - baseContentHeight + 1;
  }

  // Now calculate actual header height based on whether we're scrolled
  const headerHeight = viewportStart > 0 ? 2 : 1; // Dynamic based on scroll indicator
  const footerHeight = 2; // Status + bottom scroll
  const contentHeight = Math.max(
    1,
    terminalHeight - headerHeight - footerHeight,
  );

  // Recalculate viewport with correct content height if needed
  if (selectedIndex >= contentHeight) {
    viewportStart = selectedIndex - contentHeight + 1;
  }
  const viewportEnd = Math.min(filtered.length, viewportStart + contentHeight);
  const visibleEntries = filtered.slice(viewportStart, viewportEnd);

  debugLog(
    `Render: termHeight=${terminalHeight}, contentHeight=${contentHeight}, viewport=${viewportStart}-${viewportEnd}, entries=${entries.length}, filtered=${filtered.length}`,
  );
  if (visibleEntries.length > 0 && visibleEntries[0]) {
    const firstEntry = visibleEntries[0];
    const firstHex = formatHexId(
      entries.findIndex((e) => e.id === firstEntry.id),
    );
    debugLog(
      `First visible: hex=${firstHex} method=${firstEntry.method} path=${firstEntry.path}`,
    );
  }

  // Handle input
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    if (jumpMode) {
      if (key.escape) {
        setJumpMode(false);
        setJumpText("");
        setSelectedIndex(0);
      } else if (key.return) {
        if (filtered.length > 0 && selectedIndex < filtered.length) {
          const selectedEntry = filtered[selectedIndex];
          const originalIndex = entries.findIndex((e) =>
            selectedEntry && e.id === selectedEntry.id
          );
          if (originalIndex >= 0) {
            setJumpMode(false);
            setJumpText("");
            setSelectedIndex(originalIndex);
          }
        }
      } else if (key.backspace || key.delete) {
        setJumpText((prev: string) => prev.slice(0, -1));
        setSelectedIndex(0);
      } else if (input && input.length === 1) {
        setJumpText((prev: string) => prev + input.toLowerCase());
        setSelectedIndex(0);
      }
      return;
    }

    if (filterMode) {
      if (key.escape) {
        setFilterMode(false);
        setFilterText("");
      } else if (key.return) {
        setFilterMode(false);
      } else if (key.backspace || key.delete) {
        setFilterText((prev: string) => prev.slice(0, -1));
      } else if (input && input.length === 1) {
        setFilterText((prev: string) => prev + input);
      }
      return;
    }

    // Navigation
    if (key.downArrow || input === "j") {
      setSelectedIndex(Math.min(filtered.length - 1, selectedIndex + 1));
    } else if (key.upArrow || input === "k") {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (input === "g") {
      setJumpMode(true);
      setJumpText("");
    } else if (input === "G") {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    } else if (key.ctrl && input === "a") {
      setSelectedIndex(0);
    } else if (key.ctrl && input === "e") {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    } else if (key.return || input === " ") {
      const entry = filtered[selectedIndex];
      if (entry) {
        setExpandedId(expandedId === entry.id ? null : entry.id);
      }
    } else if (input === "/") {
      setFilterMode(true);
    } else if (input === "c") {
      logger.getEntries().length = 0;
      setSelectedIndex(0);
      setExpandedId(null);
    } else if (input === "t") {
      setShowTimestamps(!showTimestamps);
    }
  });

  // Render
  return (
    <Box flexDirection="column" width={terminalWidth} height={terminalHeight}>
      {/* Header */}
      <Box flexDirection="column" height={headerHeight}>
        <Text>
          Steady Interactive Logger
          {filterText &&
            ` ${DIM}(showing ${filtered.length} of ${entries.length} entries)${RESET}`}
        </Text>
        {viewportStart > 0 && (
          <Text>{`${DIM}↑ ${viewportStart} more entries above${RESET}`}</Text>
        )}
      </Box>

      {/* Content */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleEntries.map((entry, idx) => {
          const actualIndex = viewportStart + idx;
          const originalIndex = entries.findIndex((e) =>
            e.id === entry.id
          );
          const isSelected = actualIndex === selectedIndex;
          const isExpanded = expandedId === entry.id;
          const hexId = formatHexId(originalIndex);

          const lines: string[] = [];

          // Main line
          let line = isSelected ? "> " : "  ";
          if (showTimestamps) {
            const timestamp = entry.timestamp.toLocaleTimeString("en-GB", {
              hour12: false,
            });
            line += `[${timestamp}] `;
          }
          line += `${hexId}  ${entry.method.padEnd(6)} ${entry.path}`;
          if (entry.query) {
            line += `${DIM}${entry.query}${RESET}`;
          }

          const statusColor = entry.statusCode >= 500
            ? RED
            : entry.statusCode >= 400
            ? YELLOW
            : "";
          line +=
            `  ${statusColor}${entry.statusCode} ${entry.statusText}${RESET}`;
          line += `  ${DIM}${entry.timing}ms${RESET}`;

          lines.push(line);

          // Validation error
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

          return (
            <Box key={entry.id} flexDirection="column">
              {lines.map((l, i) => (
                <React.Fragment key={i}>
                  <Text>{l}</Text>
                </React.Fragment>
              ))}
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box flexDirection="column" height={footerHeight}>
        <Text>
          {viewportEnd < filtered.length
            ? `${DIM}↓ ${
              filtered.length - viewportEnd
            } more entries below${RESET}`
            : ""}
        </Text>
        <Text>
          {jumpMode
            ? `Jump: ${jumpText}_ (${filtered.length} matches)`
            : filterMode
            ? `Filter: ${filterText}_`
            : `${DIM}j/k:nav space:expand g:jump ${
              filterText
                ? `${LIGHT_PINK}/:filter("${filterText}")${RESET}`
                : "/:filter"
            } t:time q:quit${RESET}`}
        </Text>
      </Box>
    </Box>
  );
};

export function startInkSimpleLogger(logger: InkSimpleLogger): void {
  // Switch to alternate screen buffer (preserves terminal history)
  process.stdout.write("\x1b[?1049h"); // Save cursor and switch to alternate screen
  process.stdout.write("\x1b[2J"); // Clear the alternate screen
  process.stdout.write("\x1b[H"); // Move cursor to home

  const app = render(<App logger={logger} />, {
    exitOnCtrlC: false,
  });
  logger.setApp(app);

  app.waitUntilExit().then(() => {
    // Restore original screen buffer
    process.stdout.write("\x1b[?1049l"); // Restore cursor and switch back to main screen
    Deno.exit(0);
  });

  // Also handle unexpected exits
  const cleanup = () => {
    process.stdout.write("\x1b[?1049l");
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
