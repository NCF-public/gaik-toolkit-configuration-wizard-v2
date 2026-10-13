import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";

test.describe("Session list and access", () => {
  test("creates a new session from the home page", async ({ page }) => {
    await loginAsDev(page);

    await expect(page.getByRole("heading", { name: "Wizard-sessiot" })).toBeVisible();

    const title = `E2E sessio ${Date.now()}`;
    await page.locator("#session-title").fill(title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();

    await page.waitForURL(/\/sessions\//);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  });

  test("returns not found for unknown session id", async ({ page }) => {
    await loginAsDev(page);
    const response = await page.goto("/sessions/ses_nonexistent_e2e");
    expect(response?.status()).toBe(404);
  });

  test("seeded chatbot session is reachable for dev user", async ({ page }) => {
    await loginAsDev(page);
    await page.getByRole("link", { name: "Asiakaspalvelun chatbot" }).click();
    await expect(page.getByRole("heading", { name: "Asiakaspalvelun chatbot", level: 1 })).toBeVisible();
  });
});
