/**
 * JsonLogger - NDJSON output for CI and machine parsing.
 *
 * Outputs Diagnostic objects directly. No transformation or
 * reformatting; the Diagnostic type is already the right shape.
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
    const output: Record<string, unknown> = {
      type: "request",
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      request: {
        method: event.request.method,
        path: event.request.path,
        pathPattern: event.request.pathPattern,
        query: event.request.query || undefined,
        ...(this.shouldShowBodies() && event.request.body !== undefined
          ? { body: event.request.body }
          : {}),
      },
      response: {
        status: event.response.status,
        statusText: event.response.statusText,
        timing: event.response.timing,
        ...(this.shouldShowBodies() && event.response.body !== undefined
          ? { body: event.response.body }
          : {}),
        ...(event.response.responseWarning
          ? { responseWarning: event.response.responseWarning }
          : {}),
      },
      diagnostics: event.diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        category: d.category,
        path: d.requestPath,
        specPointer: d.specPointer,
        message: d.message,
        expected: d.expected,
        actual: d.actual,
        attribution: {
          confidence: d.attribution.confidence,
          reasoning: d.attribution.reasoning,
        },
        suggestion: d.suggestion,
      })),
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
        category: d.category,
        pointer: d.specPointer,
        message: d.message,
        attribution: {
          confidence: d.attribution.confidence,
          reasoning: d.attribution.reasoning,
        },
        suggestion: d.suggestion,
      })),
    };

    console.log(JSON.stringify(output));
  }

  shutdown(event: ShutdownEvent): void {
    const output: Record<string, unknown> = {
      type: "shutdown",
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      session: event.session,
      topIssues: event.topIssues.map((i) => ({
        code: i.code,
        method: i.method,
        path: i.path,
        message: i.message,
        count: i.count,
        category: i.category,
        attribution: {
          confidence: i.attribution.confidence,
          reasoning: i.attribution.reasoning,
        },
      })),
    };

    if (event.coverage) {
      output.coverage = event.coverage;
    }

    console.log(JSON.stringify(output));
  }

  warning(message: string, context?: Record<string, unknown>): void {
    console.log(JSON.stringify({
      type: "warning",
      timestamp: new Date().toISOString(),
      message,
      context,
    }));
  }

  error(message: string, context?: Record<string, unknown>): void {
    console.log(JSON.stringify({
      type: "error",
      timestamp: new Date().toISOString(),
      message,
      context,
    }));
  }
}
