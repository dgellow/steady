#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-sys --allow-run

import React, { useState, useEffect } from "npm:react";
import { render, Box, Text, useInput, useApp, useFocus } from "npm:ink";
import { ValidationResult } from "./types.ts";
import { RequestLogger } from "./logger.ts";

// Storage for log entries
interface StoredRequest {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  query: string;
  headers: Headers;
  body?: unknown;
  pathParams?: Record<string, string>;
  statusCode: number;
  statusText: string;
  responseHeaders?: Headers;
  responseBody?: unknown;
  timing: number;
  validation?: ValidationResult;
}

// Global store for requests (shared with logger)
const requestStore: StoredRequest[] = [];

// Logger that captures requests
export class InkLogger extends RequestLogger {
  private currentRequestId?: string;
  private pendingRequest?: Partial<StoredRequest>;
  private onNewRequest?: (request: StoredRequest) => void;
  private app?: any; // Store the Ink app instance

  setOnNewRequest(callback: (request: StoredRequest) => void) {
    this.onNewRequest = callback;
  }

  setApp(app: any) {
    this.app = app;
  }

  stop() {
    // Properly unmount the Ink app if it exists
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
    
    requestStore.push(entry);
    if (requestStore.length > 1000) {
      requestStore.shift();
    }
    
    // Notify the UI
    if (this.onNewRequest) {
      this.onNewRequest(entry);
    }
    
    this.pendingRequest = undefined;
    this.currentRequestId = undefined;
  }

  override logResponseDetails(res: Response, body?: unknown): void {
    const lastEntry = requestStore[requestStore.length - 1];
    if (lastEntry) {
      lastEntry.responseHeaders = res.headers;
      lastEntry.responseBody = body;
    }
  }
}

// Individual log entry component
interface LogEntryProps {
  entry: StoredRequest;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
}

const LogEntry = ({ entry, isSelected, isExpanded, onClick }: LogEntryProps) => {
  useFocus({ autoFocus: isSelected });

  const timestamp = entry.timestamp.toLocaleTimeString();
  const hasValidationErrors = entry.validation && !entry.validation.valid;

  return (
    <Box flexDirection="column" onClick={onClick}>
      <Box>
        <Text inverse={isSelected}>
          <Text dimColor>[{timestamp}]</Text>{" "}
          {entry.method} {entry.path}
          <Text dimColor>{entry.query}</Text>
          {" → "}
          <Text color={entry.statusCode >= 400 ? (entry.statusCode >= 500 ? "red" : "yellow") : undefined}>
            {entry.statusCode} {entry.statusText}
          </Text>
          {" "}
          <Text dimColor>({entry.timing}ms)</Text>
          {isExpanded ? " ▼" : isSelected ? " ▶" : ""}
        </Text>
      </Box>
      
      {/* Validation summary when collapsed */}
      {!isExpanded && hasValidationErrors && entry.validation && entry.validation.errors[0] && (
        <Box paddingLeft={11}>
          <Text color="yellow">
            ⚠️  {entry.validation.errors[0].path}: {entry.validation.errors[0].message}
            {entry.validation.errors.length > 1 && (
              <Text dimColor> (+{entry.validation.errors.length - 1} more)</Text>
            )}
          </Text>
        </Box>
      )}
      
      {/* Expanded details */}
      {isExpanded && (
        <Box flexDirection="column" paddingLeft={11} marginTop={1}>
          {/* Validation errors */}
          {hasValidationErrors && entry.validation && (
            <>
              <Text color="red">Validation Errors:</Text>
              {entry.validation.errors.map((error: any, i: number) => (
                <Box key={i} paddingLeft={2}>
                  <Text>{i === entry.validation!.errors.length - 1 ? "└─" : "├─"} {error.path}: {error.message}</Text>
                  {error.expected && (
                    <Box paddingLeft={3}>
                      <Text dimColor>Expected: {String(error.expected)}, Got: {String(error.actual)}</Text>
                    </Box>
                  )}
                </Box>
              ))}
              <Text> </Text>
            </>
          )}
          
          {/* Query parameters */}
          {entry.query && (
            <>
              <Text>Query Parameters:</Text>
              {Array.from(new URLSearchParams(entry.query)).map(([key, value], i, arr) => (
                <Box key={key} paddingLeft={2}>
                  <Text>{i === arr.length - 1 ? "└─" : "├─"} {key}: {value}</Text>
                </Box>
              ))}
              <Text> </Text>
            </>
          )}
          
          {/* Request headers */}
          {entry.headers && (
            <>
              <Text>Request Headers:</Text>
              {(() => {
                const headers = Array.from(entry.headers.entries())
                  .filter(([key]: [string, string]) => !["authorization", "cookie", "x-api-key"].includes(key.toLowerCase()));
                return headers.map(([key, value]: [string, string], i: number) => (
                  <Box key={key} paddingLeft={2}>
                    <Text>{i === headers.length - 1 ? "└─" : "├─"} {key}: {value}</Text>
                  </Box>
                ));
              })()}
              <Text> </Text>
            </>
          )}
          
          {/* Request body */}
          {entry.body && (
            <>
              <Text>Request Body:</Text>
              <Box paddingLeft={2}>
                <Text>{JSON.stringify(entry.body, null, 2).substring(0, 500)}</Text>
              </Box>
              <Text> </Text>
            </>
          )}
          
          {/* Response body */}
          {entry.responseBody && (
            <>
              <Text>Response Body:</Text>
              <Box paddingLeft={2}>
                <Text>{JSON.stringify(entry.responseBody, null, 2).substring(0, 500)}</Text>
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  );
};

// Main app component
interface AppProps {
  logger: InkLogger;
}

const App = ({ logger }: AppProps) => {
  const { exit } = useApp();
  const [requests, setRequests] = useState<StoredRequest[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState(false);

  // Enable mouse tracking on mount, disable on unmount
  useEffect(() => {
    const encoder = new TextEncoder();
    
    // Enable mouse tracking (SGR extended mode for better support)
    Deno.stdout.writeSync(encoder.encode('\x1b[?1000h\x1b[?1002h\x1b[?1015h\x1b[?1006h'));
    
    // Cleanup function to disable mouse tracking
    const cleanup = () => {
      Deno.stdout.writeSync(encoder.encode('\x1b[?1000l\x1b[?1002l\x1b[?1015l\x1b[?1006l'));
    };
    
    // Handle unexpected process exits
    const handleExit = () => cleanup();
    Deno.addSignalListener('SIGINT', handleExit);
    Deno.addSignalListener('SIGTERM', handleExit);
    
    return () => {
      cleanup();
      try {
        Deno.removeSignalListener('SIGINT', handleExit);
        Deno.removeSignalListener('SIGTERM', handleExit);
      } catch {
        // Ignore errors during cleanup
      }
    };
  }, []);

  // Subscribe to new requests
  useEffect(() => {
    // Load existing requests
    setRequests([...requestStore]);
    
    // Listen for new ones
    logger.setOnNewRequest((request: StoredRequest) => {
      setRequests((prev: StoredRequest[]) => [...prev, request].slice(-100)); // Keep last 100
    });
  }, [logger]);

  // Filter requests
  const filteredRequests = requests.filter((req: StoredRequest) => {
    if (!filter) return true;
    
    // Special filters
    if (filter.includes(":")) {
      const [type, value] = filter.split(":", 2);
      switch (type) {
        case "status":
          return req.statusCode.toString().startsWith(value);
        case "method":
          return req.method.toLowerCase() === value.toLowerCase();
        default:
          break;
      }
    }
    
    // General text search
    const searchStr = `${req.method} ${req.path} ${req.statusCode}`.toLowerCase();
    return searchStr.includes(filter.toLowerCase());
  });

  // Handle keyboard input
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      // Exit will trigger our cleanup effect
      exit();
    }

    if (filterMode) {
      if (key.escape) {
        setFilterMode(false);
        setFilter("");
      } else if (key.return) {
        setFilterMode(false);
      } else if (key.backspace || key.delete) {
        setFilter((prev: string) => prev.slice(0, -1));
      } else if (input && input.length === 1) {
        setFilter((prev: string) => prev + input);
      }
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex(Math.min(filteredRequests.length - 1, selectedIndex + 1));
    } else if (key.return || input === " ") {
      const entry = filteredRequests[selectedIndex];
      if (entry) {
        setExpandedIds((prev: Set<string>) => {
          const next = new Set(prev);
          if (next.has(entry.id)) {
            next.delete(entry.id);
          } else {
            next.add(entry.id);
          }
          return next;
        });
      }
    } else if (key.escape) {
      const entry = filteredRequests[selectedIndex];
      if (entry) {
        setExpandedIds((prev: Set<string>) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
      }
    } else if (input === "/") {
      setFilterMode(true);
    } else if (input === "c") {
      setRequests([]);
      requestStore.length = 0;
    }
  });

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="blue">🚀 Steady Interactive Mode</Text>
        {filter && (
          <Text dimColor> - Filter: {filter}</Text>
        )}
      </Box>

      {/* Request list */}
      <Box flexDirection="column">
        {filteredRequests.map((entry: StoredRequest, i: number) => {
          const props: LogEntryProps = {
            entry,
            isSelected: i === selectedIndex,
            isExpanded: expandedIds.has(entry.id),
            onClick: () => {
              setSelectedIndex(i);
              setExpandedIds((prev: Set<string>) => {
                const next = new Set(prev);
                if (next.has(entry.id)) {
                  next.delete(entry.id);
                } else {
                  next.add(entry.id);
                }
                return next;
              });
            },
          };
          return (
            <Box key={entry.id}>
              <LogEntry {...props} />
            </Box>
          );
        })}
      </Box>

      {/* Status bar */}
      <Box marginTop={1}>
        {filterMode ? (
          <Text>
            <Text color="yellow">Filter: {filter}_</Text>
          </Text>
        ) : (
          <Text dimColor>
            [↑↓] Navigate  [Enter/Click] Expand  [/] Filter  [c] Clear  [q] Quit
          </Text>
        )}
      </Box>
    </Box>
  );
};

// Export function to start the UI
export function startInkLogger(logger: InkLogger): void {
  const app = render(<App logger={logger} />, {
    exitOnCtrlC: true  // Properly handle Ctrl+C
  });
  
  // Store the app instance in the logger for cleanup
  logger.setApp(app);
}