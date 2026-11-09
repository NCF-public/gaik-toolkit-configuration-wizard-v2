import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * The chat's progress steps and diagrams, the Gate 1 review's decision bar and
 * feedback, and reordering blueprint steps by dragging or with the arrow keys.
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

type ChatStream = { push(event: object): void; end(): void };
type ChatWindow = Window & { chatStream?: ChatStream };

// A reply that arrives piece by piece: the next POST /chat answers with a
// stream the test feeds, so the page can be looked at while the reply is
// still on its way (route.fulfill delivers a whole body at once).
async function streamedReply(page: Page) {
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init?.method !== "POST" || !/\/api\/sessions\/[^/]+\/chat$/.test(url)) return original(input, init);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          (window as ChatWindow).chatStream = {
            push: (event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
            end: () => controller.close(),
          };
        },
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    };
  });
  return {
    async push(...events: object[]) {
      await page.waitForFunction(() => !!(window as ChatWindow).chatStream);
      await page.evaluate((list) => list.forEach((e) => (window as ChatWindow).chatStream!.push(e)), events);
    },
    async end() {
      await page.evaluate(() => (window as ChatWindow).chatStream!.end());
    },
  };
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
    // A file the wizard itself writes is named in plain words.
    await expect(steps).toContainText("Kirjoitetaan poimittavat kentät");
    await expect(steps).not.toContainText("output_schema.py");
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
    await expect(diagram.getByRole("img").locator("svg")).toBeVisible();
    await expect(diagram).toContainText("Lataa aineisto");
    await expect(page.locator('[role="log"] code.language-mermaid')).toHaveCount(0);
    // No code under the picture: its name reads the steps out in order instead.
    await expect(diagram.locator("details")).toHaveCount(0);
    await expect(
      diagram.getByRole("img", { name: "Kaavio, vaiheet järjestyksessä: Lataa aineisto, Litteroi" }),
    ).toBeVisible();
    // A picture this small is shown whole, with no button to open it.
    await expect(diagram).not.toHaveClass(/is-clipped/);
    await expect(diagram.getByRole("button", { name: "Suurenna" })).toBeHidden();

    // The diagram stays when the conversation goes on.
    await page.unrouteAll();
    await fakeReply(page, [{ delta: "Selvä." }, { done: true }]);
    await send(page, "Kiitos");
    await expect(page.locator('[data-testid="chat-message"][data-role="assistant"]').last()).toContainText("Selvä.");
    await expect(page.getByTestId("chat-diagram")).toHaveCount(1);
  });

  test("a tall diagram is capped and opens whole in a dialog", async ({ page }) => {
    await newSession(page);
    const names = ["Lataa", "Litteroi", "Poimi", "Tarkista", "Korjaa", "Vie"];
    const source = [
      "flowchart TD",
      ...names.map((name, i) => `  n${i}["${name}"]`),
      ...names.slice(1).map((_, i) => `  n${i} --> n${i + 1}`),
    ].join("\n");
    await fakeReply(page, [{ delta: "```mermaid\n" + source + "\n```" }, { done: true }]);
    await send(page, "Näytä työnkulku");

    const diagram = page.getByTestId("chat-diagram");
    await expect(diagram).toBeVisible({ timeout: 45_000 });
    await expect(diagram).toHaveClass(/is-clipped/);
    expect((await diagram.getByRole("img").boundingBox())!.height).toBeLessThanOrEqual(321);

    const expand = diagram.getByRole("button", { name: "Suurenna" });
    await expand.click();
    const dialog = page.getByTestId("chat-diagram-dialog");
    await expect(dialog).toBeVisible();
    const whole = dialog.getByRole("img", { name: /Lataa, Litteroi, Poimi, Tarkista, Korjaa, Vie$/ });
    await expect(whole).toBeVisible();
    await expect(whole.locator("svg")).toContainText("Vie");
    // A modal dialog: the page behind it is inert, so the focus stays inside.
    expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
    await expect(dialog.getByRole("button", { name: "Sulje" })).toBeFocused();
    // Esc closes it and gives the focus back to the button.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(expand).toBeFocused();

    // Where the chat lies over the page, Esc in the dialog closes the dialog, not the chat.
    await page.setViewportSize({ width: 1024, height: 800 });
    await expand.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("chat-dock")).toHaveAttribute("data-chat-open", "true");
  });

  test("a diagram still being written shows a line, not its code", async ({ page }) => {
    await newSession(page);
    const reply = await streamedReply(page);
    await send(page, "Näytä työnkulku");
    await reply.push({ delta: 'Työnkulku\n\n```mermaid\nflowchart TD\n  upload["Lataa aineisto"] --> tr' });

    const pending = page.getByTestId("chat-diagram-pending");
    await expect(pending.locator("p")).toHaveText("Piirretään kaaviota…");
    await expect(page.locator('[role="log"] code.language-mermaid')).toBeHidden();

    await reply.push({ delta: 'anscribe["Litteroi"]\n```\n' }, { done: true });
    await reply.end();
    await expect(page.getByTestId("chat-diagram")).toBeVisible({ timeout: 45_000 });
    await expect(pending).toHaveCount(0);
  });

  test("a mermaid block that does not parse stays as code", async ({ page }) => {
    await newSession(page);
    await fakeReply(page, [{ delta: "```mermaid\nthis is not a diagram\n```" }, { done: true }]);
    await send(page, "Näytä kaavio");

    const code = page.locator('[role="log"] code.language-mermaid');
    await expect(code).toBeVisible({ timeout: 45_000 });
    await expect(code).toContainText("this is not a diagram");
    await expect(page.getByTestId("chat-diagram")).toHaveCount(0);
    await expect(page.getByTestId("chat-diagram-pending")).toHaveCount(0);
  });

  test("Gate 1 keeps its decision in view and says where feedback goes", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    await expect(page.getByTestId("gate1-actions")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Hyväksy vaatimukset ja jatka" })).toBeInViewport();

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    await expect(page.getByText("Palaute menee wizardille chattiin.", { exact: false })).toBeVisible();
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
