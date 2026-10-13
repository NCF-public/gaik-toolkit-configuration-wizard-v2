import type { APIRequestContext } from "@playwright/test";

/** Reset in-memory mock sessions between E2E tests (dev auth only). */
export async function resetMockSessions(request: APIRequestContext) {
  const res = await request.post("/api/dev/reset-mocks");
  if (!res.ok()) {
    throw new Error(`reset-mocks failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { ok?: boolean };
  if (!body.ok) {
    throw new Error("reset-mocks returned unexpected body");
  }
}
