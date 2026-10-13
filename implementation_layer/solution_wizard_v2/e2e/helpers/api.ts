import type { APIRequestContext } from "@playwright/test";

export function getWizardApiUrl(): string {
  const url = process.env.WIZARD_API_URL?.trim();
  if (!url) {
    throw new Error("WIZARD_API_URL is required for stack E2E");
  }
  return url.replace(/\/$/, "");
}

export async function waitForApiHealthy(
  request: APIRequestContext,
  timeoutMs = 60_000,
): Promise<void> {
  const base = getWizardApiUrl();
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";

  while (Date.now() < deadline) {
    try {
      const res = await request.get(`${base}/health`);
      if (res.ok()) return;
      lastError = `${res.status()} ${await res.text()}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(`wizard_api did not become healthy: ${lastError}`);
}

/** Simulates API process restart (Docker restart policy + test hook). */
export async function restartWizardApi(request: APIRequestContext): Promise<void> {
  const base = getWizardApiUrl();
  try {
    await request.post(`${base}/test/shutdown`, { timeout: 5_000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const expected =
      message.includes("socket hang up") ||
      message.includes("ECONNRESET") ||
      message.includes("ECONNREFUSED") ||
      message.includes("Timeout");
    if (!expected) throw err;
  }
  await waitForApiHealthy(request);
}

/**
 * Move a session to a given step through the API.
 *
 * During gathering (steps 1–3) the UI deliberately does not advance on the
 * "Seuraava vaihe →" button — `GatheringAdvanceButton` only explains that the
 * wizard advances on its own once the agent has collected the requirements.
 * A stack test that needs a session at a later step therefore has to say so
 * through the API instead of clicking.
 */
export async function setApiSessionStep(
  request: APIRequestContext,
  sessionId: string,
  step: number,
): Promise<void> {
  const base = getWizardApiUrl();
  const res = await request.patch(`${base}/sessions/${sessionId}`, { data: { step } });
  if (!res.ok()) {
    throw new Error(`set step failed: ${res.status()} ${await res.text()}`);
  }
}

export type ApiSessionSummary = {
  id: string;
  step: number;
  title: string | null;
};

function summaryTitle(metadata: Record<string, unknown> | undefined): string | null {
  const title = metadata?.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

export async function listApiSessions(
  request: APIRequestContext,
  userId: string,
): Promise<ApiSessionSummary[]> {
  const base = getWizardApiUrl();
  const res = await request.get(`${base}/sessions`, { params: { user_id: userId } });
  if (!res.ok()) {
    throw new Error(`list sessions failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    sessions: { id: string; step: number; metadata?: Record<string, unknown> }[];
  };
  return body.sessions.map((s) => ({
    id: s.id,
    step: s.step,
    title: summaryTitle(s.metadata),
  }));
}
