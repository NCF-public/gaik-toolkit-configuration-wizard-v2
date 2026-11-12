import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Layout bugs from the sprint 4 end-to-end review:
 * - a long conversation made the whole page scroll far past its content, with a
 *   second scrollbar, because each reply's screen-reader label escaped the
 *   chat's scroll box;
 * - an empty chat field stayed several lines tall after the chat had been narrow;
 * - the chat field and its box both drew a focus ring.
 *
 * And the phone layout of the session shell: a gate's decision bar on one
 * row, the line under the title at full width, and the steps as a card.
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

  test("a long unbroken word wraps in the chat instead of widening it", async ({ page }) => {
    await newSession(page);
    const field = chatField(page);
    const send = page.locator('form:has(textarea[name="message"]) button[type="submit"]');
    await field.fill(`https://example.com/${"a".repeat(240)}`);
    await field.press("Enter");
    await expect(send).toBeEnabled({ timeout: 30_000 });

    const log = page.getByRole("log");
    expect(await log.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("an empty chat field is one line tall again after the chat was narrow", async ({ page }) => {
    await newSession(page);
    const field = chatField(page);
    const oneLine = await field.evaluate((el: HTMLElement) => el.offsetHeight);
    const dock = page.getByTestId("chat-dock");

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
});

test.describe("session layout on a phone", () => {
  const PHONE = { width: 390, height: 844 };
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  // How far the page itself scrolls: it should not, in either direction.
  const pageOverflow = (page: Page) =>
    page.evaluate(() => ({
      x: document.scrollingElement!.scrollWidth - window.innerWidth,
      y: document.scrollingElement!.scrollHeight - window.innerHeight,
    }));

  // The vertical middle of each button in a bar: one value when they share a row.
  const buttonRows = (page: Page, testId: string) =>
    page
      .getByTestId(testId)
      .getByRole("button")
      .evaluateAll((els) => [
        ...new Set(
          els.map((el) => {
            const box = el.getBoundingClientRect();
            return Math.round((box.top + box.height / 2) / 4);
          }),
        ),
      ]);

  test("a gate's decision bar is one row and leaves the workspace most of the screen", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    // Reject, ask for changes and approve keep their names on a phone, where
    // reject is an icon and approve reads "Hyväksy".
    const bar = page.getByTestId("gate2-actions");
    await expect(bar.getByRole("button", { name: "Hylkää…" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Pyydä muutoksia" })).toBeVisible();
    const approve = bar.getByRole("button", { name: "Hyväksy ratkaisun rakenne ja jatka" });
    await expect(approve).toBeVisible();
    await expect(approve).toContainText("Hyväksy");

    expect(await buttonRows(page, "gate2-actions")).toHaveLength(1);
    const box = (await bar.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(72);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);

    // The line under the title has the full width beside nothing.
    const now = (await page.getByTestId("now-line").boundingBox())!;
    expect(now.width).toBeGreaterThan(PHONE.width - 40);

    // The workspace between the header and the bar is more than half the screen.
    const workspace = (await page.locator("#main-content > .scroll-thin").boundingBox())!;
    expect(workspace.height).toBeGreaterThan(PHONE.height * 0.6);

    expect(await pageOverflow(page)).toEqual({ x: 0, y: 0 });
  });

  test("Gate 1 fits its previous button into the same row", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    const bar = page.getByTestId("gate1-actions");
    await expect(bar.getByRole("button", { name: "Edellinen" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Hyväksy vaatimukset ja jatka" })).toBeVisible();
    expect(await buttonRows(page, "gate1-actions")).toHaveLength(1);
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(72);
    expect(await pageOverflow(page)).toEqual({ x: 0, y: 0 });
  });

  test("the steps open as a card that does not repeat the step count", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    const summary = page.getByTestId("steps-disclosure");
    await expect(summary).toHaveText("Vaihe 9/13");
    await summary.click();

    const card = page.getByRole("navigation", { name: "Vaiheet" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Hyväksy ratkaisun rakenne")).toBeVisible();
    await expect(card).not.toContainText("Vaihe 9");
    // It takes the header's width, under the chat button, not a column beside it.
    expect((await card.boundingBox())!.width).toBeGreaterThan(PHONE.width - 40);
    expect(await pageOverflow(page)).toEqual({ x: 0, y: 0 });
  });

  test("the chat opens as a sheet from the header and gathering does not scroll the page", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    const dock = page.getByTestId("chat-dock");
    await expect(dock).toHaveAttribute("data-chat-open", "false");
    await page.getByRole("button", { name: "Keskustelu" }).click();
    await expect(dock).toHaveAttribute("data-chat-open", "true");
    await expect(chatField(page)).toBeVisible();
    expect(await pageOverflow(page)).toEqual({ x: 0, y: 0 });

    await page.goto("/sessions/ses_cv");
    await expect(page.getByTestId("workspace-phase")).toHaveText("Vaatimusten keruu");
    expect(await pageOverflow(page)).toEqual({ x: 0, y: 0 });
  });
});
