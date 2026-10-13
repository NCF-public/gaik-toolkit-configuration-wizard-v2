import { test, expect } from "@playwright/test";
import { DEV_USERS, loginAsDev, signOutDev } from "./helpers/auth";
import {
  listApiSessions,
  restartWizardApi,
  waitForApiHealthy,
} from "./helpers/api";

const STACK_E2E = process.env.PLAYWRIGHT_STACK_E2E === "true";

/**
 * US-S1-01 — full stack: UI + wizard_api + Postgres.
 * Run via Docker: ./scripts/docker-test.sh --step stack-e2e
 */
test.describe("US-S1-01 Postgres persistence (Docker stack)", () => {
  test.skip(!STACK_E2E, "set PLAYWRIGHT_STACK_E2E=true (docker-test.sh --step stack-e2e)");

  test.beforeAll(async ({ request }) => {
    await waitForApiHealthy(request);
  });

  test("both users keep sessions after wizard-api restart", async ({ page, request }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const user1Title = `Stack user1 ${stamp}`;
    const user2Title = `Stack user2 ${stamp}`;

    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(user1Title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);
    const user1Path = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await expect(page.getByText("VAIHE 2 / 13")).toBeVisible();

    await signOutDev(page);
    await loginAsDev(page, DEV_USERS.secondary);
    await page.locator("#session-title").fill(user2Title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    const user1Api = await listApiSessions(request, DEV_USERS.primary.email);
    const user2Api = await listApiSessions(request, DEV_USERS.secondary.email);
    expect(user1Api.some((s) => s.title?.includes(String(stamp)) && s.step === 2)).toBe(true);
    expect(user2Api.some((s) => s.title?.includes(String(stamp)))).toBe(true);

    await restartWizardApi(request);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Wizard-sessiot" })).toBeVisible();

    await signOutDev(page);
    await loginAsDev(page, DEV_USERS.primary);
    await expect(page.getByRole("link", { name: user1Title })).toBeVisible();
    await expect(page.getByRole("link", { name: user2Title })).toHaveCount(0);

    await page.goto(user1Path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("VAIHE 2 / 13")).toBeVisible();

    await signOutDev(page);
    await loginAsDev(page, DEV_USERS.secondary);
    await expect(page.getByRole("link", { name: user2Title })).toBeVisible();
    await expect(page.getByRole("link", { name: user1Title })).toHaveCount(0);

    const blocked = await page.goto(user1Path, { waitUntil: "domcontentloaded" });
    expect(blocked?.status()).toBe(404);
  });
});
