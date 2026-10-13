// Dev/test only: move a mock session to a given step.
//
// Gathering (steps 1-3) has no UI affordance to advance — the agent moves the
// session on, and GatheringAdvanceButton only explains that. E2E specs running
// against the mock store therefore cannot click their way to a later phase, so
// they say where they want to be instead. Same DEV_AUTH gate as reset-mocks.

import { NextRequest } from "next/server";
import { DEV_AUTH } from "@/lib/auth";
import { setSessionStep } from "@/lib/mock-sessions";
import { withLogging } from "@/lib/with-logging";

export const dynamic = "force-dynamic";

export const POST = withLogging("dev.set-step", async (req: NextRequest) => {
  if (!DEV_AUTH) {
    return new Response("Forbidden", { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    step?: number;
  } | null;
  if (!body?.id || typeof body.step !== "number") {
    return new Response("id and step are required", { status: 400 });
  }
  const session = setSessionStep(body.id, body.step);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }
  return Response.json({ id: session.id, step: session.step });
});
