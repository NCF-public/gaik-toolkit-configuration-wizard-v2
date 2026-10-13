import { test, expect } from "@playwright/test";
import { DEV_USERS, loginAsDev, signOutDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * US-S1-01: per-user session list and access control (dev auth, mock or API store).
 */
test.describe("US-S1-01 session isolation", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("each user sees only their own sessions", async ({ page }) => {
    const user1Title = `User1 private ${Date.now()}`;
    const user2Title = `User2 private ${Date.now()}`;

    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(user1Title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);
    const user1Url = page.url();

    await signOutDev(page);
    await loginAsDev(page, DEV_USERS.secondary);

    await expect(page.getByRole("heading", { name: "Wizard-sessiot" })).toBeVisible();
    await expect(page.getByRole("link", { name: user1Title })).toHaveCount(0);

    const blocked = await page.goto(user1Url);
    expect(blocked?.status()).toBe(404);

    await page.goto("/");
    await page.locator("#session-title").fill(user2Title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    await signOutDev(page);
    await loginAsDev(page, DEV_USERS.primary);

    await expect(page.getByRole("link", { name: user1Title })).toBeVisible();
    await expect(page.getByRole("link", { name: user2Title })).toHaveCount(0);
  });

  test("secondary user has no seeded sessions from primary owner", async ({ page }) => {
    await loginAsDev(page, DEV_USERS.secondary);
    await expect(page.getByRole("link", { name: "Asiakaspalvelun chatbot" })).toHaveCount(0);
  });

  test("session progress survives reload for the owning user", async ({ page }) => {
    const title = `Persist ${Date.now()}`;
    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await expect(page.getByText("VAIHE 2 / 13")).toBeVisible();

    await page.reload();
    await expect(page.getByText("VAIHE 2 / 13")).toBeVisible();
  });
});
