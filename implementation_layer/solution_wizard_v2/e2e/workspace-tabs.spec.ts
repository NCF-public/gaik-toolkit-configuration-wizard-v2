import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import { setMockSessionStep } from "./helpers/dev-step";
import { selectWorkspaceTab } from "./helpers/workspace";

/**
 * The workspace has three tabs in the wizard's order: Blueprint, Työnkulku and
 * PoC. Blueprint opens as a read view (the former Suunnitelma tab) with the
 * form behind "Muokkaa"; Työnkulku is there only once the diagram exists; the
 * PoC is locked until Gate 2 is approved; and a session opens on the tab of
 * its phase. Mock store: ses_ui_basics and ses_chatbot stand at step 6,
 * ses_gate2_pending at step 9 and ses_laskut at step 11; of these only
 * ses_chatbot and ses_laskut get a diagram (lib/bpmn-spike.ts).
 */

const selected = (page: Page) => page.getByRole("tab", { selected: true });

test.describe("Workspace tabs", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("before the diagram exists there are two tabs, and no hint line under them", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");

    await expect(page.getByRole("tab")).toHaveText([/Blueprint/, /PoC/]);
    await expect(selected(page)).toHaveText(/Blueprint/);
    await expect(page.getByRole("tab", { name: "Suunnitelma" })).toHaveCount(0);
    await expect(page.getByText("Ratkaisun rakenne muokattavana lomakkeena")).toHaveCount(0);
  });

  test("a session opens on the tab of its phase, and that tab carries the now mark", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginAsDev(page);

    // Step 6: the blueprint.
    await page.goto("/sessions/ses_ui_basics");
    await expect(selected(page)).toHaveText(/Blueprint/);
    await expect(page.getByRole("tab", { name: "Blueprint" }).getByTestId("tab-now")).toHaveCount(1);
    await expect(page.getByTestId("tab-now")).toHaveCount(1);

    // Step 8: the diagram exists, and it is what the phase is about.
    await setMockSessionStep(request, baseURL as string, "ses_chatbot", 8);
    await page.goto("/sessions/ses_chatbot");
    await expect(page.getByRole("tab")).toHaveText([/Blueprint/, /Työnkulku/, /PoC/]);
    await expect(selected(page)).toHaveText(/Työnkulku/);
    await expect(page.getByRole("tab", { name: "Työnkulku" }).getByTestId("tab-now")).toHaveCount(1);

    // Step 11 (Gate 3): the test run, not the diagram.
    await page.goto("/sessions/ses_laskut");
    await expect(selected(page)).toHaveText(/PoC/);
    await expect(page.getByRole("tab", { name: "PoC" })).toHaveAccessibleName(/Nyt/);
  });

  test("a ?tab= in the address wins over the phase", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending?tab=poc");

    await expect(selected(page)).toHaveText(/PoC/);
    // The phase's own tab still carries the mark. This session has no
    // diagram, so at Gate 2 that is Blueprint.
    await expect(page.getByRole("tab")).toHaveText([/Blueprint/, /PoC/]);
    await expect(page.getByRole("tab", { name: "Blueprint" }).getByTestId("tab-now")).toHaveCount(1);
    await expect(page.getByTestId("tab-now")).toHaveCount(1);
  });

  test("reaching the diagram step adds Työnkulku and moves to it", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");
    // The user is looking at something else when the step moves.
    await selectWorkspaceTab(page, "PoC");

    await page.getByRole("button", { name: "Seuraava vaihe" }).click();
    await expect(page.getByRole("heading", { name: "Blueprint-kokoaminen" })).toBeVisible();
    await expect(selected(page)).toHaveText(/PoC/);

    await page.getByRole("button", { name: "Seuraava vaihe" }).click();
    await expect(page.getByRole("tab")).toHaveText([/Blueprint/, /Työnkulku/, /PoC/]);
    await expect(selected(page)).toHaveText(/Työnkulku/);
  });

  test("Blueprint opens as a read view: a card per step, details behind a disclosure", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");

    const plan = page.getByTestId("solution-plan-view");
    await expect(plan).toBeVisible();
    await expect(plan.getByTestId(/^plan-step-\d+$/)).toHaveCount(5);
    await expect(plan).not.toContainText("SME-5");
    await expect(plan).not.toContainText("Ei asetuksia");

    // A step with a component and settings keeps them folded away.
    const rag = page.getByTestId("plan-step-1");
    await expect(rag.getByRole("heading", { name: "Retrieval (RAG)" })).toBeVisible();
    await expect(rag).toContainText("Tekoäly");
    await expect(rag).toContainText("Fetch relevant help articles");
    await expect(rag.getByText("pgvector")).toBeHidden();
    await rag.getByText("Komponentti ja asetukset").click();
    await expect(rag.getByText("pgvector")).toBeVisible();
    await expect(rag.getByText("top_k")).toBeVisible();

    // A step with neither has no disclosure at all.
    await expect(page.getByTestId("plan-step-0").locator("details")).toHaveCount(0);
  });

  test("Muokkaa opens the form and Valmis returns to the read view", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");

    const plan = page.getByTestId("solution-plan-view");
    const edit = page.getByTestId("blueprint-edit");
    const done = page.getByTestId("blueprint-done");
    await expect(plan).toBeVisible();
    await expect(page.getByTestId("blueprint-step-add")).toHaveCount(0);
    // Before Gate 2 an edit costs nothing yet, so the button says nothing more.
    await expect(page.getByTestId("blueprint-edit-note")).toHaveCount(0);

    await expect(async () => {
      if (!(await done.isVisible())) await edit.click({ timeout: 1_000 });
      await expect(done).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByTestId("blueprint-step-add")).toBeVisible();
    await expect(plan).toBeHidden();
    await expect(done).toBeFocused();

    await done.click();
    await expect(plan).toBeVisible();
    await expect(page.getByTestId("blueprint-step-add")).toBeHidden();
    await expect(edit).toBeFocused();
  });

  test("after Gate 2 the edit button says what a change costs", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");
    await selectWorkspaceTab(page, "Blueprint");

    await expect(page.getByTestId("blueprint-edit-note")).toHaveText("Muutos vaatii uuden paketin ja testiajon");
    await expect(page.getByTestId("blueprint-edit")).toHaveAccessibleDescription(
      "Muutos vaatii uuden paketin ja testiajon",
    );
  });

  test("a step card's chat button opens the chat with a reference to that step", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");
    await expect(page.getByTestId("solution-plan-view")).toBeVisible();

    // The chat side is built on another branch: here only the event is checked.
    await page.evaluate(() => {
      const w = window as unknown as { __refs: unknown[] };
      w.__refs = [];
      window.addEventListener("gaik-wizard:chat-reference", (e) => w.__refs.push((e as CustomEvent).detail));
    });
    const ask = page.getByRole("button", { name: "Muuta chatissa: Vaihe 2 · Retrieval (RAG)" });
    await expect(async () => {
      await ask.click();
      expect(await page.evaluate(() => (window as unknown as { __refs: unknown[] }).__refs.length)).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    const refs = await page.evaluate(() => (window as unknown as { __refs: unknown[] }).__refs);
    expect(refs[0]).toEqual({
      key: "step:retrieve",
      label: "Vaihe 2 · Retrieval (RAG)",
      prefix: 'Koskee prosessin vaihetta 2 (id retrieve), lainattuna: "Retrieval (RAG)"',
    });
  });

  test("the PoC is locked before Gate 2: one line, no generate button, no package request", async ({ page }) => {
    const pocRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/poc/")) pocRequests.push(r.url());
    });
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");
    await selectWorkspaceTab(page, "PoC");

    await expect(page.getByRole("tab", { name: "PoC" })).toHaveAccessibleName(/lukittu/);
    await expect(page.getByTestId("poc-locked")).toHaveText("Testaus avautuu, kun Gate 2 on hyväksytty.");
    await expect(page.getByRole("button", { name: /Generoi/ })).toHaveCount(0);
    await expect(page.getByTestId("poc-run-sandbox")).toHaveCount(0);
    expect(pocRequests).toEqual([]);
  });

  test("a tab is selected from the keyboard, and only its panel is exposed", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");
    const blueprint = page.getByRole("tab", { name: "Blueprint" });

    await expect(async () => {
      await blueprint.focus();
      await page.keyboard.press("Enter");
      await expect(blueprint).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.getByRole("tabpanel")).toHaveAccessibleName(/Blueprint/);
  });
});

test.describe("Workspace tabs on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("the three tabs fit, and the selected one is on screen", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");
    await expect(selected(page)).toHaveText(/PoC/);

    const box = (await selected(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const list = await page.getByRole("tablist").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(list.sw).toBeLessThanOrEqual(list.cw);
    const doc = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(doc.sw).toBeLessThanOrEqual(doc.cw);
  });
});
