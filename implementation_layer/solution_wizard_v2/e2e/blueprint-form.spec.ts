import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import { openBlueprintEditor } from "./helpers/workspace";

/**
 * The Blueprint form: it saves by itself, says where the draft stands, lists
 * the process steps so they read as the process, and lets a deleted step be
 * brought back.
 */

const status = (page: Page) => page.getByTestId("blueprint-save-status");
const rows = (page: Page) => page.locator("ol > li[data-testid^='blueprint-step-']");
const blueprintPatch = (page: Page) =>
  page.waitForResponse((r) => /\/api\/sessions\/[^/]+\/blueprint$/.test(r.url()) && r.request().method() === "PATCH");

async function openForm(page: Page, sessionId: string) {
  await loginAsDev(page);
  await page.goto(`/sessions/${sessionId}`);
  // The tab opens in its read view; the form is behind "Muokkaa".
  await openBlueprintEditor(page);
  await expect(status(page)).toHaveAttribute("data-state", "saved");
}

test.describe("Blueprint form", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("saves by itself after an edit and has no save button", async ({ page }) => {
    await openForm(page, "ses_ui_basics");
    await expect(status(page)).toHaveText("Tallennettu");
    await expect(page.getByTestId("blueprint-save")).toHaveCount(0);

    await page.getByTestId("blueprint-step-0-toggle").click();
    const saved = blueprintPatch(page);
    await page.getByTestId("blueprint-step-0-name").fill("Intake of documents");
    const body = (await saved).request().postDataJSON() as { content: { steps: { name: string }[] } };
    expect(body.content.steps.map((s) => s.name)).toEqual(["Intake of documents", "Process"]);
    await expect(status(page)).toHaveText("Tallennettu");
    // What was typed stays in the field, and the card stays open.
    await expect(page.getByTestId("blueprint-step-0-name")).toHaveValue("Intake of documents");

    // The saved blueprint is what a reload shows.
    await page.reload();
    await openBlueprintEditor(page);
    await expect(rows(page).first()).toHaveAttribute("aria-label", "1. Intake of documents");
  });

  test("leaving a field saves at once", async ({ page }) => {
    await openForm(page, "ses_ui_basics");
    const goal = page.getByTestId("blueprint-field-goal");
    await goal.fill("Shorter handling time");
    const saved = blueprintPatch(page);
    const sent = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith("/blueprint"));
    const before = Date.now();
    await page.getByTestId("blueprint-field-name").focus();
    await sent;
    // Sent on leaving the field, not after the wait that follows typing (1.2 s).
    expect(Date.now() - before).toBeLessThan(900);
    await saved;
    await expect(status(page)).toHaveText("Tallennettu");
  });

  test("holds the save while a step has no name, and says why", async ({ page }) => {
    await openForm(page, "ses_ui_basics");
    let patches = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().endsWith("/blueprint")) patches += 1;
    });

    await page.getByTestId("blueprint-step-add").click();
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByTestId("blueprint-steps-heading")).toHaveText("Prosessin vaiheet (3)");
    // The new step's name field has the cursor.
    await expect(page.getByTestId("blueprint-step-2-name")).toBeFocused();
    await expect(status(page)).toHaveText("Ei tallennettu: anna vaiheelle nimi");
    await page.waitForTimeout(1800);
    expect(patches).toBe(0);

    const saved = blueprintPatch(page);
    await page.getByTestId("blueprint-step-2-name").fill("Review");
    await saved;
    await expect(status(page)).toHaveText("Tallennettu");
    expect(patches).toBe(1);
  });

  test("a deleted step can be brought back while the note is shown", async ({ page }) => {
    await openForm(page, "ses_laskut");
    await expect(rows(page)).toHaveCount(5);

    await page.getByTestId("blueprint-step-1-remove").click();
    await expect(rows(page)).toHaveCount(4);
    const note = page.getByTestId("blueprint-step-removed");
    await expect(note).toContainText("Vaihe poistettu");
    await note.getByRole("button", { name: "Kumoa" }).click();
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).nth(1)).toHaveAttribute("aria-label", "2. Data extraction");
    await expect(note).toHaveCount(0);

    // Left alone, the note goes away after five seconds and the step stays deleted.
    await page.getByTestId("blueprint-step-1-remove").click();
    await expect(note).toBeVisible();
    await expect(note).toHaveCount(0, { timeout: 8_000 });
    await expect(rows(page)).toHaveCount(4);
    await expect(status(page)).toHaveText("Tallennettu", { timeout: 10_000 });
  });

  test("a step row reads as the process, and the technical details stay closed", async ({ page }) => {
    await openForm(page, "ses_laskut");
    await expect(page.getByTestId("blueprint-steps-heading")).toHaveText("Prosessin vaiheet (5)");

    // Number, name, type and description; no component code.
    const row = rows(page).nth(1);
    const toggle = page.getByTestId("blueprint-step-1-toggle");
    await expect(toggle).toContainText("2");
    await expect(toggle).toContainText("Data extraction");
    await expect(toggle).toContainText("Tekoäly");
    await expect(toggle).toContainText("Extract amounts, supplier, references");
    await expect(row).not.toContainText("docling");
    // The number sits on a full circle in the type's colour.
    const badge = toggle.locator("span[aria-hidden='true']").first();
    await expect(badge).toHaveCSS("border-left-width", "0px");
    await expect(badge).toHaveCSS("background-color", "rgb(138, 35, 135)");

    await toggle.click();
    await expect(page.getByTestId("blueprint-step-1-name")).toBeVisible();
    await expect(page.getByTestId("blueprint-step-1-description")).toBeVisible();
    await expect(page.getByTestId("blueprint-step-1-component")).toBeHidden();
    await expect(row).not.toContainText("SME");

    // Type is a choice of three, with the same words as the row.
    const saved = blueprintPatch(page);
    await page.getByTestId("blueprint-step-1-type").getByText("Ihmisen tarkistus").click();
    await saved;
    await expect(toggle).toContainText("Ihmisen tarkistus");
    await expect(badge).toHaveCSS("background-color", "rgb(180, 84, 26)");

    await page.getByTestId("blueprint-step-1-tech").click();
    await expect(page.getByTestId("blueprint-step-1-component")).toHaveValue("docling");
  });

  test("Muuta chatissa on a step row opens the chat with that step", async ({ page }) => {
    await openForm(page, "ses_laskut");
    await page.evaluate(() => {
      const w = window as unknown as { __refs: unknown[] };
      w.__refs = [];
      window.addEventListener("gaik-wizard:chat-reference", (e) => w.__refs.push((e as CustomEvent).detail));
    });

    await page.getByTestId("blueprint-step-3-ask").click();
    expect(await page.evaluate(() => (window as unknown as { __refs: unknown[] }).__refs)).toEqual([
      {
        key: "step:approve",
        label: "Vaihe 4 · Approval",
        prefix: 'Koskee prosessin vaihetta 4 (id approve), lainattuna: "Approval"',
      },
    ]);
    await expect(page.getByTestId("blueprint-step-3-ask")).toHaveAttribute(
      "aria-label",
      "Pyydä wizardia muuttamaan vaihetta Approval",
    );

    // A step that is not saved yet has nothing to ask about.
    await page.getByTestId("blueprint-step-add").click();
    await expect(page.getByTestId("blueprint-step-5-ask")).toHaveCount(0);
  });

  test("asks which version stays when the blueprint changes under an unsaved draft", async ({ page }) => {
    // The Workflow tab's save lints, syncs and regenerates the diagram in child processes.
    test.setTimeout(150_000);
    await openForm(page, "ses_laskut");

    // An unsaved draft: a step without a name is not saved.
    await page.getByTestId("blueprint-step-0-toggle").click();
    await page.getByTestId("blueprint-step-0-name").fill("");
    await expect(status(page)).toHaveText("Ei tallennettu: anna vaiheelle nimi");

    // Meanwhile the diagram saves a rename of another step.
    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await expect(page.locator(".bpmn-editable")).toHaveAttribute("aria-busy", "false", { timeout: 45_000 });
    await page.getByTestId("flow-step-list").locator("li").nth(4).getByRole("button").first().click();
    const sync = page.waitForResponse((r) => r.url().includes("/bpmn/sync") && r.request().method() === "POST");
    await page.getByTestId("bpmn-property-name").fill("Send to finance");
    expect((await sync).status()).toBe(200);
    await expect(page.getByTestId("bpmn-status")).toContainText("Tallennettu", { timeout: 15_000 });

    await page.getByRole("tab", { name: "Blueprint" }).click();
    const warning = page.getByTestId("blueprint-changed-elsewhere");
    await expect(warning).toContainText("Blueprint muuttui muualla");
    // The draft is still the user's.
    await expect(page.getByTestId("blueprint-step-0-name")).toHaveValue("");

    await warning.getByRole("button", { name: "Ota uudempi versio" }).click();
    await expect(warning).toHaveCount(0);
    await expect(rows(page).nth(0)).toHaveAttribute("aria-label", "1. Invoice intake");
    await expect(rows(page).nth(4)).toHaveAttribute("aria-label", "5. Send to finance");
    await expect(status(page)).toHaveText("Tallennettu");
  });
});
