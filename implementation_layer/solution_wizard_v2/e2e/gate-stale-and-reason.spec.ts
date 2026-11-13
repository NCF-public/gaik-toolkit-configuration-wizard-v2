import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { setMockSessionStep } from "./helpers/dev-step";
import { resetMockSessions } from "./helpers/mock";

// A gate action is a server action: on a busy dev server it takes a few seconds.
const AFTER_ACTION = { timeout: 20_000 };

const MOVED = "Sessio oli jo edennyt toisessa ikkunassa, joten päätöstäsi ei tallennettu.";

/**
 * A gate decision made on a page the session has already left (another tab
 * decided first), and a rejection's reason that did not reach the wizard.
 * Each test uses its own e2e-only mock fixture (lib/mock-sessions.ts).
 */

// Answers POST /chat as wizard_api streams it, and collects what was sent.
// While `failing` is set the chat answers 500 instead.
async function fakeChat(page: Page) {
  const state = { sent: [] as string[], failing: false };
  await page.route("**/api/sessions/*/chat", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (state.failing) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    state.sent.push((route.request().postDataJSON() as { message: string }).message);
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ delta: "Selvä." })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`,
    });
  });
  return state;
}

async function rejectWith(page: Page, gate: number, reason: string) {
  await page.getByTestId(`gate${gate}-actions`).getByRole("button", { name: "Hylkää…" }).click();
  const form = page.getByTestId("gate-reject-form");
  await form.getByLabel("Miksi hylkäät? (pakollinen)").fill(reason);
  await form.getByRole("button", { name: "Hylkää gate" }).click();
}

test.describe("a gate decision on a page the session has left", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("an approval from a page left open approves nothing and says so", async ({ page, context }) => {
    await loginAsDev(page);
    const chat = await fakeChat(page);
    await page.goto("/sessions/ses_gate2_pending");
    await expect(page.getByText("VAIHE 9 / 13")).toBeVisible();

    // Another tab approves Gate 2 and goes on to the next gate's step.
    const other = await context.newPage();
    await fakeChat(other);
    await other.goto("/sessions/ses_gate2_pending");
    await other.getByTestId("gate2-actions").getByRole("button", { name: "Hyväksy ratkaisun rakenne" }).click();
    await expect(other.getByText("VAIHE 10 / 13")).toBeVisible(AFTER_ACTION);
    await other.close();

    await page.getByTestId("gate2-actions").getByRole("button", { name: "Hyväksy ratkaisun rakenne" }).click();
    await expect(page.getByText(MOVED)).toBeVisible(AFTER_ACTION);
    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible();
    await expect(page).toHaveURL(/notice=gate_moved/);
    // The agent is told about no approval from this page.
    expect(chat.sent).toEqual([]);
  });

  test("a rejection from a page left open rejects nothing and says so", async ({ page, context }) => {
    await loginAsDev(page);
    const chat = await fakeChat(page);
    await page.goto("/sessions/ses_gate2_pending");
    await expect(page.getByText("VAIHE 9 / 13")).toBeVisible();

    const other = await context.newPage();
    await fakeChat(other);
    await other.goto("/sessions/ses_gate2_pending");
    await other.getByTestId("gate2-actions").getByRole("button", { name: "Hyväksy ratkaisun rakenne" }).click();
    await expect(other.getByText("VAIHE 10 / 13")).toBeVisible(AFTER_ACTION);
    await other.close();

    await rejectWith(page, 2, "Tarkastus puuttuu.");
    await expect(page.getByText(MOVED)).toBeVisible(AFTER_ACTION);
    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Vaiheet" }).getByText("Hylätty")).toHaveCount(0);
    expect(chat.sent).toEqual([]);
  });

  test("an approved Gate 4 is not rejected from a page left open", async ({ page, context, request, baseURL }) => {
    await setMockSessionStep(request, baseURL as string, "ses_laskut", 13);
    await loginAsDev(page);
    const chat = await fakeChat(page);
    await page.goto("/sessions/ses_laskut");
    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 4: luovutus");

    const other = await context.newPage();
    await fakeChat(other);
    await other.goto("/sessions/ses_laskut");
    await other.getByTestId("gate4-actions").getByRole("button", { name: "Hyväksy luovutus" }).click();
    await expect(other.getByTestId("solution-done")).toBeVisible(AFTER_ACTION);
    await other.close();

    await rejectWith(page, 4, "Paketti puuttuu.");
    await expect(page.getByText(MOVED)).toBeVisible(AFTER_ACTION);
    // The work stays finished.
    await expect(page.getByTestId("solution-done")).toBeVisible();
    await expect(page.getByTestId("gate4-actions")).toHaveCount(0);
    expect(chat.sent).toEqual([]);
  });
});

test.describe("a rejection's reason and the wizard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("the reason is a chat turn the wizard receives", async ({ page }) => {
    await loginAsDev(page);
    const chat = await fakeChat(page);
    await page.goto("/sessions/ses_gate2_pending");

    const reason = "Tarkastus puuttuu ennen tallennusta.";
    await rejectWith(page, 2, reason);
    const bar = page.getByTestId("gate2-actions");
    await expect(bar.getByText(/Hylkäsit tämän gaten/)).toBeVisible(AFTER_ACTION);
    await expect.poll(() => chat.sent, AFTER_ACTION).toEqual([`Hylkään Gate 2:n (ratkaisun rakenne): ${reason}`]);
    await expect(bar.getByText("Perustelu ei lähtenyt wizardille.")).toHaveCount(0);

    // Delivered, so a reload has nothing to offer again.
    await page.reload();
    await expect(bar.getByText(/Hylkäsit tämän gaten/)).toBeVisible();
    await expect(bar.getByRole("button", { name: "Lähetä uudelleen" })).toHaveCount(0);
  });

  test("a reason that did not reach the wizard is offered again, also after a reload", async ({ page }) => {
    await loginAsDev(page);
    const chat = await fakeChat(page);
    chat.failing = true;
    await page.goto("/sessions/ses_gate2_pending");

    const reason = "Tarkastus puuttuu ennen tallennusta.";
    await rejectWith(page, 2, reason);
    const bar = page.getByTestId("gate2-actions");
    await expect(bar.getByText("Perustelu ei lähtenyt wizardille.")).toBeVisible(AFTER_ACTION);
    // The bar does not say the wizard answers a reason it never got.
    await expect(bar.getByText(/Wizard vastaa perusteluusi/)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Vaiheet" }).getByText("Hylätty")).toBeVisible();

    await page.reload();
    await expect(bar.getByText("Perustelu ei lähtenyt wizardille.")).toBeVisible();
    await expect(bar.getByText(/Wizard vastaa perusteluusi/)).toHaveCount(0);

    chat.failing = false;
    await bar.getByRole("button", { name: "Lähetä uudelleen" }).click();
    await expect.poll(() => chat.sent, AFTER_ACTION).toEqual([`Hylkään Gate 2:n (ratkaisun rakenne): ${reason}`]);
    await expect(bar.getByText(/Hylkäsit tämän gaten/)).toBeVisible();
    await expect(bar.getByRole("button", { name: "Lähetä uudelleen" })).toHaveCount(0);
  });

  test("an approval removes the chip of its own gate only", async ({ page }) => {
    await loginAsDev(page);
    const chat = await fakeChat(page);
    await page.goto("/sessions/ses_gate2_pending");
    // Sent again until the page listens (it may still be loading its scripts).
    await expect(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("gaik-wizard:chat-reference", {
            detail: { key: "gate:4", label: "Gate 1 · Vaatimukset", prefix: "Muutospyyntö Gate 1:een:" },
          }),
        ),
      );
      await expect(page.getByTestId("chat-reference")).toContainText("Gate 1", { timeout: 1000 });
    }).toPass(AFTER_ACTION);

    await page.getByTestId("gate2-actions").getByRole("button", { name: "Hyväksy ratkaisun rakenne" }).click();
    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible(AFTER_ACTION);
    await expect.poll(() => chat.sent, AFTER_ACTION).toEqual(["Gate 2 hyväksytty paneelista, jatka."]);
    await expect(page.getByTestId("chat-reference")).toContainText("Gate 1");
  });

  test("the wake-up leaves the address, the open tab stays in it", async ({ page }) => {
    await loginAsDev(page);
    const chat = await fakeChat(page);
    await page.goto("/sessions/ses_ui_basics?wake=1&tab=blueprint");
    await expect.poll(() => chat.sent, AFTER_ACTION).toEqual(["Gate 1 hyväksytty paneelista, jatka."]);
    await expect(page).toHaveURL(/\/sessions\/ses_ui_basics\?tab=blueprint$/);
  });
});
