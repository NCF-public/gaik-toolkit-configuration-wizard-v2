import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

// A step action is a server action: on a busy dev server it takes a few seconds.
const AFTER_ACTION = { timeout: 20_000 };

/**
 * Cross-cutting UI behaviour that had no e2e coverage at all: locale
 * switching, where the "Edellinen" (previous) and "Seuraava vaihe" (next)
 * controls exist, the Specification step, markdown rendering in assistant chat
 * messages, and the sign-in page saying the wizard is an AI assistant.
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

  test("the workspace says its tabs show AI output", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");
    await expect(page.getByTestId("workspace-ai-mark")).toHaveText(
      "Ratkaisun, kaavion ja paketin on tuottanut tekoäly. Tarkista ne ennen käyttöä.",
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

  test("after Gate 1 there is no previous button, and next step moves on", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");

    await expect(page.getByText("VAIHE 6 / 13")).toBeVisible();
    await expect(page.getByTestId("workspace-phase")).toHaveText("Komponenttivalinta");
    // What to do now is one line under the title.
    await expect(page.getByTestId("now-line")).toContainText(
      "Wizard valitsee kullekin vaiheelle komponentin ja perustelee valinnan chatissa.",
    );

    // From step 5 on every step shows the same workspace, so a step back would
    // change nothing the user sees: the button is gone, not disabled.
    await expect(page.getByRole("button", { name: "Edellinen" })).toHaveCount(0);

    await page.getByRole("button", { name: "Seuraava vaihe" }).click();

    await expect(page.getByText("VAIHE 7 / 13")).toBeVisible(AFTER_ACTION);
    await expect(page.getByTestId("workspace-phase")).toHaveText("Blueprint-kokoaminen");
    await expect(page.getByRole("button", { name: "Edellinen" })).toHaveCount(0);
  });

  test("the first step has neither a previous nor a next button", async ({ page }) => {
    await loginAsDev(page);
    const title = `regress-guard ${Date.now()}`;
    await page.locator("#session-title").fill(title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    await expect(page.getByText("VAIHE 1 / 13")).toBeVisible();
    // Gathering moves on when the wizard has the requirements, so there is no
    // "next step" to press, and nothing before the first step.
    await expect(page.getByRole("button", { name: "Edellinen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Seuraava vaihe" })).toHaveCount(0);
  });

  test("previous steps back through requirements gathering, to the field schema first", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");
    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 1: vaatimukset");

    await page.getByRole("button", { name: "Edellinen" }).click();

    await expect(page.getByText("VAIHE 3 / 13")).toBeVisible(AFTER_ACTION);
    await expect(page.getByRole("heading", { name: "Poimittavat kentät" })).toBeVisible();

    await page.getByRole("button", { name: "Edellinen" }).click();

    await expect(page.getByText("VAIHE 2 / 13")).toBeVisible(AFTER_ACTION);
    await expect(page.getByTestId("workspace-phase")).toHaveText("Vaatimusten keruu");
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
