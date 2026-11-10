import { test, expect, type Page, type Route } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Answering a round of the wizard's questions one field per question, and the
 * chat and the steps on a phone. The wizard's replies are faked here: the
 * chat request is answered by the test, so a round of questions, a busy
 * wizard and a slow reply can each be produced on demand.
 */

async function newSession(page: Page) {
  await loginAsDev(page);
  await page.locator("#session-title").fill(`questions ${Date.now()}`);
  await page.getByRole("button", { name: "Aloita uusi" }).click();
  await page.waitForURL(/\/sessions\//);
}

/** One reply as the chat route streams it. */
const reply = (text: string) => ({
  status: 200,
  contentType: "text/event-stream; charset=utf-8",
  body: `data: ${JSON.stringify({ delta: text })}\n\n`,
});
const BUSY = { status: 409, contentType: "application/json", body: "{}" };

/**
 * Answers the chat requests of the page: `answer` gets the message sent and
 * how many came before it. Returns the messages the page has sent, in order.
 */
async function fakeWizard(
  page: Page,
  answer: (message: string, earlier: number) => Parameters<Route["fulfill"]>[0] | Promise<Parameters<Route["fulfill"]>[0]>,
): Promise<string[]> {
  const sent: string[] = [];
  await page.route("**/api/sessions/*/chat", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const message = (route.request().postDataJSON() as { message: string }).message;
    sent.push(message);
    await route.fulfill(await answer(message, sent.length - 1));
  });
  return sent;
}

// The first item is not a question, so the agent's numbers (2–4) differ from
// the questions' places in the form; the last lines only look like questions.
const ROUND = [
  "Kiitos! Tarkennan vielä muutaman asian:",
  "",
  "1. Taustaksi: tiedot viedään lopuksi ERP:hen.",
  "2. Missä muodossa ostotilaukset saapuvat?",
  "3. Mitä järjestelmiä käytätte?",
  "4. Kuinka monta tilausta käsittelette päivässä?",
  "",
  "Esimerkkikutsu:",
  "",
  "```",
  "- curl https://example.com/haku?q=tilaus",
  "```",
  "",
  "- Rajapinnan kuvaus: https://example.com/api?versio=2",
].join("\n");

const ANSWERS = [
  "Vastaukseni kysymyksiisi (kysymykset lainattuina):",
  '2. "Missä muodossa ostotilaukset saapuvat?": PDF sähköpostilla',
  '3. "Mitä järjestelmiä käytätte?": SAP',
  "   Lemonsoft",
  '4. "Kuinka monta tilausta käsittelette päivässä?": ohita',
].join("\n");

const chatField = (page: Page) => page.locator('textarea[name="message"]');
const messages = (page: Page) => page.getByTestId("chat-message");
const ownMessages = (page: Page) => page.locator('[data-testid="chat-message"][data-role="user"]');

/** Asks for the round of questions and fills in the answer fields. */
async function openRoundAndAnswer(page: Page) {
  await chatField(page).fill("Haluan automatisoida ostotilausten käsittelyn.");
  await chatField(page).press("Enter");
  const open = page.getByTestId("chat-questions-open");
  await expect(open).toHaveText("Vastaa kysymyksiin yksitellen (3)");
  await open.click();
  const form = page.getByTestId("chat-questions");
  await form.getByLabel("2. Missä muodossa ostotilaukset saapuvat?").fill("PDF sähköpostilla");
  await form.getByLabel("3. Mitä järjestelmiä käytätte?").fill("SAP\nLemonsoft");
  await expect(form.getByLabel("4. Kuinka monta tilausta käsittelette päivässä?")).toHaveValue("");
  return form;
}

test.describe("answering a round of questions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("the answers go as one message under the agent's own numbers", async ({ page }) => {
    const sent = await fakeWizard(page, (_message, earlier) =>
      reply(earlier === 0 ? ROUND : "Kiitos, kirjasin vastauksesi."),
    );
    await newSession(page);
    const form = await openRoundAndAnswer(page);

    await form.getByRole("button", { name: "Lähetä vastaukset" }).click();
    await expect(messages(page).last()).toContainText("Kiitos, kirjasin vastauksesi.");
    expect(sent[1]).toBe(ANSWERS);
    // The answers are in the conversation as the user's message, and the
    // form is gone with the round it answered.
    await expect(ownMessages(page).filter({ hasText: "PDF sähköpostilla" })).toHaveCount(1);
    await expect(page.getByTestId("chat-questions")).toHaveCount(0);
    await expect(page.getByTestId("chat-questions-open")).toHaveCount(0);
  });

  test("answers that could not be sent stay in the form, which says so", async ({ page }) => {
    let busy = true;
    const sent = await fakeWizard(page, (_message, earlier) =>
      earlier === 0 ? reply(ROUND) : busy ? BUSY : reply("Kiitos, kirjasin vastauksesi."),
    );
    await newSession(page);
    const form = await openRoundAndAnswer(page);
    const first = form.getByLabel("2. Missä muodossa ostotilaukset saapuvat?");
    const second = form.getByLabel("3. Mitä järjestelmiä käytätte?");
    const send = form.getByRole("button", { name: "Lähetä vastaukset" });

    // The wizard is busy with another turn: the send waits and tries again
    // every five seconds for a minute. The test turns that minute over.
    await page.clock.install();
    await send.click();
    await expect.poll(() => sent.length).toBe(2);
    // While the answers are on their way the form is still there with them.
    await expect(form).toBeVisible();
    await expect(send).toHaveAttribute("aria-busy", "true");
    await expect(first).toHaveValue("PDF sähköpostilla");
    for (let attempt = 1; attempt <= 12; attempt++) {
      await page.clock.fastForward(5000);
      await expect.poll(() => sent.length).toBe(2 + attempt);
    }

    await expect(form.getByRole("alert")).toContainText("Vastauksiasi ei lähetetty, ja ne ovat tallessa tässä.");
    await expect(form.getByRole("alert")).toContainText("Wizard vastaa vielä edelliseen viestiin");
    await expect(first).toHaveValue("PDF sähköpostilla");
    await expect(second).toHaveValue("SAP\nLemonsoft");
    // What was not sent is not left in the conversation as if it had been.
    await expect(ownMessages(page).filter({ hasText: "PDF sähköpostilla" })).toHaveCount(0);
    await expect(messages(page).last()).toContainText("Kuinka monta tilausta käsittelette päivässä?");

    // The wizard is free again: the same answers go from the same form.
    busy = false;
    await send.click();
    await expect(messages(page).last()).toContainText("Kiitos, kirjasin vastauksesi.");
    expect(sent[sent.length - 1]).toBe(ANSWERS);
    await expect(page.getByTestId("chat-questions")).toHaveCount(0);
  });
});

test.describe("an answer from the requirement checklist", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("is called sent only once the wizard has started on it", async ({ page }) => {
    let start: () => void = () => {};
    const started = new Promise<void>((resolve) => (start = resolve));
    const sent = await fakeWizard(page, async () => {
      await started;
      return reply("Kiitos, kirjasin vastauksen.");
    });
    await newSession(page);

    await page.getByRole("button", { name: "Vastaa tähän" }).first().click();
    await page.getByPlaceholder("Kirjoita vastauksesi…").fill("Ostotilausten käsittely.");
    await page.getByRole("button", { name: "Lähetä vastaus" }).click();

    await expect.poll(() => sent.length).toBe(1);
    await expect(page.getByText("Lähetetään…")).toBeVisible();
    await expect(page.getByText("Lähetetty chattiin")).toHaveCount(0);
    start();
    await expect(page.getByText("Lähetetty chattiin")).toBeVisible();
    await expect(page.getByText("Lähetetään…")).toHaveCount(0);
  });
});

test.describe("the chat and the steps on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("a chat closed in the middle of a reply shows the reply when opened again", async ({ page }) => {
    let finish: () => void = () => {};
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const sent = await fakeWizard(page, async () => {
      await finished;
      return reply("Selvä, jatketaan siitä.");
    });
    await newSession(page);
    const dock = page.getByTestId("chat-dock");

    await chatField(page).fill("Haluan automatisoida ostotilausten käsittelyn.");
    await chatField(page).press("Enter");
    await expect.poll(() => sent.length).toBe(1);
    await page.getByTestId("chat-dock-toggle").click();
    await expect(dock).toHaveAttribute("data-chat-open", "false");
    await expect(dock).toBeHidden();

    await page.locator("[data-open-chat]").first().click();
    await expect(dock).toHaveAttribute("data-chat-open", "true");
    await expect(ownMessages(page).filter({ hasText: "Haluan automatisoida ostotilausten käsittelyn." })).toBeVisible();
    finish();
    await expect(messages(page).last()).toContainText("Selvä, jatketaan siitä.");
    await expect(messages(page).last()).toBeInViewport();
  });

  test("the steps opened under the title leave the step's view in the window", async ({ page }) => {
    await newSession(page);
    await page.getByTestId("chat-dock-toggle").click();
    await page.getByTestId("steps-disclosure").click();
    const steps = page.getByRole("navigation", { name: "Vaiheet" });
    const closed = steps.locator('button[aria-expanded="false"]');
    while ((await closed.count()) > 0) await closed.first().click();

    // Every stage is open: the list scrolls inside its card, and the step's
    // title and view below it are still in the window.
    expect(await steps.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    const title = page.getByTestId("workspace-phase");
    await expect(title).toBeInViewport({ ratio: 1 });
    const below = await title.evaluate((el) => window.innerHeight - el.getBoundingClientRect().bottom);
    expect(below).toBeGreaterThan(150);
  });
});
