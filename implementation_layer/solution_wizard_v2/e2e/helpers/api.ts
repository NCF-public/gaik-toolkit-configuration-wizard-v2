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
