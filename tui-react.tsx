#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-sys --allow-run

import React, { useEffect, useState } from "npm:react";
import { Box, render, Text, useApp, useInput } from "npm:ink";
import TextInput from "npm:ink-text-input";

interface Request {
  timestamp: Date;
  method: string;
  path: string;
  query: string;
  status: number;
  timing: number;
  errors?: number;
}

const StatusText = (
  { status, inverse }: { status: number; inverse?: boolean },
) => {
  let color = "white";
  if (status >= 200 && status < 300) color = "green";
  else if (status >= 400 && status < 500) color = "yellow";
  else if (status >= 500) color = "red";

  return <Text color={color} inverse={inverse}>{status}</Text>;
};

const MethodText = (
  { method, inverse }: { method: string; inverse?: boolean },
) => {
  const colors: Record<string, string> = {
    GET: "blue",
    POST: "green",
    PUT: "yellow",
    DELETE: "red",
  };

  return (
    <Text color={colors[method] || "white"} inverse={inverse}>{method}</Text>
  );
};

const App = () => {
  const { exit } = useApp();
  const [requests, setRequests] = useState<Request[]>([]);
  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Generate fake requests
  useEffect(() => {
    const interval = setInterval(() => {
      const methods = ["GET", "POST", "PUT", "DELETE"];
      const paths = ["/users", "/products", "/orders", "/api/v1/test"];
      const statuses = [200, 201, 400, 404, 500];

      setRequests((prev: Request[]) =>
        [...prev, {
          timestamp: new Date(),
          method: methods[Math.floor(Math.random() * methods.length)],
          path: paths[Math.floor(Math.random() * paths.length)],
          query: Math.random() > 0.5 ? "?test=true" : "",
          status: statuses[Math.floor(Math.random() * statuses.length)],
          timing: Math.floor(Math.random() * 200),
          errors: Math.random() > 0.7
            ? Math.floor(Math.random() * 5)
            : undefined,
        }].slice(-20)
      ); // Keep last 20
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Handle keyboard input
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
    }

    if (filterMode) {
      if (key.escape) {
        setFilterMode(false);
        setFilter("");
      }
      return;
    }

    if (input === "/") {
      setFilterMode(true);
    } else if (key.upArrow || input === "k") {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex(
        Math.min(filteredRequests.length - 1, selectedIndex + 1),
      );
    } else if (input === "c") {
      setRequests([]);
    }
  });

  // Filter requests
  const filteredRequests = requests.filter((req: Request) => {
    if (!filter) return true;
    const searchStr = `${req.method} ${req.path} ${req.status}`.toLowerCase();
    return searchStr.includes(filter.toLowerCase());
  });

  // Format data for table (removed as unused)

  const selectedRequest = filteredRequests[selectedIndex];

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="blue">🚀 Steady Interactive Mode (React)</Text>
      </Box>

      {/* Filter */}
      {filter && (
        <Box marginBottom={1}>
          <Text dimColor>Filter: {filter}</Text>
        </Box>
      )}

      {/* Table */}
      <Box flexDirection="column" marginBottom={1}>
        {filteredRequests.map((req: Request, i: number) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={i} paddingLeft={2}>
              <Box>
                <Text inverse={isSelected}>
                  {req.timestamp.toLocaleTimeString()}
                  {" "}
                </Text>
                <MethodText method={req.method} inverse={isSelected} />
                <Text inverse={isSelected}>
                  {" "}
                  {req.path}
                </Text>
                <Text dimColor inverse={isSelected}>{req.query}</Text>
                <Text inverse={isSelected}>→</Text>
                <StatusText status={req.status} inverse={isSelected} />
                <Text inverse={isSelected}>{req.timing}ms</Text>
                {req.errors && (
                  <Text color="yellow" inverse={isSelected}>
                    ⚠️ {req.errors}
                  </Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Selected request details */}
      {selectedRequest && (
        <Box borderStyle="single" paddingX={1} marginTop={1}>
          <Box flexDirection="column">
            <Text bold>{selectedRequest.method} {selectedRequest.path}</Text>
            <Text>Status: {selectedRequest.status}</Text>
            <Text>Timing: {selectedRequest.timing}ms</Text>
            {selectedRequest.errors && (
              <Text color="yellow">Errors: {selectedRequest.errors}</Text>
            )}
          </Box>
        </Box>
      )}

      {/* Status bar */}
      <Box marginTop={1}>
        {filterMode
          ? (
            <Box>
              <Text>Filter:</Text>
              <TextInput value={filter} onChange={setFilter} />
            </Box>
          )
          : <Text dimColor>[/]Filter [↑↓]Navigate [c]Clear [q]Quit</Text>}
      </Box>
    </Box>
  );
};

// Run the app
render(<App />);
