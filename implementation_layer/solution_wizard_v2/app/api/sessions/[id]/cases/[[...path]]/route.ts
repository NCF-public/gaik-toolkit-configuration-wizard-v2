// Cases: the generated solution in use (roles from the BPMN, AI step in the
// sandbox). One relay for wizard_api's /sessions/{id}/cases/... routes; the
// owner check is here and again in the api (#134). Only the path shapes the
// api serves are passed on.

import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { withLogging } from "@/lib/with-logging";
import { audit, type AuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getTraceId, setContextUserId } from "@/lib/request-context";
import { apiCases, wizardApiEnabled } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FILE = "[^/]{1,200}";
const ALLOWED: Record<string, RegExp[]> = {
  GET: [/^$/, /^model$/, new RegExp(`^${UUID}$`), new RegExp(`^${UUID}/inputs/${FILE}$`)],
  POST: [
    /^$/,
    new RegExp(`^${UUID}/inputs$`),
    new RegExp(`^${UUID}/submit$`),
    new RegExp(`^${UUID}/step$`),
    new RegExp(`^${UUID}/review$`),
  ],
  DELETE: [new RegExp(`^${UUID}/inputs/${FILE}$`)],
};
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

function auditEvent(method: string, subpath: string): AuditEvent {
  if (!subpath) return "case.create";
  if (subpath.includes("/inputs")) return method === "DELETE" ? "case.input.delete" : "case.input.upload";
  if (subpath.endsWith("/step")) return "case.step";
  return subpath.endsWith("/submit") ? "case.submit" : "case.review";
}

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

async function relay(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id, path = [] } = await params;
  const owned = await requireOwnedSession(id);
  if (!owned) return new Response("Session not found", { status: 404 });
  setContextUserId(owned.user.email);
  if (!wizardApiEnabled()) {
    return Response.json({ detail: "cases need the wizard api" }, { status: 404 });
  }

  const subpath = path.join("/");
  if (!(ALLOWED[req.method] ?? []).some((re) => re.test(subpath))) {
    return Response.json({ detail: "not found" }, { status: 404 });
  }
  const encoded = path.map(encodeURIComponent).join("/");

  try {
    let init: RequestInit = { method: req.method };
    if (req.method === "POST" && subpath.endsWith("/inputs")) {
      if (Number(req.headers.get("content-length") ?? 0) > MAX_INPUT_BYTES) {
        return Response.json({ detail: "the file is larger than 50 MB" }, { status: 413 });
      }
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ detail: "send one file in the 'file' field" }, { status: 400 });
      }
      const upstreamForm = new FormData();
      upstreamForm.append("file", file, file.name);
      const task = form.get("task");
      if (typeof task === "string" && task) upstreamForm.append("task", task.slice(0, 200));
      init = { method: "POST", body: upstreamForm };
    } else if (req.method === "POST") {
      init = {
        method: "POST",
        body: await req.text(),
        headers: { "Content-Type": "application/json" },
      };
    }
    const upstream = await apiCases(id, encoded, init);

    if (req.method !== "GET" && upstream.ok) {
      audit(auditEvent(req.method, subpath), {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "success",
        action: subpath || "create",
      });
    }
    if (upstream.status === 204) return new Response(null, { status: 204 });
    const type = upstream.headers.get("content-type") ?? "application/json";
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    });
  } catch (err) {
    logger.error({ traceId: getTraceId(), err, sessionId: id, subpath }, "case relay failed");
    return Response.json({ detail: "the wizard api did not answer" }, { status: 502 });
  }
}

export const GET = withLogging("case.get", relay);
export const POST = withLogging("case.post", relay);
export const DELETE = withLogging("case.delete", relay);
