import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { recordChatReferences } from "./helpers/chat-reference";
import { resetMockSessions } from "./helpers/mock";

/**
 * The chat's progress steps and diagrams, the Gate 1 review's decision bar and
 * change request, and reordering blueprint steps by dragging or with the arrow keys.
 */

async function newSession(page: Page) {
  await loginAsDev(page);
  await page.locator("#session-title").fill(`ux ${Date.now()}`);
  await page.getByRole("button", { name: "Aloita uusi" }).click();
  await page.waitForURL(/\/sessions\//);
}

// A reply as wizard_api streams it: tool activity first, then the text.
async function fakeReply(page: Page, events: object[]) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  await page.route("**/api/sessions/*/chat", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, contentType: "text/event-stream", body })
      : route.continue(),
  );
}

async function send(page: Page, text: string) {
  const field = page.locator('textarea[name="message"]');
  await field.fill(text);
  await field.press("Enter");
}

test.describe("chat and review UX", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("the wizard's steps fold away under its answer", async ({ page }) => {
    await newSession(page);
    await fakeReply(page, [
      { activity: { kind: "read", file: "raportti.pdf" } },
      { activity: { kind: "write", file: "output_schema.py" } },
      { delta: "Valmis: luin raportin ja kirjoitin skeeman." },
      { done: true },
    ]);
    await send(page, "Tee skeema");

    const steps = page.getByTestId("chat-steps");
    await expect(steps).toContainText("Mitä wizard teki (2)");
    await steps.locator("summary").click();
    await expect(steps).toContainText("Luetaan raportti.pdf");
    await expect(steps).toContainText("Kirjoitetaan output_schema.py");
  });

  test("a mermaid block in a reply is drawn as a diagram", async ({ page }) => {
    await newSession(page);
    await fakeReply(page, [
      { delta: 'Työnkulku\n\n```mermaid\nflowchart TD\n  upload["Lataa aineisto"] --> transcribe["Litteroi"]\n```\n' },
      { done: true },
    ]);
    await send(page, "Näytä työnkulku");

    const diagram = page.getByTestId("chat-diagram");
    // The first diagram loads mermaid's chunks, which a busy dev server serves slowly.
    await expect(diagram).toBeVisible({ timeout: 45_000 });
    await expect(diagram.locator("svg")).toBeVisible();
    await expect(diagram).toContainText("Lataa aineisto");
    await expect(page.locator('[role="log"] code.language-mermaid')).toHaveCount(0);
    // The text the picture was drawn from stays readable under it.
    await diagram.getByText("Näytä kaavion lähdekoodi").click();
    await expect(diagram.locator("details pre")).toContainText("flowchart TD");

    // The diagram stays when the conversation goes on.
    await page.unrouteAll();
    await fakeReply(page, [{ delta: "Selvä." }, { done: true }]);
    await send(page, "Kiitos");
    await expect(page.locator('[data-testid="chat-message"][data-role="assistant"]').last()).toContainText("Selvä.");
    await expect(page.getByTestId("chat-diagram")).toHaveCount(1);
  });

  test("a mermaid block that does not parse stays as code", async ({ page }) => {
    await newSession(page);
    await fakeReply(page, [{ delta: "```mermaid\nthis is not a diagram\n```" }, { done: true }]);
    await send(page, "Näytä kaavio");

    await expect(page.locator('[role="log"] code.language-mermaid')).toContainText("this is not a diagram");
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("chat-diagram")).toHaveCount(0);
  });

  test("Gate 1 keeps its decision in view and takes a change request to the chat", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    const bar = page.getByTestId("gate1-actions");
    await expect(bar).toBeInViewport();
    await expect(page.getByRole("button", { name: "Hyväksy vaatimukset ja jatka" })).toBeInViewport();
    // What approving leads to sits with the button, and no form stands between
    // the user and the chat.
    await expect(bar).toContainText("Hyväksynnän jälkeen wizard suunnittelee ratkaisun näiden vaatimusten pohjalta.");
    await expect(page.getByText("Pyydä muutoksia tai hylkää")).toHaveCount(0);

    // "Pyydä muutoksia" hands the gate to the chat as a reference; the user
    // writes the request there, so it reaches the agent as a chat turn.
    const references = await recordChatReferences(page);
    await bar.getByRole("button", { name: "Pyydä muutoksia" }).click();
    expect(await references()).toEqual([
      {
        key: "gate:4",
        label: "Gate 1 · Vaatimukset",
        prefix: "Muutospyyntö ennen Gate 1:n (vaatimukset) hyväksyntää:",
      },
    ]);
  });

  test("blueprint steps reorder by dragging and with the arrow keys", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");
    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.getByTestId("blueprint-step-add").click();

    const rows = page.locator("ol > li[data-testid^='blueprint-step-']");
    await expect(rows).toHaveCount(3);
    // Name the new step: an unnamed one is labelled by its position.
    const newStep = rows.nth(2);
    if ((await newStep.getByTestId("blueprint-step-2-toggle").getAttribute("aria-expanded")) !== "true") {
      await newStep.getByTestId("blueprint-step-2-toggle").click();
    }
    await newStep.locator('input[type="text"]').first().fill("Review");
    await expect(newStep).toHaveAttribute("aria-label", "3. Review");
    const order = () => rows.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!.replace(/^\d+\.\s*/, "")));
    const [first, second, third] = await order();

    // Drag the first step below the last one.
    const handle = page.getByTestId("blueprint-step-0-drag");
    const from = (await handle.boundingBox())!;
    const last = (await rows.nth(2).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, last.y + last.height - 4, { steps: 8 });
    await page.mouse.up();
    await expect.poll(order).toEqual([second, third, first]);

    // The handle moves its step with the arrow keys too.
    await page.getByTestId("blueprint-step-0-drag").focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(order).toEqual([third, second, first]);
  });
});
