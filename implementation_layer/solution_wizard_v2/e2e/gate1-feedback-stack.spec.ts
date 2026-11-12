import { test, expect, type Page } from "@playwright/test";
import { DEV_USERS, loginAsDev } from "./helpers/auth";
import { getWizardApiUrl, setApiSessionStep, waitForApiHealthy } from "./helpers/api";
import { recordChatReferences } from "./helpers/chat-reference";
import { createSession } from "./helpers/session";

const STACK_E2E = process.env.PLAYWRIGHT_STACK_E2E === "true";

function sessionIdFromPath(url: string): string {
  return new URL(url).pathname.split("/").pop() as string;
}

// A new session put on Gate 1 (step 4). Gathering (1–3) is advanced by the
// agent, not from the UI, so the step is set through the API.
async function newSessionAtGate1(page: Page, request: Parameters<typeof setApiSessionStep>[0], title: string) {
  await loginAsDev(page, DEV_USERS.primary);
  await createSession(page, `${title} ${Date.now()}`);
  const id = sessionIdFromPath(page.url());
  await setApiSessionStep(request, id, 4);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 1: vaatimukset");
  return id;
}

// Records the messages the page hands to the chat to send (CHAT_SEND_EVENT).
async function recordChatSends(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const store = window as unknown as { __chatSends: string[] };
    store.__chatSends = [];
    window.addEventListener("gaik-wizard:chat-send", (e) => {
      store.__chatSends.push((e as CustomEvent<string>).detail);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __chatSends: string[] }).__chatSends);
}

async function gate1Status(request: Parameters<typeof setApiSessionStep>[0], id: string): Promise<string> {
  const detail = await (await request.get(`${getWizardApiUrl()}/sessions/${id}`)).json();
  return detail.gate_statuses.gate_1;
}

/**
 * #126 and its follow-up — Gate 1 "Request changes" / "Reject" against the
 * real stack (UI + wizard_api + Postgres), so the assertions cover the API
 * path rather than the in-memory mock store.
 *
 * Run via Docker: ./scripts/docker-test.sh --step stack-e2e
 *
 * Both objections used to append to the stored transcript through POST
 * /messages, which the live agent never reads, with a canned reply. Now a
 * change request is written in the chat itself (the bar hands the gate over as
 * a reference), and a rejection marks the gate rejected and sends its reason
 * as a chat turn. What must not happen again:
 *   - "Request changes" moving the session back to step 3.
 *   - A rejection with no reason, or one that leaves no trace in the UI.
 *   - A canned acknowledgement nobody wrote.
 */
test.describe("#126 Gate 1 objections reach the agent through the chat (stack)", () => {
  test.skip(!STACK_E2E, "set PLAYWRIGHT_STACK_E2E=true (docker-test.sh --step stack-e2e)");

  test.beforeAll(async ({ request }) => {
    await waitForApiHealthy(request);
  });

  test("request changes stays on the gate and hands it to the chat", async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await newSessionAtGate1(page, request, "Gate1 feedback");
    const references = await recordChatReferences(page);

    await page.getByTestId("gate1-actions").getByRole("button", { name: "Pyydä muutoksia" }).click();

    expect(await references()).toEqual([
      {
        key: "gate:4",
        label: "Gate 1 · Vaatimukset",
        prefix: "Muutospyyntö ennen Gate 1:n (vaatimukset) hyväksyntää:",
      },
    ]);
    // The session stays on Gate 1, the gate stays open, and nothing was
    // written into the transcript on the user's behalf.
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();
    expect(await gate1Status(request, id)).toBe("pending");
    await expect(page.getByText(/Muutospyyntö kirjattu/)).toHaveCount(0);
  });

  test("reject needs a reason, marks the gate rejected and sends the reason as a chat turn", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const id = await newSessionAtGate1(page, request, "Gate1 reject");
    const sends = await recordChatSends(page);

    const bar = page.getByTestId("gate1-actions");
    await bar.getByRole("button", { name: "Hylkää…" }).click();
    const form = page.getByTestId("gate-reject-form");
    const field = form.getByLabel("Miksi hylkäät? (pakollinen)");

    // An empty rejection is refused by the form itself — nothing is submitted.
    await form.getByRole("button", { name: "Hylkää gate" }).click();
    await expect(field).toHaveJSProperty("validity.valid", false);
    expect(await gate1Status(request, id)).toBe("pending");

    const reason = "Vaatimukset eivät vastaa sitä, mitä prosessissa oikeasti tehdään.";
    await field.fill(reason);
    await form.getByRole("button", { name: "Hylkää gate" }).click();

    await expect(bar.getByText(/Hylkäsit tämän gaten/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();
    expect(await gate1Status(request, id)).toBe("rejected");
    // The reason goes to the agent as a chat turn that names the gate.
    expect(await sends()).toEqual([`Hylkään Gate 1:n (vaatimukset): ${reason}`]);
    await expect(page.getByText(/perustelu kirjattu/)).toHaveCount(0);
  });

  // Both in one session, in a row — the demo recording hit this and the second
  // one appeared to do nothing (#126 follow-up).
  test("a reject right after a change request still records", async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await newSessionAtGate1(page, request, "Gate1 both");
    const references = await recordChatReferences(page);
    const sends = await recordChatSends(page);

    const bar = page.getByTestId("gate1-actions");
    await bar.getByRole("button", { name: "Pyydä muutoksia" }).click();
    expect(await references()).toHaveLength(1);

    await bar.getByRole("button", { name: "Hylkää…" }).click();
    const form = page.getByTestId("gate-reject-form");
    const reason = "Eivät vastaa prosessia, hylätään.";
    await form.getByLabel("Miksi hylkäät? (pakollinen)").fill(reason);
    await form.getByRole("button", { name: "Hylkää gate" }).click();

    await expect(bar.getByText(/Hylkäsit tämän gaten/)).toBeVisible({ timeout: 15_000 });
    expect(await gate1Status(request, id)).toBe("rejected");
    expect(await sends()).toEqual([`Hylkään Gate 1:n (vaatimukset): ${reason}`]);
  });
});
