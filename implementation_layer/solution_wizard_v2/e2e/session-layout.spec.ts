import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Layout bugs from the sprint 4 end-to-end review:
 * - a long conversation made the whole page scroll far past its content, with a
 *   second scrollbar, because each reply's screen-reader label escaped the
 *   chat's scroll box;
 * - an empty chat field stayed several lines tall after the chat had been narrow;
 * - the chat field and its box both drew a focus ring;
 * - the "next phase" hint pushed its button up.
 */

async function newSession(page: Page) {
  await loginAsDev(page);
  await page.locator("#session-title").fill(`layout ${Date.now()}`);
  await page.getByRole("button", { name: "Aloita uusi" }).click();
  await page.waitForURL(/\/sessions\//);
}

const chatField = (page: Page) => page.locator('textarea[name="message"]');

test.describe("session layout", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("a long conversation scrolls inside the chat, not the page", async ({ page }) => {
    await newSession(page);
    const field = chatField(page);
    const send = page.locator('form:has(textarea[name="message"]) button[type="submit"]');
    const log = page.getByRole("log");

    // Talk until the conversation is well taller than its box, so the later
    // replies (and their screen-reader labels) sit far below the window.
    for (let i = 1; i <= 12; i++) {
      await field.fill(`Viesti ${i}: kerron lisää nykyisestä prosessista ja sen ongelmista.`);
      await field.press("Enter");
      await expect(send).toBeEnabled({ timeout: 30_000 });
      const extra = await log.evaluate((el) => el.scrollHeight - el.clientHeight);
      if (extra > 600) break;
    }
    expect(await log.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(600);

    const pageOverflow = await page.evaluate(
      () => document.scrollingElement!.scrollHeight - window.innerHeight,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);
  });

  test("an empty chat field is one line tall again after the chat was narrow", async ({ page }) => {
    await newSession(page);
    const field = chatField(page);
    const oneLine = await field.evaluate((el: HTMLElement) => el.offsetHeight);
    const dock = page.locator("aside").filter({ has: field });

    // Narrow the chat as closing or dragging it does, wait out the dock's width
    // transition, then edit the field so it measures itself while narrow.
    await dock.evaluate((el) => {
      el.style.width = "120px";
      el.style.minWidth = "0";
    });
    await expect.poll(() => field.evaluate((el: HTMLElement) => el.offsetWidth)).toBeLessThan(100);
    await field.fill("x");
    await field.fill("");
    await expect.poll(() => field.evaluate((el: HTMLElement) => el.offsetHeight)).toBeGreaterThan(oneLine);

    await dock.evaluate((el) => {
      el.style.width = "";
      el.style.minWidth = "";
    });
    await expect.poll(() => field.evaluate((el: HTMLElement) => el.offsetHeight)).toBe(oneLine);
  });

  test("the chat field and its box draw one focus ring between them", async ({ page }) => {
    await newSession(page);
    const field = chatField(page);
    await field.click();

    expect(await field.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
    // The box's ring fades in, so wait for it to finish.
    await expect
      .poll(() => field.evaluate((el) => getComputedStyle(el.parentElement!).boxShadow))
      .toContain("0px 0px 0px 3px");
  });

  test("the next-phase hint opens without moving the button", async ({ page }) => {
    await newSession(page);
    const next = page.getByRole("button", { name: "Seuraava vaihe" });
    const before = await next.boundingBox();

    const hint = page.locator("#gathering-advance-hint");
    await next.click();
    await expect(hint).toBeVisible();
    const after = await next.boundingBox();
    expect(after).toEqual(before);

    await page.keyboard.press("Escape");
    await expect(hint).toBeHidden();

    // A press anywhere else closes it too (Safari does not focus a pressed button).
    await next.click();
    await expect(hint).toBeVisible();
    await page.getByTestId("workspace-phase").click();
    await expect(hint).toBeHidden();
  });
});
