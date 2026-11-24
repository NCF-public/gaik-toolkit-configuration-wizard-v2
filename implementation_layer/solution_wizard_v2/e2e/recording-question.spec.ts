import { test, expect, type Page } from "@playwright/test";
import { DEV_USERS, loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import { hydrated } from "./helpers/session";
import { PACE_SENTENCES } from "../lib/chat-background";
import { CHAT_SEND_EVENT } from "../lib/chat-events";

/**
 * The recording question: a session's chat asks, above its message field,
 * whether the session's usage data may be stored, and sends nothing before one
 * of the two answers is pressed. Every way into that state is walked here, on
 * a desktop window and on a phone: a session just started, the page loaded
 * again before the answer, a session with no first message, an answer that
 * fails, and what goes out once the answer is given.
 */

const TEXT = "Luokittele saapuvat reklamaatiot.";
/** The cookie the account menu's language choice is kept in (lib/i18n). */
const LOCALE_COOKIE = "gaik_locale";
const AFTER_ACTION = { timeout: 20_000 };
const asFirst = (text: string) => `${PACE_SENTENCES.fi.quick}\n${text}`;

const question = (page: Page) => page.getByTestId("recording-choice");
const allow = (page: Page) => page.getByTestId("recording-allow");
const decline = (page: Page) => page.getByTestId("recording-decline");
const field = (page: Page) => page.locator('textarea[name="message"]');
const sendButton = (page: Page) => page.locator('form:has(textarea[name="message"]) button[type="submit"]');
const bubbles = (page: Page) => page.getByTestId("chat-message").filter({ hasText: TEXT });

/** The messages the page posts to the wizard, in order; each is answered at once. */
async function chatPosts(page: Page): Promise<() => string[]> {
  const sent: string[] = [];
  await page.route("**/api/sessions/*/chat", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push((route.request().postDataJSON() as { message: string }).message);
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });
  return () => sent;
}

/** The answers the page posts, in order. */
function answerPosts(page: Page): () => string[] {
  const given: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !/\/api\/sessions\/[^/]+\/recording$/.test(request.url())) return;
    given.push((request.postDataJSON() as { answer: string }).answer);
  });
  return () => given;
}

/** A session started from the start view, on its page, the question unanswered. */
async function startUnanswered(page: Page, text = TEXT): Promise<string> {
  const start = page.getByTestId("start-view").locator('textarea[name="message"]');
  await start.fill(text);
  await start.press("Enter");
  await page.waitForURL(/\/sessions\/[^/]+$/, AFTER_ACTION);
  await hydrated(page);
  await expect(question(page)).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

/**
 * The question is where it belongs: in the chat's own column, directly above
 * the message field, whole inside the window, with both answers in reach.
 */
async function expectQuestionAboveField(page: Page): Promise<void> {
  await expect(question(page)).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  // Where things end up, not where a movement passes through.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const view = page.viewportSize()!;
  const box = (await question(page).boundingBox())!;
  const input = (await field(page).boundingBox())!;
  // Above the field, and next to it: nothing of the page between them but the
  // field's own card (its padding, and the row of choices a first message has).
  expect(box.y + box.height).toBeLessThanOrEqual(input.y);
  const between = await page.evaluate(() => {
    const ask = document.querySelector('[data-testid="recording-choice"]')!;
    const area = document.querySelector('textarea[name="message"]')!;
    // Every element that starts between the question's foot and the field's top.
    const from = ask.getBoundingClientRect().bottom;
    const to = area.getBoundingClientRect().top;
    return [...ask.parentElement!.children]
      .filter((el) => el !== ask && !el.contains(area))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top >= from - 1 && r.bottom <= to + 1;
      })
      .map((el) => el.getAttribute("data-testid") ?? el.tagName);
  });
  expect(between).toEqual([]);
  expect(input.y - (box.y + box.height)).toBeLessThan(72);
  // As wide as the field's card, give or take its padding; never wider than the window.
  expect(Math.abs(box.x - input.x)).toBeLessThan(24);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  // Whole in the window, the field under it too: nothing to scroll to.
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(input.y + input.height).toBeLessThanOrEqual(view.height);
  for (const button of [allow(page), decline(page)]) {
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    const b = (await button.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
    // A finger's size on a phone, and not cut off.
    expect(b.height).toBeGreaterThanOrEqual(32);
  }
  // The answer that stores is the right-hand one.
  const [left, right] = [(await decline(page).boundingBox())!, (await allow(page).boundingBox())!];
  expect(right.x).toBeGreaterThan(left.x);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/**
 * A conversation is on screen (the waiting message), so the field and the
 * question over it are docked at the window's foot, not in the page's middle
 * as the chat's empty start view has them.
 */
async function expectDockedAtFoot(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const view = page.viewportSize()!;
  const input = (await field(page).boundingBox())!;
  expect(view.height - (input.y + input.height)).toBeLessThan(120);
  const message = (await bubbles(page).first().boundingBox())!;
  const box = (await question(page).boundingBox())!;
  expect(message.y + message.height).toBeLessThanOrEqual(box.y);
}

/** Nothing can be written or sent while the question waits. */
async function expectFieldClosed(page: Page): Promise<void> {
  await expect(field(page)).toHaveAttribute("readonly", "");
  await expect(field(page)).toHaveAttribute("placeholder", "Vastaa ensin yllä olevaan kysymykseen");
  await expect(sendButton(page)).toBeDisabled();
}

for (const [name, viewport] of [
  ["on a desktop window", { width: 1440, height: 900 }],
  ["on a phone", { width: 390, height: 844 }],
  ["on a small phone", { width: 320, height: 568 }],
] as const) {
  test.describe(`the recording question ${name}`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page, request }) => {
      await resetMockSessions(request);
      await loginAsDev(page, DEV_USERS.secondary);
      await hydrated(page);
    });

    test("a session just started: the message waits in the chat, the question above the field", async ({ page }) => {
      const sent = await chatPosts(page);
      await startUnanswered(page);

      await expectQuestionAboveField(page);
      await expectDockedAtFoot(page);
      await expectFieldClosed(page);
      await expect(bubbles(page)).toHaveCount(1);
      // The chat's own start view (its heading, its examples) is not what is shown.
      await expect(page.getByTestId("chat-start")).toHaveCount(0);
      await expect(question(page)).toContainText("Saako tämän session käyttötiedot tallentaa?");
      await expect(question(page)).toContainText("tekstiä ei tallenneta");
      // What is kept with either answer, and that the answer is final.
      await expect(question(page)).toContainText("kerätään kaikista sessioista ilman sessiotunnusta");
      await expect(question(page)).toContainText("Vastausta ei voi muuttaa myöhemmin.");
      await expect(question(page).getByRole("button")).toHaveText(["Älä tallenna", "Saa tallentaa"]);
      expect(sent()).toEqual([]);
    });

    test("loaded again before the answer, it looks the same and still sends nothing", async ({ page }) => {
      const sent = await chatPosts(page);
      await startUnanswered(page);

      for (let load = 0; load < 2; load += 1) {
        await page.reload();
        await hydrated(page);
        await expectQuestionAboveField(page);
        await expectDockedAtFoot(page);
        await expectFieldClosed(page);
        await expect(bubbles(page)).toHaveCount(1);
        await expect(page.getByTestId("chat-start")).toHaveCount(0);
        await expect(field(page)).toHaveValue("");
      }
      // Left and come back to (the sidebar, the browser's back): the same.
      await page.goto("/");
      await hydrated(page);
      await page.goBack();
      await hydrated(page);
      await expectQuestionAboveField(page);
      await expectDockedAtFoot(page);
      await expect(bubbles(page)).toHaveCount(1);
      expect(sent()).toEqual([]);

      // And the answer still sends the message, once.
      await allow(page).click();
      await expect(question(page)).toHaveCount(0);
      await expect.poll(sent).toEqual([asFirst(TEXT)]);
      await expect(bubbles(page)).toHaveCount(1);
    });

    for (const [button, answer] of [
      ["recording-allow", "stored"],
      ["recording-decline", "not_stored"],
    ] as const) {
      test(`the answer ${answer} is given once, and then the first message goes out once`, async ({ page }) => {
        const sent = await chatPosts(page);
        const given = answerPosts(page);
        await startUnanswered(page);

        // A double press is one answer.
        await page.getByTestId(button).dblclick();

        await expect(question(page)).toHaveCount(0);
        await expect.poll(sent).toEqual([asFirst(TEXT)]);
        expect(given()).toEqual([answer]);
        await expect(bubbles(page)).toHaveCount(1);
        await expect(field(page)).not.toHaveAttribute("readonly", "");
        await expect(field(page)).not.toHaveAttribute("placeholder", "Vastaa ensin yllä olevaan kysymykseen");

        // Answered: not asked again, on this page or after a reload.
        await page.reload();
        await hydrated(page);
        await expect(question(page)).toHaveCount(0);
        await expect(field(page)).not.toHaveAttribute("readonly", "");
        expect(sent()).toEqual([asFirst(TEXT)]);
      });
    }

    test("the keyboard cannot send past the question", async ({ page }) => {
      const sent = await chatPosts(page);
      await startUnanswered(page);

      await field(page).focus();
      await page.keyboard.type("Lisää tämä");
      await page.keyboard.press("Enter");
      await expect(field(page)).toHaveValue("");
      // A message the page itself sends (an answer form, a chip) waits too.
      await page.evaluate(
        (event) => window.dispatchEvent(new CustomEvent(event, { detail: "Sivun viesti." })),
        CHAT_SEND_EVENT,
      );
      await expect(question(page)).toBeVisible();
      expect(sent()).toEqual([]);

      await allow(page).click();
      await expect.poll(sent).toEqual([asFirst(TEXT), "Sivun viesti."]);
    });

    test("an answer that could not be saved says so, keeps everything closed, and can be given again", async ({
      page,
    }) => {
      const sent = await chatPosts(page);
      await startUnanswered(page);
      const refuse = (route: import("@playwright/test").Route) =>
        route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"upstream"}' });
      await page.route("**/api/sessions/*/recording", refuse);

      await allow(page).click();

      await expect(page.getByTestId("recording-failed")).toHaveText(
        "Vastauksen tallennus ei onnistunut. Yritä uudelleen.",
      );
      await expectQuestionAboveField(page);
      await expectFieldClosed(page);
      expect(sent()).toEqual([]);

      // The connection itself gone: the same.
      await page.unroute("**/api/sessions/*/recording", refuse);
      const drop = (route: import("@playwright/test").Route) => route.abort();
      await page.route("**/api/sessions/*/recording", drop);
      await decline(page).click();
      await expect(page.getByTestId("recording-failed")).toBeVisible();
      await expect(allow(page)).toBeEnabled();
      expect(sent()).toEqual([]);

      await page.unroute("**/api/sessions/*/recording", drop);
      await allow(page).click();
      await expect(question(page)).toHaveCount(0);
      await expect.poll(sent).toEqual([asFirst(TEXT)]);
    });

    test("an answer refused because the other one stands says which one stands", async ({ page }) => {
      const sent = await chatPosts(page);
      const sid = await startUnanswered(page);
      // The same session in another tab, opened while it was still unanswered.
      const other = await page.context().newPage();
      await other.setViewportSize(viewport);
      await other.goto(`/sessions/${sid}`);
      await hydrated(other);
      await expect(question(other)).toBeVisible();

      await allow(page).click();
      await expect(question(page)).toHaveCount(0);
      await expect(page.getByTestId("recording-in-force")).toHaveCount(0);

      // "Do not store" here is not taken: the session is stored, and the chat says so.
      await decline(other).click();
      await expect(question(other)).toHaveCount(0);
      await expect(other.getByTestId("recording-in-force")).toHaveText(
        "Tähän sessioon on jo vastattu: käyttötiedot tallennetaan. Vastausta ei voi muuttaa.",
      );
      await expect(field(other)).not.toHaveAttribute("readonly", "");
      expect(await other.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await other.close();
      await expect.poll(sent).toEqual([asFirst(TEXT)]);
    });

    test("the other way round: a session that is not stored says so to the tab that pressed store", async ({
      page,
    }) => {
      const sid = await startUnanswered(page);
      const other = await page.context().newPage();
      await other.setViewportSize(viewport);
      await other.goto(`/sessions/${sid}`);
      await hydrated(other);

      await decline(page).click();
      await expect(question(page)).toHaveCount(0);
      await allow(other).click();

      await expect(other.getByTestId("recording-in-force")).toHaveText(
        "Tähän sessioon on jo vastattu: käyttötietoja ei tallenneta. Vastausta ei voi muuttaa.",
      );
      await other.close();
    });

    test("a refusal that does not say which answer stands is a failure, not a yes", async ({ page }) => {
      const sent = await chatPosts(page);
      await startUnanswered(page);
      await page.route("**/api/sessions/*/recording", (route) =>
        route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"already_answered"}' }),
      );

      await decline(page).click();

      await expect(page.getByTestId("recording-failed")).toBeVisible();
      await expect(question(page)).toBeVisible();
      await expectFieldClosed(page);
      expect(sent()).toEqual([]);
    });

    test("a session with no first message asks the same way, and the answer opens the field", async ({ page }) => {
      const sent = await chatPosts(page);
      await startUnanswered(page);
      // The message is gone (another browser, a cleared tab): only the session is left.
      await page.evaluate(() => window.sessionStorage.clear());
      await page.reload();
      await hydrated(page);

      await expectQuestionAboveField(page);
      await expectFieldClosed(page);
      await expect(bubbles(page)).toHaveCount(0);

      await decline(page).click();

      await expect(question(page)).toHaveCount(0);
      await expect(field(page)).not.toHaveAttribute("readonly", "");
      expect(sent()).toEqual([]);
      // The field works: what is written now is sent.
      await field(page).fill("Poimi sopimuksista irtisanomisajat.");
      await field(page).press("Enter");
      await expect.poll(() => sent().length).toBe(1);
    });

    test("in English", async ({ page }) => {
      // The language as the account menu sets it: in a cookie (on a phone the
      // menu is behind the sidebar's own button, which is not what is tested here).
      await page.context().addCookies([{ name: LOCALE_COOKIE, value: "en", url: page.url() }]);
      await page.reload();
      await hydrated(page);
      await expect(page.getByTestId("start-view")).toContainText("What do you want to solve?");
      const start = page.getByTestId("start-view").locator('textarea[name="message"]');
      await start.fill("Classify incoming complaints.");
      await start.press("Enter");
      await page.waitForURL(/\/sessions\/[^/]+$/, AFTER_ACTION);
      await hydrated(page);

      await expectQuestionAboveField(page);
      await expect(question(page)).toContainText("May this session's usage data be stored?");
      await expect(question(page)).toContainText("is not stored");
      await expect(question(page)).toContainText("The answer cannot be changed later.");
      await expect(question(page).getByRole("button")).toHaveText(["Do not store", "Store it"]);
      await expect(field(page)).toHaveAttribute("placeholder", "Answer the question above first");
    });
  });
}
