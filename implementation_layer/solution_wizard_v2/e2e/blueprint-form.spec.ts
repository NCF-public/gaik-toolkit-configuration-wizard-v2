import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import { openBlueprintEditor, selectWorkspaceTab, setChatOpen } from "./helpers/workspace";

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

  test("Valmis keeps the form open while its draft cannot be saved", async ({ page }) => {
    await openForm(page, "ses_ui_basics");
    await page.getByTestId("blueprint-step-add").click();
    await expect(status(page)).toHaveText("Ei tallennettu: anna vaiheelle nimi");

    // Behind the read view the draft was out of sight, and the read view showed the old steps.
    const note = page.getByTestId("blueprint-done-unsaved");
    await page.getByTestId("blueprint-done").click();
    await expect(note).toHaveText("Lomake pysyy auki, koska muutoksia ei ole voitu tallentaa.");
    await expect(status(page)).toBeVisible();
    await expect(page.getByTestId("solution-plan-view")).toHaveCount(0);

    const saved = blueprintPatch(page);
    await page.getByTestId("blueprint-step-2-name").fill("Review");
    await saved;
    await expect(status(page)).toHaveText("Tallennettu");
    await expect(note).toBeEmpty();
    await page.getByTestId("blueprint-done").click();
    await expect(page.getByTestId("solution-plan-view").getByTestId(/^plan-step-\d+$/)).toHaveCount(3);
  });

  test("a save that fails after Valmis brings the form back", async ({ page }) => {
    let fail = true;
    await page.route("**/api/sessions/ses_ui_basics/blueprint", (route) =>
      fail && route.request().method() === "PATCH" ? route.fulfill({ status: 500, body: "no" }) : route.continue(),
    );
    await openForm(page, "ses_ui_basics");
    await page.getByTestId("blueprint-field-goal").fill("Shorter handling time");
    // Leaving the field for the button sends the save; the form closes before the answer.
    await page.getByTestId("blueprint-done").click();

    await expect(status(page)).toContainText("Tallennus epäonnistui");
    await expect(status(page)).toBeVisible();
    await expect(page.getByTestId("blueprint-done-unsaved")).not.toBeEmpty();
    await expect(page.getByTestId("blueprint-field-goal")).toHaveValue("Shorter handling time");

    fail = false;
    const saved = blueprintPatch(page);
    await page.getByTestId("blueprint-save-retry").click();
    await saved;
    await expect(status(page)).toHaveText("Tallennettu");
    await page.getByTestId("blueprint-done").click();
    await expect(page.getByTestId("solution-plan-view")).toContainText("Shorter handling time");
  });

  test("a reload right after typing asks first, and the edit is sent as the page goes", async ({ page }) => {
    await openForm(page, "ses_ui_basics");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.accept();
    });
    // Within the wait that follows typing (1.2 s), so nothing has been saved yet.
    await page.getByTestId("blueprint-field-goal").fill("Shorter handling time");
    await page.reload();
    expect(dialogs[0]).toBe("beforeunload");

    // The save and the reload cross on their way: the next load has it for certain.
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("solution-plan-view")).toContainText("Shorter handling time", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  });

  test("a settings row shows its own setting after the one above is removed, and a key in use is not taken", async ({
    page,
  }) => {
    await openForm(page, "ses_ui_basics");
    await page.getByTestId("blueprint-step-0-toggle").click();
    await page.getByTestId("blueprint-step-0-tech").click();
    const key = (n: number) => page.getByTestId(`blueprint-step-0-setting-${n}-key`);
    const value = (n: number) => page.getByTestId(`blueprint-step-0-setting-${n}-value`);
    const add = page.getByTestId("blueprint-step-0-setting-add");

    await add.click();
    await add.click();
    await key(0).fill("model");
    // Tab goes on to the value: the rename does not rebuild the row under the cursor.
    await key(0).press("Tab");
    await expect(value(0)).toBeFocused();
    await value(0).fill("gpt-4o");
    await key(1).fill("language");
    await value(1).fill("fi");

    await page.getByTestId("blueprint-step-0-setting-0-remove").click();
    await expect(key(1)).toHaveCount(0);
    await expect(key(0)).toHaveValue("language");
    await expect(value(0)).toHaveValue("fi");

    // A key another setting has is refused: the field shows the setting's own key again.
    await add.click();
    await expect(key(1)).toHaveValue("setting_2");
    await key(1).fill("language");
    await value(1).fill("en");
    await expect(key(1)).toHaveValue("setting_2");
    await expect(key(0)).toHaveValue("language");

    await page.getByTestId("blueprint-field-name").focus();
    await expect(status(page)).toHaveText("Tallennettu");
    await page.getByTestId("blueprint-json-toggle").click();
    const saved = JSON.parse(await page.getByTestId("blueprint-json-editor").inputValue()) as {
      steps: { settings?: Record<string, string> }[];
    };
    expect(saved.steps[0].settings).toEqual({ language: "fi", setting_2: "en" });
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

    // Meanwhile the diagram saves a rename of another step. The session waits
    // on a gate, so the chat is open: collapsed, the tab has room for the step list.
    await setChatOpen(page, false);
    await selectWorkspaceTab(page, "Työnkulku");
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
