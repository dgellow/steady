/**
 * Runs requests against a Steady built the way the CLI builds it: parse,
 * analyze, then a server with the analysis result. Tests that construct
 * the server differently test a startup path no user runs.
 */

import { parseSpec } from "../../packages/openapi/parser.ts";
import { analyzeSpec } from "../../src/engine/spec-analyzer.ts";
import { MockServer } from "../../src/server/mod.ts";

/** One finding as the response headers report it. */
export interface Finding {
  code: string;
  /** Location in the request, for example "body.items.0". */
  path: string;
}

export interface Outcome {
  status: number;
  /** Value of `x-steady-request-valid`. */
  valid: string | null;
  findings: Finding[];
}

export interface Session {
  /** Codes of the diagnostics reported when the spec was loaded. */
  startupCodes: string[];
  postJson(path: string, body: unknown): Promise<Outcome>;
}

/** Header text is percent-encoded where it is not visible ASCII. */
function decodeHeader(value: string | null): string {
  return value === null ? "" : decodeURIComponent(value);
}

/**
 * Load `spec`, start a server on a free port, run `use`, stop the server.
 * Everything the server opened is closed when this returns.
 */
export async function withSteady<T>(
  spec: Record<string, unknown>,
  use: (session: Session) => Promise<T>,
): Promise<T> {
  const parsed = await parseSpec(JSON.stringify(spec), { format: "json" });
  const analysis = analyzeSpec(parsed.spec, {
    baseUri: "file:///generated.json",
    defaultedFields: parsed.defaultedFields,
    shapeProblems: parsed.shapeProblems,
  });
  const server = new MockServer(parsed.spec, {
    port: 0,
    host: "127.0.0.1",
    quiet: true,
    logLevel: "summary",
    startupDiagnostics: analysis.diagnostics,
    specPath: "generated.json",
  }, analysis.docIndex);
  const port = await server.start();

  const postJson = async (path: string, body: unknown): Promise<Outcome> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await response.body?.cancel();
    const count = Number(response.headers.get("x-steady-error-count") ?? "0");
    const findings: Finding[] = [];
    for (let i = 1; i <= count; i++) {
      findings.push({
        code: response.headers.get(`x-steady-error-${i}-code`) ?? "",
        path: decodeHeader(response.headers.get(`x-steady-error-${i}-path`)),
      });
    }
    return {
      status: response.status,
      valid: response.headers.get("x-steady-request-valid"),
      findings,
    };
  };

  try {
    return await use({
      startupCodes: analysis.diagnostics.map((d) => d.code),
      postJson,
    });
  } finally {
    await server.stop();
  }
}

/** A spec with one operation, `POST /x`, whose JSON body has `schema`. */
export function specWithBody(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "generated", version: "1" },
    paths: {
      "/x": {
        post: {
          requestBody: {
            required: true,
            content: { "application/json": { schema } },
          },
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
}
