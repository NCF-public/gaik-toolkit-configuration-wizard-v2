import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import { createSession } from "./helpers/session";

/**
 * The chat's one composer: a reference chip for "ask about this" from the page
 * (CHAT_REFERENCE_EVENT in lib/chat-events.ts), a checklist point answered in
 * the chat, the background chips of an empty chat, the header hint and the AI
 * notice, a gate approval shown as an event line, and links in a reply.
 */

const REFERENCE_EVENT = "gaik-wizard:chat-reference";
const SEND_EVENT = "gaik-wizard:chat-send";

type Reference = { key: string; label: string; prefix: string; draft?: string };

async function newSession(page: Page) {
  await page.goto("/");
  await createSession(page, `chat ${Date.now()}`);
}

// Answers POST /chat as wizard_api streams it, and collects what was sent.
async function fakeChat(page: Page, events: object[] = [{ delta: "Selvä." }, { done: true }]) {
  const sent: string[] = [];
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  await page.route("**/api/sessions/*/chat", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push((route.request().postDataJSON() as { message: string }).message);
    return route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  return sent;
}

// What askInChat does, from anywhere on the page.
async function ask(page: Page, reference: Reference) {
  await page.evaluate(
    ([name, detail]) => window.dispatchEvent(new CustomEvent(name as string, { detail })),
    [REFERENCE_EVENT, reference] as const,
  );
}

const field = (page: Page) => page.locator('textarea[name="message"]');
const chip = (page: Page) => page.getByTestId("chat-reference");
const userMessages = (page: Page) => page.locator('[data-testid="chat-message"][data-role="user"]');

const STEP: Reference = {
  key: "step:classify",
  label: "Vaihe 3 · Luokittelu",
  prefix: 'Koskee prosessin vaihetta 3 (id classify), lainattuna: "Luokittelu"',
};

test.describe("the chat composer", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page, request }) => {
    await resetMockSessions(request);
    await loginAsDev(page);
  });

  test("a reference from the page is a chip, and the message starts with its line", async ({ page }) => {
    await newSession(page);
    const sent = await fakeChat(page);

    await ask(page, STEP);
    await expect(chip(page)).toContainText("Vaihe 3 · Luokittelu");
    await expect(field(page)).toBeFocused();

    // A chip alone sends nothing.
    await field(page).press("Enter");
    await expect(chip(page)).toBeVisible();
    expect(sent).toEqual([]);

    // Another item takes the chip's place, and its draft goes into the field.
    await ask(page, {
      key: "gate:9",
      label: "Gate 2 · Ratkaisun rakenne",
      prefix: "Muutospyyntö ennen Gate 2:n (Ratkaisun rakenne) hyväksyntää:",
      draft: "Lisää ",
    });
    await expect(chip(page)).toHaveCount(1);
    await expect(chip(page)).toContainText("Gate 2 · Ratkaisun rakenne");
    await expect(field(page)).toHaveValue("Lisää ");
    await expect(field(page)).toBeFocused();

    await field(page).pressSequentially("tarkistusvaihe.");
    await field(page).press("Enter");
    await expect
      .poll(() => sent)
      .toEqual(["Muutospyyntö ennen Gate 2:n (Ratkaisun rakenne) hyväksyntää:\n\nLisää tarkistusvaihe."]);
    await expect(chip(page)).toHaveCount(0);
    await expect(userMessages(page).last()).toContainText("Lisää tarkistusvaihe.");
    await expect(page.locator('[data-testid="chat-message"][data-role="assistant"]').last()).toContainText("Selvä.");

    // A chip the user removes leaves an ordinary message.
    await ask(page, STEP);
    await page.getByTestId("chat-reference-remove").click();
    await expect(chip(page)).toHaveCount(0);
    await expect(field(page)).toBeFocused();
    await field(page).fill("Kiitos");
    await field(page).press("Enter");
    await expect.poll(() => sent[1]).toBe("Kiitos");
  });

  test("a draft does not replace what the user has typed", async ({ page }) => {
    await newSession(page);
    await field(page).fill("Kesken oleva ajatus");
    await ask(page, { ...STEP, draft: "Muuta " });
    await expect(chip(page)).toBeVisible();
    await expect(field(page)).toHaveValue("Kesken oleva ajatus");
  });

  test("a reference opens a closed chat", async ({ page }) => {
    await newSession(page);
    const dock = page.getByTestId("chat-dock");
    await page.getByTestId("chat-dock-toggle").click();
    await expect(dock).toHaveAttribute("data-chat-open", "false");

    await ask(page, STEP);
    await expect(dock).toHaveAttribute("data-chat-open", "true");
    await expect(chip(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
  });

  test("a checklist point is answered in the chat, quoted as data", async ({ page }) => {
    await newSession(page);
    const sent = await fakeChat(page);

    // One composer: the checklist has no field of its own.
    await expect(page.locator("textarea")).toHaveCount(1);
    await page.getByTestId("requirement-ask-2").click();
    await expect(chip(page)).toContainText("Kohta 2 · Who will use the system?");
    await expect(field(page)).toBeFocused();

    await field(page).pressSequentially("Asiakaspalvelu");
    await field(page).press("Enter");
    await expect
      .poll(() => sent)
      .toEqual(['Vastaus tarkistuslistan kohtaan 2, lainattuna: "Who will use the system?"\n\nAsiakaspalvelu']);
    await expect(chip(page)).toHaveCount(0);
  });

  test("an answer the wizard was too busy to take comes back with its chip", async ({ page }) => {
    await newSession(page);
    await page.route("**/api/sessions/*/chat", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 409, contentType: "application/json", body: "{}" })
        : route.continue(),
    );
    await page.getByTestId("requirement-ask-2").click();
    await field(page).pressSequentially("Asiakaspalvelu");
    await field(page).press("Enter");

    // Said above the field; no bubble is left for an answer that was not taken.
    await expect(page.getByTestId("chat-busy-note")).toContainText("Wizard vastaa vielä edelliseen viestiin");
    await expect(page.getByRole("log")).not.toContainText("Asiakaspalvelu");
    await expect(chip(page)).toContainText("Kohta 2");
    await expect(field(page)).toHaveValue("Asiakaspalvelu");
  });

  test("what the user writes while an answer fails to send is not replaced by the old answer", async ({ page }) => {
    await newSession(page);
    let refuse: () => void = () => {};
    const refused = new Promise<void>((resolve) => (refuse = resolve));
    await page.route("**/api/sessions/*/chat", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await refused;
      return route.fulfill({ status: 409, contentType: "application/json", body: "{}" });
    });
    await page.getByTestId("requirement-ask-2").click();
    await field(page).pressSequentially("Asiakaspalvelu");
    await field(page).press("Enter");
    await expect(field(page)).toHaveValue("");
    await field(page).pressSequentially("Ja vielä laskutus");
    refuse();

    await expect(page.getByTestId("chat-busy-note")).toContainText("Wizard vastaa vielä edelliseen viestiin");
    await expect(field(page)).toHaveValue("Ja vielä laskutus");
  });

  test("a message the page sends as it is still goes out as a chat turn", async ({ page }) => {
    await newSession(page);
    const sent = await fakeChat(page);
    const message = 'Hylkään Gate 1:n (Vaatimukset): "liian suppea"';
    await field(page).fill("Kesken");
    await page.evaluate(
      ([name, detail]) => window.dispatchEvent(new CustomEvent(name, { detail })),
      [SEND_EVENT, message] as const,
    );
    await expect.poll(() => sent).toEqual([message]);
    // What the user was typing stays in the field.
    await expect(field(page)).toHaveValue("Kesken");
  });

  test("an empty chat asks who the user is, and the answer leads the first message", async ({ page }) => {
    await newSession(page);
    const sent = await fakeChat(page);

    const empty = page.getByTestId("chat-empty");
    await expect(empty).toContainText("Hei! Olen tekoälyavustaja.");
    const chips = page.getByRole("group", { name: "Taustasi" });
    const nonTechnical = chips.getByRole("button", { name: "En ole tekninen" });
    const technical = chips.getByRole("button", { name: "Olen tekninen" });

    await nonTechnical.click();
    await expect(nonTechnical).toHaveAttribute("aria-pressed", "true");
    await expect(field(page)).toHaveValue(/^Taustani: en ole tekninen\. /);
    await expect(field(page)).toBeFocused();

    // The other chip swaps the sentence; pressing it again takes it out.
    await technical.click();
    await expect(technical).toHaveAttribute("aria-pressed", "true");
    await expect(nonTechnical).toHaveAttribute("aria-pressed", "false");
    await expect(field(page)).toHaveValue(/^Taustani: olen tekninen\. /);
    await technical.click();
    await expect(field(page)).toHaveValue("");
    await technical.click();

    await field(page).pressSequentially("Haluan luokitella laskut.");
    await field(page).press("Enter");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatch(/^Taustani: olen tekninen\. .* Haluan luokitella laskut\.$/);

    // The greeting and the chips belong to the empty chat only.
    await expect(empty).toHaveCount(0);
    await expect(page.getByTestId("chat-background")).toHaveCount(0);

    // The choice is remembered for the next session, still editable.
    await newSession(page);
    await expect(field(page)).toHaveValue(/^Taustani: olen tekninen\. /);
    await expect(page.getByRole("button", { name: "Olen tekninen" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the header says where changes are asked for, and the AI notice sits under the field", async ({ page }) => {
    // While gathering there is nothing to change yet and no tabs: no hint.
    await newSession(page);
    await expect(page.getByTestId("chat-ai-notice")).toBeVisible();
    await expect(page.getByTestId("chat-hint")).toHaveCount(0);

    await page.goto("/sessions/ses_ui_basics");
    await expect(page.getByTestId("chat-hint")).toHaveText("Pyydä muutoksia tässä tai muokkaa itse välilehdillä.");

    const notice = page.getByTestId("chat-ai-notice");
    await expect(notice).toHaveText("Vastaukset tuottaa tekoäly. Tarkista ne ennen käyttöä.");
    await expect(notice).toBeInViewport();
    const fieldBox = (await field(page).boundingBox())!;
    const noticeBox = (await notice.boundingBox())!;
    expect(noticeBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
    // The field is described by the notice, so a screen reader hears it there.
    const describedBy = (await field(page).getAttribute("aria-describedby")) ?? "";
    expect(describedBy.split(" ")).toContain(await notice.getAttribute("id"));
  });

  test("the notice is fine print that starts where the field's text starts", async ({ page }) => {
    await page.goto("/sessions/ses_ui_basics");
    const notice = page.getByTestId("chat-ai-notice");
    await expect(notice).toBeInViewport();
    expect(await notice.evaluate((el) => getComputedStyle(el).fontSize)).toBe("11px");
    // Small, but as readable as the rest of the muted text: no fading.
    expect(await notice.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    // The first letter of the notice sits under the first letter typed.
    const edges = await page.evaluate(() => {
      const field = document.querySelector<HTMLTextAreaElement>("textarea[name=message]")!;
      const note = document.querySelector<HTMLElement>("[data-testid=chat-ai-notice]")!;
      const left = (el: HTMLElement) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
      return { field: left(field), note: left(note) };
    });
    expect(Math.abs(edges.field - edges.note)).toBeLessThanOrEqual(1);
  });

  test("the field grows and shrinks with its text as one movement, and Enter still sends", async ({ page }) => {
    await newSession(page);
    const sent = await fakeChat(page);
    const input = field(page);
    const height = () => input.evaluate((el) => el.getBoundingClientRect().height);
    const oneLine = await height();

    // The height the field is heading for, and the heights it passes on the way.
    const passed = await input.evaluate(async (el: HTMLTextAreaElement, text) => {
      const seen: number[] = [];
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setValue.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      for (let frame = 0; frame < 40; frame++) {
        await new Promise((next) => requestAnimationFrame(next));
        seen.push(el.getBoundingClientRect().height);
      }
      return seen;
    }, "rivi yksi\nrivi kaksi\nrivi kolme\nrivi neljä");
    const fourLines = passed.at(-1)!;
    expect(fourLines).toBeGreaterThan(oneLine + 40);
    // In between: at least one frame taller than one line and shorter than four.
    expect(passed.some((h) => h > oneLine + 1 && h < fourLines - 1)).toBe(true);
    // No scrollbar beside text that is all in view.
    expect(await input.evaluate((el) => getComputedStyle(el).overflowY)).toBe("hidden");

    // Shift+Enter adds a line and sends nothing; Enter sends and the field is one line again.
    await input.press("Shift+Enter");
    await input.pressSequentially("rivi viisi");
    expect(sent).toEqual([]);
    await expect.poll(height).toBeGreaterThan(fourLines);
    await input.press("Enter");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toContain("rivi neljä\nrivi viisi");
    await expect(input).toHaveValue("");
    await expect.poll(height).toBe(oneLine);
  });

  test("with reduced motion the field takes its new height at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await newSession(page);
    const input = field(page);
    const oneLine = await input.evaluate((el) => el.getBoundingClientRect().height);
    const next = await input.evaluate(async (el: HTMLTextAreaElement) => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setValue.call(el, "yksi\nkaksi\nkolme");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((frame) => requestAnimationFrame(frame));
      await new Promise((frame) => requestAnimationFrame(frame));
      return { now: el.getBoundingClientRect().height, target: parseFloat(el.style.height) };
    });
    expect(next.target).toBeGreaterThan(oneLine + 20);
    expect(next.now).toBe(next.target);
  });

  test("a gate approved in the panel shows as an event line, not as the user's message", async ({ page }) => {
    const sent = await fakeChat(page);
    // Gate 2 is approved in this session; the address alone does not wake the agent.
    await page.goto("/sessions/ses_laskut?wake=2");

    await expect(page.getByTestId("chat-event")).toHaveText("Gate 2 hyväksytty");
    // What is sent to the agent stays the same.
    await expect.poll(() => sent).toEqual(["Gate 2 hyväksytty paneelista, jatka."]);
    await expect(userMessages(page).filter({ hasText: "paneelista" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/sessions\/ses_laskut$/);
  });

  test("the same words typed by the user stay the user's message", async ({ page }) => {
    await newSession(page);
    const sent = await fakeChat(page);
    await field(page).fill("Gate 2 hyväksytty paneelista, jatka.");
    await field(page).press("Enter");

    await expect.poll(() => sent).toEqual(["Gate 2 hyväksytty paneelista, jatka."]);
    await expect(userMessages(page).filter({ hasText: "paneelista" })).toHaveCount(1);
    await expect(page.getByTestId("chat-event")).toHaveCount(0);
  });

  test("links in a reply: in-app ones stay in the tab, external ones say where they go", async ({ page }) => {
    await newSession(page);
    const path = new URL(page.url()).pathname;
    await fakeChat(page, [
      {
        delta:
          `Testi on [PoC-välilehdellä](${path}?tab=poc). Ohje: [GAIK-dokumentaatio](https://www.gaik.ai/docs/wizard) ` +
          "ja https://en.wikipedia.org/wiki/Foo_(bar).",
      },
      { done: true },
    ]);
    await field(page).fill("Mistä löydän ohjeet?");
    await field(page).press("Enter");

    const log = page.getByRole("log");
    const external = log.getByRole("link", { name: /GAIK-dokumentaatio/ });
    await expect(external).toHaveAttribute("href", "https://www.gaik.ai/docs/wizard");
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toHaveAttribute("rel", "noreferrer noopener");
    await expect(external).toHaveAttribute("title", "https://www.gaik.ai/docs/wizard");
    await expect(external.locator(".chat-link-host")).toHaveText("gaik.ai");
    await expect(external.locator("svg.chat-link-icon")).toBeVisible();

    const bare = log.getByRole("link", { name: "https://en.wikipedia.org/wiki/Foo_(bar)" });
    await expect(bare).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Foo_(bar)");
    await expect(bare.locator(".chat-link-host")).toHaveCount(0);

    // The in-app link goes through the router: same tab, no page load.
    const internal = log.getByRole("link", { name: "PoC-välilehdellä" });
    await expect(internal).not.toHaveAttribute("target", /.*/);
    await page.evaluate(() => ((window as unknown as { stayed?: boolean }).stayed = true));
    await internal.click();
    await expect(page).toHaveURL(/\?tab=poc$/);
    expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
    expect(page.context().pages()).toHaveLength(1);
  });
});

test.describe("the chat composer on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page, request }) => {
    await resetMockSessions(request);
    await loginAsDev(page);
  });

  test("a reference opens the chat sheet with its chip in view", async ({ page }) => {
    await page.goto("/sessions/ses_ui_basics");
    const dock = page.getByTestId("chat-dock");
    await expect(dock).toHaveAttribute("data-chat-open", "false");

    await ask(page, STEP);
    await expect(dock).toHaveAttribute("data-chat-open", "true");
    await expect(chip(page)).toBeInViewport();
    await expect(page.getByTestId("chat-reference-remove")).toBeInViewport();
    await expect(field(page)).toBeInViewport();
    // The chip stays inside the sheet's width.
    const box = (await chip(page).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});
