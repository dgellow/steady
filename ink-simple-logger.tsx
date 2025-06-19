#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-sys --allow-net

import React, { useEffect, useState } from "npm:react";
import { render, Text, useApp, useInput } from "npm:ink";
import process from "node:process";
import { LogLevel, ValidationResult } from "./types.ts";
import { RequestLogger } from "./logger.ts";

// Debug logging - disabled for now
const debugLog = (_message: string) => {
  // Disabled to avoid permission issues
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

// Simple App component - just text rendering
const App = ({ logger }: { logger: InkSimpleLogger }) => {
  const { exit } = useApp();
  const [, forceUpdate] = useState({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [jumpMode, setJumpMode] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [viewportTop, setViewportTop] = useState(0);

  // Terminal height - get from Ink's stdout
  const [terminalHeight, setTerminalHeight] = useState(
    process.stdout.rows || 24,
  );

  useEffect(() => {
    const updateSize = () => {
      setTerminalHeight(process.stdout.rows || 24);
    };
    process.stdout.on("resize", updateSize);
    return () => {
      process.stdout.off("resize", updateSize);
    };
  }, []);

  const contentHeight = Math.max(1, terminalHeight - 5); // 3 header lines + 2 footer lines

  useEffect(() => {
    logger.setOnUpdate(() => {
      forceUpdate({});
      // Reset viewport if it's out of bounds
      const entries = logger.getEntries();
      if (selectedIndex >= entries.length) {
        setSelectedIndex(Math.max(0, entries.length - 1));
      }
    });
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
        return targetIndex < entries.length ? [entries[targetIndex]] : [];
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

  // Update viewport when selection changes
  useEffect(() => {
    if (selectedIndex < viewportTop) {
      setViewportTop(selectedIndex);
    } else if (selectedIndex >= viewportTop + contentHeight) {
      setViewportTop(selectedIndex - contentHeight + 1);
    }
  }, [selectedIndex, viewportTop, contentHeight]);

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
            e.id === selectedEntry.id
          );
          if (originalIndex >= 0) {
            setJumpMode(false);
            setJumpText("");
            setSelectedIndex(originalIndex);
          }
        }
      } else if (key.backspace || key.delete) {
        setJumpText((prev) => prev.slice(0, -1));
        setSelectedIndex(0);
      } else if (input && input.length === 1) {
        setJumpText((prev) => prev + input.toLowerCase());
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
        setFilterText((prev) => prev.slice(0, -1));
      } else if (input && input.length === 1) {
        setFilterText((prev) => prev + input);
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
    } else if (key.ctrl && input === "f") {
      setSelectedIndex(
        Math.min(filtered.length - 1, selectedIndex + contentHeight),
      );
    } else if (key.ctrl && input === "b") {
      setSelectedIndex(Math.max(0, selectedIndex - contentHeight));
    }
  });

  // Build display lines
  const lines: string[] = [];

  // Debug log render info
  debugLog(
    `Render: entries=${entries.length}, filtered=${filtered.length}, viewport=${viewportTop}-${
      viewportTop + contentHeight
    }, termHeight=${terminalHeight}, contentHeight=${contentHeight}`,
  );

  // Header
  let headerLine = "Steady Interactive Logger";
  if (filterText) {
    headerLine +=
      ` ${DIM}(showing ${filtered.length} of ${entries.length} entries)${RESET}`;
  }
  // Debug: show viewport info and entry count
  headerLine += ` ${DIM}[vp: ${viewportTop}-${
    viewportTop + contentHeight
  }, entries: ${filtered.length}]${RESET}`;
  lines.push(headerLine);

  // Scroll indicator
  if (filtered.length > contentHeight && viewportTop > 0) {
    lines.push(`${DIM}↑ ${viewportTop} more entries above${RESET}`);
  } else {
    lines.push("");
  }

  lines.push(""); // Separator

  // Visible entries
  const visibleEntries = filtered.slice(
    viewportTop,
    viewportTop + contentHeight,
  );

  // Debug: log visible entries info
  if (visibleEntries.length > 0) {
    debugLog(
      `Visible entries: ${visibleEntries.length}, first hex: ${
        formatHexId(entries.findIndex((e) => e.id === visibleEntries[0].id))
      }`,
    );
  }

  visibleEntries.forEach((entry, viewIndex) => {
    const actualIndex = viewportTop + viewIndex;
    const originalIndex = entries.findIndex((e) => e.id === entry.id);
    const isSelected = actualIndex === selectedIndex;
    const isExpanded = expandedId === entry.id;
    const hexId = formatHexId(originalIndex);

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

    // Status
    const statusColor = entry.statusCode >= 500
      ? RED
      : entry.statusCode >= 400
      ? YELLOW
      : "";
    line += `  ${statusColor}${entry.statusCode} ${entry.statusText}${RESET}`;
    line += `  ${DIM}${entry.timing}ms${RESET}`;

    lines.push(line);

    // Validation error inline
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

    // Expanded details
    if (isExpanded) {
      lines.push("    Request:");
      lines.push(`      Method: ${entry.method}`);
      lines.push(`      Path: ${entry.path}`);

      if (entry.query) {
        lines.push(`      Query: ${entry.query}`);
      }

      if (entry.validation && !entry.validation.valid) {
        lines.push("");
        lines.push(`    ${RED}Validation Errors:${RESET}`);
        entry.validation.errors.slice(0, 3).forEach((error) => {
          lines.push(`      ${error.path}: ${error.message}`);
        });
      }

      lines.push("");
    }
  });

  // Debug: Add line count before padding
  const _linesBeforePadding = lines.length;

  // Pad to maintain layout
  const targetLines = terminalHeight - 2;
  while (lines.length < targetLines) {
    lines.push("");
  }

  // Bottom scroll indicator
  if (
    filtered.length > contentHeight &&
    viewportTop + contentHeight < filtered.length
  ) {
    lines.push(
      `${DIM}↓ ${
        filtered.length - viewportTop - contentHeight
      } more entries below${RESET}`,
    );
  } else {
    lines.push("");
  }

  // Status line
  if (jumpMode) {
    lines.push(
      `Jump: ${jumpText}_ (${filtered.length} match${
        filtered.length !== 1 ? "es" : ""
      })`,
    );
  } else if (filterMode) {
    lines.push(`Filter: ${filterText}_`);
  } else {
    const filterIndicator = filterText
      ? `${LIGHT_PINK}/:filter("${filterText}")${RESET}`
      : `/:filter`;
    lines.push(
      `${DIM}j/k:nav space/b:page g:jump ${filterIndicator} t:time q:quit${RESET}`,
    );
  }

  return <Text>{lines.join("\n")}</Text>;
};

export function startInkSimpleLogger(logger: InkSimpleLogger): void {
  const app = render(<App logger={logger} />, {
    exitOnCtrlC: false, // We'll handle exit ourselves
  });
  logger.setApp(app);

  // Handle graceful exit
  app.waitUntilExit().then(() => {
    Deno.exit(0);
  });
}
