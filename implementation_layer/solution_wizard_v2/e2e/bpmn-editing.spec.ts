import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * The Workflow tab: the process steps beside the diagram, the view controls,
 * and what a canvas edit does (a rename saves itself, a structural edit waits
 * for "Tallenna muutokset", and nothing reaches the other tabs unsaved).
 */

const canvas = (page: Page) => page.locator(".bpmn-editable .djs-container");
const zoomLevel = async (page: Page) =>
  Number((await page.getByTestId("bpmn-zoom-level").innerText()).replace(/[^\d]/g, ""));

async function openFlow(page: Page, sessionId = "ses_laskut") {
  await loginAsDev(page);
  await page.goto(`/sessions/${sessionId}`);
  await page.getByRole("tab", { name: "Työnkulku" }).click();
}

async function waitForDiagram(page: Page) {
  await expect(page.locator('.bpmn-editable [data-element-id="Activity_classify"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".bpmn-editable")).toHaveAttribute("aria-busy", "false");
}

/** The chat references the page asks for, read back with `window.__refs`. */
async function recordChatReferences(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __refs: unknown[] };
    w.__refs = [];
    window.addEventListener("gaik-wizard:chat-reference", (e) => w.__refs.push((e as CustomEvent).detail));
  });
}
const chatReferences = (page: Page) =>
  page.evaluate(() => (window as unknown as { __refs: unknown[] }).__refs);

test.describe("Workflow tab", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("opens readable with one group of view controls, and a resize keeps the view the user chose", async ({
    page,
  }) => {
    await openFlow(page);
    await waitForDiagram(page);

    // One group: zoom out, the level, zoom in, fit. No mode pair, minimap, theme or save button.
    const controls = page.getByTestId("bpmn-zoom-controls");
    await expect(controls.getByRole("button")).toHaveCount(3);
    await expect(page.getByRole("button", { name: /Koko prosessi|Luettava/ })).toHaveCount(0);
    await expect(page.locator(".djs-minimap")).toHaveCount(0);
    await expect(page.getByTestId("bpmn-save")).toHaveCount(0);

    // The invoice process does not fit readably: it opens at the readable zoom, start event in view.
    await expect.poll(() => zoomLevel(page)).toBe(72);
    await expect(page.locator('.bpmn-editable [data-element-id^="StartEvent"]').first()).toBeInViewport();

    // "Sovita näkymään" shows all of it, inside the canvas.
    await controls.getByRole("button", { name: "Sovita näkymään" }).click();
    const fitted = await zoomLevel(page);
    expect(fitted).toBeLessThan(72);
    const box = (await canvas(page).boundingBox())!;
    for (const id of ["Activity_ingest", "Activity_export"]) {
      const shape = (await page.locator(`.bpmn-editable [data-element-id="${id}"]`).boundingBox())!;
      expect(shape.x).toBeGreaterThanOrEqual(box.x);
      expect(shape.x + shape.width).toBeLessThanOrEqual(box.x + box.width);
      expect(shape.y + shape.height).toBeLessThanOrEqual(box.y + box.height);
    }

    // A taller window fits again; a zoom the user picked stays through the next resize.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(fitted);
    await controls.getByRole("button", { name: "Lähennä" }).click();
    const picked = await zoomLevel(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(400);
    expect(await zoomLevel(page)).toBe(picked);
  });

  test("lists the process steps beside the diagram; a row and its task select each other", async ({ page }) => {
    await openFlow(page);
    await waitForDiagram(page);

    await expect(page.getByRole("heading", { name: "Prosessin vaiheet (5)" })).toBeVisible();
    const rows = page.getByTestId("flow-step-list").locator("li");
    await expect(rows).toHaveCount(5);
    // Names as the blueprint has them: the generator's "[LLM] " codes are not shown.
    await expect(rows.nth(2)).toContainText("Classification");
    await expect(canvas(page)).not.toContainText("[LLM]");
    await expect(canvas(page)).not.toContainText("[D]");

    // A row selects and centres its task.
    await rows.nth(4).getByRole("button").first().click();
    const task = page.locator('.bpmn-editable [data-element-id="Activity_export"]');
    await expect(task).toHaveClass(/selected/);
    await expect(rows.nth(4)).toHaveAttribute("data-selected", "true");
    const box = (await canvas(page).boundingBox())!;
    const shape = (await task.boundingBox())!;
    expect(Math.abs(shape.x + shape.width / 2 - (box.x + box.width / 2))).toBeLessThan(12);
    expect(Math.abs(shape.y + shape.height / 2 - (box.y + box.height / 2))).toBeLessThan(12);

    // The step's properties name its type in the Blueprint form's words.
    const props = page.getByTestId("bpmn-properties");
    await expect(props).toContainText("Vaihe 5");
    await expect(props).toContainText("Syöte tai tulos");

    // Selecting a task on the canvas marks its row.
    await rows.nth(2).getByRole("button").first().click();
    await expect(rows.nth(2)).toHaveAttribute("data-selected", "true");
    await expect(rows.nth(4)).not.toHaveAttribute("data-selected", "true");
  });

  test("a rename in the name field saves by itself and reaches the other tabs only once saved", async ({ page }) => {
    // A save lints, syncs and regenerates the diagram in child processes.
    test.setTimeout(120_000);
    await openFlow(page);
    await waitForDiagram(page);
    const rows = page.getByTestId("flow-step-list").locator("li");
    await rows.nth(2).getByRole("button").first().click();

    const name = page.getByTestId("bpmn-property-name");
    await expect(name).toHaveValue("Classification");
    const sync = page.waitForResponse((r) => r.url().includes("/bpmn/sync") && r.request().method() === "POST");
    await name.fill("Cost centre proposal");

    // While it is only typed, the list still has the saved name.
    await expect(rows.nth(2)).toContainText("Classification");
    expect((await sync).status()).toBe(200);

    await expect(page.getByTestId("bpmn-status")).toContainText("Tallennettu");
    await expect(rows.nth(2)).toContainText("Cost centre proposal");
    // The field keeps the cursor and the text through the save.
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Cost centre proposal");
    await expect(page.getByTestId("bpmn-save")).toHaveCount(0);

    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.getByTestId("blueprint-json-toggle").click();
    const saved = JSON.parse(await page.getByTestId("blueprint-json-editor").inputValue()) as {
      steps: { id: string; name: string }[];
    };
    expect(saved.steps.map((s) => s.name)).toEqual([
      "Invoice intake",
      "Data extraction",
      "Cost centre proposal",
      "Approval",
      "Export to finance system",
    ]);
  });

  test("a structural edit waits for Tallenna muutokset and survives a visit to another tab", async ({ page }) => {
    test.setTimeout(120_000);
    await openFlow(page);
    await waitForDiagram(page);
    const rows = page.getByTestId("flow-step-list").locator("li");

    // Delete the Approval step from the context pad.
    await rows.nth(3).getByRole("button").first().click();
    await page.locator('.djs-context-pad .entry[data-action="delete"]').click();
    const status = page.getByTestId("bpmn-status");
    await expect(status).toContainText("Muutoksia ei ole tallennettu");
    const save = page.getByTestId("bpmn-save");
    await expect(save).toHaveText("Tallenna muutokset");

    // Nothing is saved or shown elsewhere yet.
    await expect(rows).toHaveCount(5);
    await page.getByRole("tab", { name: "Blueprint" }).click();
    await expect(page.locator("ol > li[data-testid^='blueprint-step-']")).toHaveCount(5);

    // Back on the tab the unsaved edit is still on the canvas.
    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await expect(page.getByTestId("bpmn-save")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.bpmn-editable [data-element-id="Activity_approve"]')).toHaveCount(0);

    const sync = page.waitForResponse((r) => r.url().includes("/bpmn/sync") && r.request().method() === "POST");
    await page.getByTestId("bpmn-save").click();
    expect((await sync).status()).toBe(200);
    await expect(page.getByTestId("bpmn-status")).toContainText("Tallennettu", { timeout: 15_000 });
    await expect(page.getByTestId("bpmn-save")).toHaveCount(0);
    await expect(page.getByTestId("flow-step-list").locator("li")).toHaveCount(4);
    await expect(page.getByRole("heading", { name: "Prosessin vaiheet (4)" })).toBeVisible();
  });

  test("the palette offers only what a save keeps", async ({ page }) => {
    await openFlow(page);
    await waitForDiagram(page);
    const entries = page.locator(".bpmn-editable .djs-palette .entry");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toHaveAttribute("title", /^Lisää tehtävä/);
    await expect(entries.nth(1)).toHaveAttribute("title", /^Yhdistä/);

    // The context pad of a task: rename and delete, nothing else.
    await page.getByTestId("flow-step-list").locator("li").nth(1).getByRole("button").first().click();
    const pad = page.locator(".djs-context-pad .entry");
    await expect(pad).toHaveCount(2);
    await expect(pad.nth(0)).toHaveAttribute("title", "Nimeä uudelleen");
    await expect(pad.nth(1)).toHaveAttribute("title", "Poista");
  });

  test("Muuta chatissa on a step row and in the properties opens the chat with that step", async ({ page }) => {
    await openFlow(page);
    await waitForDiagram(page);
    await recordChatReferences(page);

    await page.getByRole("button", { name: "Pyydä wizardia muuttamaan vaihetta Classification" }).click();
    const reference = {
      key: "step:classify",
      label: "Vaihe 3 · Classification",
      prefix: 'Koskee prosessin vaihetta 3 (id classify), lainattuna: "Classification"',
    };
    expect(await chatReferences(page)).toEqual([reference]);

    await page.getByTestId("flow-step-list").locator("li").nth(2).getByRole("button").first().click();
    await page.getByTestId("bpmn-ask-step").click();
    expect(await chatReferences(page)).toEqual([reference, reference]);
  });

  test("shows the steps with a retry when the diagram cannot be loaded", async ({ page }) => {
    let fail = true;
    await page.route("**/api/sessions/ses_laskut/bpmn", (route) =>
      fail ? route.fulfill({ status: 500, body: "no diagram" }) : route.continue(),
    );
    await openFlow(page);

    const error = page.getByTestId("flow-diagram-error");
    await expect(error).toContainText("Kaaviota ei saatu ladattua.");
    await expect(page.getByTestId("flow-step-list").locator("li")).toHaveCount(5);

    fail = false;
    await error.getByRole("button", { name: "Yritä uudelleen" }).click();
    await waitForDiagram(page);
    await expect(error).toHaveCount(0);
  });

  test("on a phone opens on the list, and the diagram has no palette", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFlow(page);

    await expect(page.getByTestId("flow-view-list")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("flow-step-list")).toBeVisible();

    await page.getByTestId("flow-view-diagram").click();
    await waitForDiagram(page);
    await expect(page.getByTestId("flow-step-list")).toBeHidden();
    await expect(page.locator(".bpmn-editable .djs-palette")).toBeHidden();
    await expect(page.getByTestId("bpmn-zoom-controls")).toBeInViewport();

    // A row takes the user to its task on the diagram.
    await page.getByTestId("flow-view-list").click();
    await page.getByTestId("flow-step-list").locator("li").nth(0).getByRole("button").first().click();
    await expect(page.getByTestId("flow-view-diagram")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('.bpmn-editable [data-element-id="Activity_ingest"]')).toHaveClass(/selected/);
  });
});
