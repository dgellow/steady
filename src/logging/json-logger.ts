/**
 * JsonLogger - NDJSON output for CI and machine parsing
 */

import { BaseLogger } from "./logger.ts";
import type {
  LoggerOptions,
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
} from "./types.ts";

export class JsonLogger extends BaseLogger {
  constructor(options: Partial<LoggerOptions> = {}) {
    super({ ...options, color: false });
  }

  request(event: RequestEvent): void {
    const output = {
      type: "request",
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      request: {
        method: event.request.method,
        path: event.request.path,
        pathPattern: event.request.pathPattern,
        query: event.request.query || undefined,
      },
      response: {
        status: event.response.status,
        statusText: event.response.statusText,
        timing: event.response.timing,
      },
      validation: {
        valid: event.validation.valid,
        errors: event.validation.errors.map((e) => ({
          path: e.path,
          keyword: e.keyword,
          expected: e.expected,
          actual: e.actual,
          specPointer: e.specPointer,
          attribution: {
            type: e.attribution.type,
            confidence: e.attribution.confidence,
          },
          suggestion: e.suggestion,
        })),
        warnings: event.validation.warnings.map((w) => ({
          path: w.path,
          keyword: w.keyword,
          expected: w.expected,
          actual: w.actual,
          specPointer: w.specPointer,
          attribution: {
            type: w.attribution.type,
            confidence: w.attribution.confidence,
          },
          suggestion: w.suggestion,
        })),
      },
    };

    console.log(JSON.stringify(output));
  }

  startup(event: StartupEvent): void {
    const output = {
      type: "startup",
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      spec: event.spec,
      server: event.server,
      diagnostics: event.diagnostics.map((d) => ({
        severity: d.severity,
        code: d.code,
        pointer: d.pointer,
        message: d.message,
        chain: d.chain,
      })),
    };

    console.log(JSON.stringify(output));
  }

  shutdown(event: ShutdownEvent): void {
    const output = {
      type: "shutdown",
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      session: event.session,
      topIssues: event.topIssues.map((i) => ({
        method: i.method,
        path: i.path,
        message: i.message,
        count: i.count,
        attribution: i.attribution.type,
      })),
    };

    console.log(JSON.stringify(output));
  }

  warning(message: string, context?: Record<string, unknown>): void {
    const output = {
      type: "warning",
      timestamp: new Date().toISOString(),
      message,
      context,
    };

    console.log(JSON.stringify(output));
  }

  error(message: string, context?: Record<string, unknown>): void {
    const output = {
      type: "error",
      timestamp: new Date().toISOString(),
      message,
      context,
    };

    console.log(JSON.stringify(output));
  }
}
