import { type APIRequestContext, expect } from "@playwright/test";

/**
 * Move a mock session to `step` through the dev-only route.
 *
 * Gathering (steps 1-3) has no "Seuraava vaihe" button: the agent advances
 * the session once the requirements are collected. Specs that need a later
 * phase say so here.
 */
export async function setMockSessionStep(
  request: APIRequestContext,
  baseURL: string,
  sessionId: string,
  step: number,
  /** A run id to record as the session's successful test run (the mock has no sandbox). */
  successfulRun?: string,
): Promise<void> {
  const res = await request.post(`${baseURL}/api/dev/set-step`, {
    data: { id: sessionId, step, ...(successfulRun ? { successfulRun } : {}) },
  });
  expect(res.ok(), `set-step failed: ${res.status()} ${await res.text()}`).toBe(true);
}
