/**
 * Session endpoint handler. GET /_x-steady/sessions/{session_id}
 *
 * Returns the session report as JSON with diagnostics grouped by category.
 * The JSON keys use snake_case to match the spec's API convention.
 */

import type { SessionDiagnostic, SessionStore } from "./store.ts";

/**
 * Handle a session query request.
 *
 * @param sessionId - The session ID extracted from the URL path
 * @param store - The session store to query
 */
export function handleSessionRequest(
  sessionId: string,
  store: SessionStore,
): Response {
  // Strip leading slash if present
  const id = sessionId.startsWith("/") ? sessionId.slice(1) : sessionId;

  const report = store.getSession(id);
  if (!report) {
    return new Response(
      JSON.stringify({ error: "Session not found" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const body: Record<string, unknown> = {
    session_id: report.sessionId,
    requests: report.requests,
    result: report.result,
    summary: report.summary,
    sdk_issues: report.sdkIssues.map(toJson),
    content_notes: report.contentNotes.map(toJson),
    ambiguous: report.ambiguous.map(toJson),
    spec_issues: report.specIssues.map(toJson),
  };

  if (report.coverage) {
    body.coverage = report.coverage;
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function toJson(d: SessionDiagnostic): Record<string, unknown> {
  const result: Record<string, unknown> = {
    code: d.code,
    severity: d.severity,
    message: d.message,
    method: d.method,
    path: d.path,
    request_path: d.requestPath,
    spec_pointer: d.specPointer,
    attribution: d.attribution,
  };

  if (d.suggestion !== undefined) {
    result.suggestion = d.suggestion;
  }

  return result;
}
