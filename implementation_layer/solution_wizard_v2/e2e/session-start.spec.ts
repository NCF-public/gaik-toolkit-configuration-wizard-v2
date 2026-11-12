import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { setMockSessionStep } from "./helpers/dev-step";
import { resetMockSessions } from "./helpers/mock";

/**
 * The start of a session with the live agent. That agent asks in the chat and
 * keeps no requirement checklist, so before the specification the workspace
 * had one paragraph that sent the reader to the chat beside it. There the chat
 * is the page: an empty one opens with a question, the field and examples, and
 * the workspace comes in beside the conversation at the specification.
 *
 * The mock store these specs run on seeds a checklist and an opening question;
 * /api/dev/live-start takes them out, as a live session has neither.
 */

async function newLiveSession(page: Page): Promise<string> {
  await loginAsDev(page);
  await page.locator("#session-title").fill(`start ${Date.now()}`);
  await page.getByRole("button", { name: "Aloita uusi" }).click();
  await page.waitForURL(/\/sessions\//);
  const id = new URL(page.url()).pathname.split("/")[2];
  const res = await page.request.post("/api/dev/live-start", { data: { id } });
  expect(res.ok(), `live-start failed: ${res.status()}`).toBe(true);
  await page.reload();
  return id;
}

const field = (page: Page) => page.locator('textarea[name="message"]');
const send = (page: Page) =>
  page.locator('form:has(textarea[name="message"]) button[type="submit"]');
const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

test.describe("session start in the chat", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("a new session opens on the chat, with the cursor in its field", async ({ page }) => {
    await newLiveSession(page);

    const chat = page.getByRole("main", { name: "Keskustelu" });
    await expect(chat).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mitä haluat ratkaista?" })).toBeVisible();
    await expect(field(page)).toBeFocused();

    // No workspace beside it, and nothing to dock or close.
    await expect(page.getByTestId("workspace-phase")).toHaveCount(0);
    await expect(page.getByTestId("chat-dock-toggle")).toHaveCount(0);
    await expect(page.getByTestId("chat-resize")).toHaveCount(0);

    // The field sits on the middle line of the space beside the steps.
    const box = (await chat.boundingBox())!;
    const input = (await field(page).boundingBox())!;
    const middle = input.x + input.width / 2;
    expect(Math.abs(middle - (box.x + box.width / 2))).toBeLessThan(40);
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
  });

  test("an example goes after the background sentence and steps back for the user's own words", async ({
    page,
  }) => {
    await newLiveSession(page);
    const input = field(page);
    const examples = page.getByTestId("chat-examples");

    await page.getByRole("button", { name: "En ole tekninen" }).click();
    const invoice = examples.getByRole("button", { name: "Laskun kentät" });
    await invoice.click();
    await expect(invoice).toHaveAttribute("aria-pressed", "true");
    await expect(input).toHaveValue(
      /^Taustani: en ole tekninen\..* Haluamme poimia toimittajien PDF-laskuista keskeiset kentät\.$/,
    );
    await expect(input).toBeFocused();

    // Another example takes its place; nothing is sent.
    await examples.getByRole("button", { name: "Kysymykset ohjeista" }).click();
    await expect(input).toHaveValue(/sisäisten ohjeidemme pohjalta\.$/);
    await expect(input).not.toHaveValue(/PDF-laskuista/);
    await expect(page.getByTestId("chat-message")).toHaveCount(0);

    // The user's own words: the examples step back, and the field stays put.
    const before = (await input.boundingBox())!;
    await input.fill("Lajittelemme asiakkaiden sähköpostit käsin.");
    await expect(examples).toBeHidden();
    const after = (await input.boundingBox())!;
    expect(after.y).toBe(before.y);

    await input.fill("");
    await expect(examples).toBeVisible();
  });

  test("the first message starts the conversation, and the workspace comes in at the specification", async ({
    page,
    request,
    baseURL,
  }) => {
    const id = await newLiveSession(page);
    const input = field(page);

    await input.fill("Lajittelemme asiakkaiden sähköpostit käsin.");
    await input.press("Enter");
    await expect(page.getByTestId("chat-start")).toHaveCount(0);
    await expect(send(page)).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId("chat-message")).toHaveCount(2);
    // Still the page: the wizard is gathering requirements.
    await expect(page.getByRole("main", { name: "Keskustelu" })).toBeVisible();
    await expect(page.getByTestId("workspace-phase")).toHaveCount(0);
    // The field is at the bottom of the conversation now.
    const input1 = (await input.boundingBox())!;
    expect(input1.y).toBeGreaterThan(700);

    // The wizard moves the session on during a reply; the page follows when
    // the reply ends, and the conversation keeps what was said. Marked here,
    // the chat and its log are the same elements once docked: a chat built
    // again would have lost a reply that was still arriving.
    await page.getByTestId("chat-dock").evaluate((el) => el.setAttribute("data-e2e-kept", "1"));
    await page.getByRole("log").evaluate((el) => el.setAttribute("data-e2e-kept", "1"));
    await setMockSessionStep(request, baseURL!, id, 3);
    await input.fill("Kentät: lähettäjä, aihe ja kiireellisyys.");
    await input.press("Enter");
    await expect(page.getByTestId("workspace-phase")).toHaveText("Spesifikaatio", {
      timeout: 30_000,
    });
    const docked = page.getByRole("complementary", { name: "Keskustelu" });
    await expect(docked).toBeVisible();
    await expect(docked.getByTestId("chat-message")).toHaveCount(4);
    await expect(docked).toHaveAttribute("data-e2e-kept", "1");
    await expect(docked.getByRole("log")).toHaveAttribute("data-e2e-kept", "1");
    await expect(docked.getByTestId("chat-dock-toggle")).toBeVisible();
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
  });

  test("with the mock store's checklist the chat stays docked beside it", async ({ page }) => {
    await loginAsDev(page);
    await page.locator("#session-title").fill(`checklist ${Date.now()}`);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    await expect(page.getByTestId("workspace-phase")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Keskustelu" })).toBeVisible();
    await expect(page.getByTestId("chat-start")).toHaveCount(0);
  });
});

test.describe("session start in the chat on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("the chat is the page, not a sheet over it, and the steps open above it", async ({
    page,
  }) => {
    await newLiveSession(page);

    const chat = page.getByRole("main", { name: "Keskustelu" });
    await expect(chat).toBeVisible();
    expect(await chat.evaluate((el) => getComputedStyle(el).position)).not.toBe("fixed");
    await expect(page.getByRole("heading", { name: "Mitä haluat ratkaista?" })).toBeVisible();
    await expect(page.getByTestId("chat-examples").getByRole("button")).toHaveCount(4);
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);

    // The steps column is hidden here; the step line opens the list. The
    // start view no longer fits under it: it starts below the list and
    // scrolls in its own box, instead of being drawn over the steps.
    await page.getByTestId("steps-disclosure").click();
    const steps = page.getByRole("navigation", { name: "Vaiheet" });
    await expect(steps).toBeVisible();
    const list = (await steps.boundingBox())!;
    const heading = page.getByRole("heading", { name: "Mitä haluat ratkaista?" });
    const top = (await heading.boundingBox())!;
    expect(top.y).toBeGreaterThanOrEqual(list.y + list.height);
    // Everything in the start view can be reached: the last line scrolls into view.
    const notice = page.getByTestId("chat-ai-notice");
    await notice.scrollIntoViewIfNeeded();
    await expect(notice).toBeInViewport();
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(0);
  });
});
