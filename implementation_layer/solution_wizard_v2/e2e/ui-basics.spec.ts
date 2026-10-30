import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Cross-cutting UI behaviour that had no e2e coverage at all: locale
 * switching, the "Edellinen" (previous/regress) control, the Specification
 * step, markdown rendering in assistant chat messages, and the sign-in page
 * saying the wizard is an AI assistant.
 */
test.describe("UI basics", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("the sign-in page says the wizard is an AI assistant", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-ai-notice")).toHaveText(
      "Wizard on tekoälyavustaja: sen vastaukset ja tuottamat luonnokset ovat tekoälyn tuottamia.",
    );
  });

  test("locale switcher changes the visible language", async ({ page }) => {
    await loginAsDev(page);
    await expect(page.getByRole("heading", { name: "Wizard-sessiot" })).toBeVisible();

    // Scoped by the LocaleSwitcher form's own button value — "EN"/"FI" role
    // lookups are ambiguous against Next.js's dev-tools button in dev mode.
    await page.locator('button[name="locale"][value="en"]').click();
    await expect(page.getByRole("heading", { name: "Wizard sessions" })).toBeVisible();

    // Switching back is symmetric.
    await page.locator('button[name="locale"][value="fi"]').click();
    await expect(page.getByRole("heading", { name: "Wizard-sessiot" })).toBeVisible();
  });

  test("previous button regresses one step", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");

    await expect(page.getByText("VAIHE 6 / 13")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Komponenttivalinta" })).toBeVisible();

    await page.getByRole("button", { name: "Edellinen" }).click();

    await expect(page.getByText("VAIHE 5 / 13")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Skeeman suunnittelu" })).toBeVisible();
  });

  test("previous button is disabled at step 1", async ({ page }) => {
    await loginAsDev(page);
    const title = `regress-guard ${Date.now()}`;
    await page.locator("#session-title").fill(title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    await expect(page.getByRole("button", { name: "Edellinen" })).toBeDisabled();
  });

  test("Specification step renders the field schema", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");
    await expect(page.getByRole("heading", { name: "Gate 1", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Edellinen" }).click();

    await expect(page.getByText("VAIHE 3 / 13")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Poimittavat kentät" })).toBeVisible();
  });

  test("assistant messages render markdown as HTML, not raw syntax", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");

    const chatLog = page.getByRole("log");
    // Bold, list item, and inline code all present as real elements.
    await expect(chatLog.locator("strong", { hasText: "Component A" })).toBeVisible();
    await expect(chatLog.locator("li", { hasText: "Component B" })).toBeVisible();
    await expect(chatLog.locator("code", { hasText: "lookup(id)" })).toBeVisible();

    // The raw markdown characters must not leak through as visible text.
    await expect(chatLog.getByText("**Component A**")).toHaveCount(0);
  });
});
