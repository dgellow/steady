/**
 * CILogger - GitHub Actions annotation output.
 *
 * Minimal per-request output (only requests with diagnostics).
 * Uses ::error:: and ::warning:: annotations for GitHub Actions.
 * All lines prefixed with STEADY: for easy filtering.
 * Summary-first shutdown with pass/fail verdict.
 */

import { BaseLogger } from "./logger.ts";
import type {
  LoggerOptions,
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
} from "./types.ts";

export class CILogger extends BaseLogger {
  constructor(options: Partial<LoggerOptions> = {}) {
    super({ ...options, color: false });
  }

  request(event: RequestEvent): void {
    // Only log requests that have diagnostics
    if (event.diagnostics.length === 0) return;

    const method = event.request.method;
    const path = event.request.path;
    const status = event.response.status;

    console.log(
      `STEADY: ${method} ${path} -> ${status} (${event.diagnostics.length} diagnostics)`,
    );

    for (const d of event.diagnostics) {
      const level = d.severity === "error" ? "error" : "warning";
      // GitHub Actions annotation format
      console.log(
        `::${level}::STEADY ${d.code} [${d.category}] ${d.requestPath}: ${d.message}`,
      );
    }
  }

  startup(event: StartupEvent): void {
    console.log(
      `STEADY: Loaded ${event.spec.title} v${event.spec.version} (${event.spec.endpointCount} endpoints)`,
    );
    console.log(`STEADY: Server listening at ${event.server.url}`);

    if (event.diagnostics.length > 0) {
      console.log(
        `STEADY: ${event.diagnostics.length} spec diagnostics at startup`,
      );
      for (const d of event.diagnostics) {
        const level = d.severity === "error" ? "error" : "warning";
        console.log(`::${level}::STEADY ${d.code}: ${d.message}`);
      }
    }
  }

  shutdown(event: ShutdownEvent): void {
    const { session, topIssues, coverage } = event;
    const passed = session.failedCount === 0;
    const verdict = passed ? "PASSED" : "FAILED";

    console.log("");
    console.log(`STEADY: ${verdict}`);
    console.log(
      `STEADY: ${session.requestCount} requests, ${session.failedCount} failed, validity ${
        (session.validityRate * 100).toFixed(0)
      }%`,
    );

    if (coverage) {
      console.log(
        `STEADY: Coverage ${coverage.tested}/${coverage.total} endpoints`,
      );
    }

    if (topIssues.length > 0) {
      console.log(`STEADY: Top issues:`);
      for (const issue of topIssues) {
        const level = issue.category === "sdk-issue" ? "error" : "warning";
        console.log(
          `::${level}::STEADY ${issue.code} [${issue.category}] ${issue.method} ${issue.path}: ${issue.message} (x${issue.count})`,
        );
      }
    }
  }

  warning(message: string, _context?: Record<string, unknown>): void {
    console.log(`::warning::STEADY: ${message}`);
  }

  error(message: string, _context?: Record<string, unknown>): void {
    console.log(`::error::STEADY: ${message}`);
  }
}
