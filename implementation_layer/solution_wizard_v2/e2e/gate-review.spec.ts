import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { recordChatReferences } from "./helpers/chat-reference";
import { setMockSessionStep } from "./helpers/dev-step";
import { resetMockSessions } from "./helpers/mock";

// A gate action is a server action: on a busy dev server it takes a few seconds.
const AFTER_ACTION = { timeout: 20_000 };

/**
 * The gate decision bar (GateDecisionBar) at Gate 1 and at Gates 2–4, the
 * Gate 1 review's items, and the gate timeline. Each test uses its own
 * e2e-only mock fixture (lib/mock-sessions.ts), so approving or rejecting one
 * never affects another test.
 *
 * A change request and a rejection both go to the wizard through the chat: the
 * request as a reference the user writes under, the rejection's reason as a
 * chat turn. Neither posts a canned reply into the transcript any more.
 */
test.describe("Gate 1 review", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("approve is disabled until business context is captured", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 1: vaatimukset");
    const bar = page.getByTestId("gate1-actions");
    await expect(bar.getByRole("button", { name: "Hyväksy vaatimukset" })).toBeDisabled();

    // The hint names what's missing so the SME knows what to keep answering.
    await expect(bar).toContainText("Puuttuu: Nykyprosessi, Odotettu arvo");
  });

  test("reject marks the gate rejected and sends the reason to the wizard as a chat turn", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    const bar = page.getByTestId("gate1-actions");
    await bar.getByRole("button", { name: "Hylkää…" }).click();
    const form = page.getByTestId("gate-reject-form");
    const reason = "Vaatimukset eivät vastaa prosessia.";
    await form.getByLabel("Miksi hylkäät? (pakollinen)").fill(reason);
    await form.getByRole("button", { name: "Hylkää gate" }).click();

    // The gate stays on its step, marked rejected in the bar and the timeline.
    await expect(bar.getByText(/Hylkäsit tämän gaten/)).toBeVisible(AFTER_ACTION);
    await expect(page.getByRole("navigation", { name: "Vaiheet" }).getByText("Hylätty")).toBeVisible();
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();
    // The reason is a chat turn that names the gate, so the agent reads it.
    await expect(page.getByRole("log")).toContainText(`Hylkään Gate 1:n (vaatimukset): ${reason}`, AFTER_ACTION);
    await expect(form).toBeHidden();
  });

  test("a rejection needs a reason, and Escape closes its form", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    const bar = page.getByTestId("gate1-actions");
    const toggle = bar.getByRole("button", { name: "Hylkää…" });
    await toggle.click();
    const form = page.getByTestId("gate-reject-form");
    const reason = form.getByLabel("Miksi hylkäät? (pakollinen)");
    await expect(reason).toBeFocused();
    await form.getByRole("button", { name: "Hylkää gate" }).click();
    await expect(reason).toHaveJSProperty("validity.valid", false);
    await expect(bar.getByText(/Hylkäsit tämän gaten/)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test("request changes takes the gate to the chat as a reference, with no form", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");
    const references = await recordChatReferences(page);

    await page.getByTestId("gate1-actions").getByRole("button", { name: "Pyydä muutoksia" }).click();

    expect(await references()).toEqual([
      {
        key: "gate:4",
        label: "Gate 1 · Vaatimukset",
        prefix: "Muutospyyntö ennen Gate 1:n (vaatimukset) hyväksyntää:",
      },
    ]);
    // The session stays on the gate, and nothing is written for the user.
    await expect(page.getByTestId("gate-reject-form")).toHaveCount(0);
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();
    await expect(page.getByText(/Muutospyyntö kirjattu/)).toHaveCount(0);
  });

  test("business context and open assumptions render", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    // The timeline's card names the same topics, so look in the workspace.
    const review = page.getByRole("main");
    await expect(review.getByText("Liiketoimintakonteksti", { exact: true })).toBeVisible();
    await expect(
      review.getByText("Three people manually review invoices every morning."),
    ).toBeVisible();
    await expect(review.getByText("Faster processing")).toBeVisible();

    await expect(review.getByText("Avoimet oletukset", { exact: true })).toBeVisible();
    await expect(review.getByText("Invoices arrive as PDF email attachments.")).toBeVisible();
    await expect(review.getByText("Currency is always EUR.")).toBeVisible();
    // One confirmed, one not — the counter in the card header reflects it.
    await expect(review.getByText("1 / 2 kuitattu")).toBeVisible();
  });

  test("an assumption and a business-context item go to the chat as quoted references", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");
    const references = await recordChatReferences(page);

    await page.getByRole("button", { name: "Muuta chatissa: Oletus 2" }).click();
    await page.getByRole("button", { name: "Muuta chatissa: Nykyprosessi" }).click();

    expect(await references()).toEqual([
      {
        key: "assumption:a2",
        label: "Oletus 2",
        prefix: 'Koskee oletusta 2, lainattuna: "Currency is always EUR."',
      },
      {
        key: "bc:currentProcess",
        label: "Nykyprosessi",
        prefix:
          'Koskee liiketoimintakontekstin kohtaa Nykyprosessi, lainattuna: "Three people manually review invoices every morning."',
      },
    ]);
  });

  test("approve advances past the gate once context is complete", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    const approveButton = page.getByTestId("gate1-actions").getByRole("button", { name: "Hyväksy vaatimukset" });
    await expect(approveButton).toBeEnabled();
    await approveButton.click();

    await expect(page.getByText("VAIHE 5 / 13")).toBeVisible(AFTER_ACTION);
  });
});

test.describe("Gates 2–4 — the same decision bar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("Gate 2 says what to do now, keeps its decision in view and opens the chat beside it", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 2: ratkaisun rakenne");
    // One line under the title instead of the generic gate banner: what to
    // check. The approval is asked once, by its button.
    await expect(page.getByTestId("now-line")).toHaveText("Tarkista työnkulku ja blueprint.");
    await expect(page.getByText("Tämä on gate-vaihe")).toHaveCount(0);

    const bar = page.getByTestId("gate2-actions");
    await expect(bar).toBeInViewport();
    await expect(bar.getByRole("button", { name: "Hyväksy ratkaisun rakenne" })).toBeInViewport();
    await expect(bar).toContainText("Hyväksynnän jälkeen wizard rakentaa tästä rakenteesta PoC-paketin.");
    // The agent's summary of the gate is in the chat: it starts open here,
    // though the chat is collapsed from the workflow step on.
    await expect(page.getByTestId("chat-dock")).toHaveAttribute("data-chat-open", "true");
  });

  test("approve advances past Gate 2 to a step with no way back", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    await page.getByTestId("gate2-actions").getByRole("button", { name: "Hyväksy ratkaisun rakenne" }).click();

    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible(AFTER_ACTION);
    await expect(page.getByTestId("gate2-actions")).toHaveCount(0);
    // Between gates there is no step back, and "next step" is a quiet fallback.
    await expect(page.getByRole("button", { name: "Edellinen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Seuraava vaihe" })).toBeVisible();
  });

  test("request changes at Gate 2 references the gate in the chat", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");
    const references = await recordChatReferences(page);

    await page.getByTestId("gate2-actions").getByRole("button", { name: "Pyydä muutoksia" }).click();

    expect(await references()).toEqual([
      {
        key: "gate:9",
        label: "Gate 2 · Ratkaisun rakenne",
        prefix: "Muutospyyntö ennen Gate 2:n (ratkaisun rakenne) hyväksyntää:",
      },
    ]);
  });

  test("a rejected Gate 2 tells the wizard why and can still be approved", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    const bar = page.getByTestId("gate2-actions");
    await bar.getByRole("button", { name: "Hylkää…" }).click();
    const form = page.getByTestId("gate-reject-form");
    const reason = "Tarkastus puuttuu ennen tallennusta.";
    await form.getByLabel("Miksi hylkäät? (pakollinen)").fill(reason);
    await form.getByRole("button", { name: "Hylkää gate" }).click();

    await expect(bar.getByText(/Hylkäsit tämän gaten/)).toBeVisible(AFTER_ACTION);
    await expect(page.getByRole("log")).toContainText(`Hylkään Gate 2:n (ratkaisun rakenne): ${reason}`, AFTER_ACTION);
    await expect(page.getByText("VAIHE 9 / 13")).toBeVisible();

    await bar.getByRole("button", { name: "Hyväksy ratkaisun rakenne" }).click();
    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible(AFTER_ACTION);
  });

  test("the timeline shows the stages at a glance, and what an approval checks and a change to an approved stage behind a press", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    const timeline = page.getByRole("navigation", { name: "Vaiheet" });
    await expect(timeline.getByTestId("timeline-stage-2")).toHaveAttribute("aria-expanded", "true");
    // The gate's row is named by its decision.
    await expect(timeline.getByText("Hyväksy ratkaisun rakenne")).toBeVisible();

    // At a glance a stage is its mark and its topic: no gate tag, no status
    // word, no step count, and no card that repeats the line above the workspace.
    await expect(page.getByTestId("timeline-now")).toHaveCount(0);
    await expect(page.getByTestId("timeline-stage-1")).toHaveText("Vaatimukset");
    await expect(page.getByTestId("timeline-stage-2")).toHaveText("2Ratkaisun rakenne");
    await expect(timeline).not.toContainText("Hyväksynnässä tarkistat:");
    await expect(page.getByTestId("now-line")).not.toContainText("Nyt");

    // What the approval checks is behind its own control on the gate's row.
    const checksToggle = timeline.getByRole("button", { name: "Hyväksynnässä tarkistat: Ratkaisun rakenne" });
    await expect(checksToggle).toHaveAttribute("aria-expanded", "false");
    await checksToggle.click();
    await expect(page.getByTestId("gate-checks-2").getByRole("listitem")).toHaveText([
      "Komponentit vaiheittain",
      "Blueprint: vaiheet, syötteet ja tulokset",
      "Työnkulkukaavio ja roolit",
    ]);

    // Gate 1 is approved: its stage opens on a press, and a change there
    // reopens it (asked first), and then goes to the wizard through the chat.
    const references = await recordChatReferences(page);
    await expect(page.getByRole("button", { name: "Muuta hyväksyttyä vaihetta: Vaatimukset" })).toHaveCount(0);
    await page.getByTestId("timeline-stage-1").click();
    await page.getByRole("button", { name: "Muuta hyväksyttyä vaihetta: Vaatimukset" }).click();
    expect(await references()).toEqual([]);
    await page.getByTestId("gate-reopen-1").getByRole("button", { name: "Avaa uudelleen" }).click();
    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 1: vaatimukset", AFTER_ACTION);
    expect(await references()).toEqual([
      {
        key: "gate:4",
        label: "Gate 1 · Vaatimukset",
        prefix: "Haluan muuttaa hyväksyttyä vaihetta Gate 1 (vaatimukset):",
      },
    ]);
  });

  test("a gate that is already approved offers the way on, not a second approval", async ({
    page,
    request,
    baseURL,
  }) => {
    // This session has passed Gate 2. Put it back on that step, as a step
    // moved back by the agent or through the API leaves it.
    await setMockSessionStep(request, baseURL as string, "ses_laskut", 9);
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");

    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 2: ratkaisun rakenne");
    await expect(page.getByTestId("now-line")).toContainText(
      "Gate 2 on jo hyväksytty. Jatka seuraavaan vaiheeseen.",
    );
    await expect(page.getByTestId("gate2-actions")).toHaveCount(0);

    await page.getByRole("button", { name: "Seuraava vaihe" }).click();
    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible(AFTER_ACTION);
  });

  test("approving Gate 4 ends the work: no bar, no next step, and the package named", async ({
    page,
    request,
    baseURL,
  }) => {
    await setMockSessionStep(request, baseURL as string, "ses_laskut", 13);
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");

    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 4: luovutus");
    const bar = page.getByTestId("gate4-actions");
    await expect(bar).toContainText("Hyväksyntä päättää työn, ja käyttöönottopaketin voi ladata.");
    await bar.getByRole("button", { name: "Hyväksy luovutus" }).click();

    await expect(page.getByTestId("solution-done")).toBeVisible(AFTER_ACTION);
    await expect(page.getByTestId("gate4-actions")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Seuraava vaihe" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edellinen" })).toHaveCount(0);
    // This session has no successful test run, so the line says how to get the package.
    await expect(page.getByTestId("now-line")).toContainText(
      "Kaikki gatet on hyväksytty. Aja vielä testi PoC-välilehdellä, niin käyttöönottopaketin voi ladata.",
    );
    // Nothing is left to check, so the last stage has no checklist to open.
    await expect(page.getByTestId("gate-checks-toggle-4")).toHaveCount(0);
  });

  test("a test run that succeeded is approved from the PoC step, without Next step", async ({
    page,
    request,
    baseURL,
  }) => {
    // The step follows the files the wizard writes, and a test run is not one:
    // the session stays on the PoC step when the run has succeeded.
    await setMockSessionStep(request, baseURL as string, "ses_laskut", 10);
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");
    await expect(page.getByTestId("workspace-phase")).toHaveText("PoC");
    // No run yet: nothing to approve, and the quiet way on stays.
    await expect(page.getByTestId("gate3-actions")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Seuraava vaihe" })).toBeVisible();

    await setMockSessionStep(request, baseURL as string, "ses_laskut", 10, "run-1");
    await page.reload();
    await expect(page.getByTestId("now-line")).toHaveText("Testi onnistui. Tarkista tulos PoC-välilehdellä.");
    await expect(page.getByRole("button", { name: "Seuraava vaihe" })).toHaveCount(0);
    const bar = page.getByTestId("gate3-actions");
    await bar.getByRole("button", { name: "Hyväksy testiajo" }).click();

    // Approved in one press: the session is past Gate 3.
    await expect(page.getByText("VAIHE 12 / 13")).toBeVisible(AFTER_ACTION);
    await expect(page.getByTestId("gate-ring")).toHaveAccessibleName("3/4 gatea hyväksytty");
  });

  test("after Gate 3 the handover is approved from the documentation step, once the wizard has replied", async ({
    page,
  }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");
    await page.getByTestId("gate3-actions").getByRole("button", { name: "Hyväksy testiajo" }).click();

    await expect(page.getByText("VAIHE 12 / 13")).toBeVisible(AFTER_ACTION);
    await expect(page.getByTestId("workspace-phase")).toHaveText("Dokumentaatio");
    // The wizard answers the approval; then Gate 4's decision is here, with no
    // "Next step" to find first.
    const bar = page.getByTestId("gate4-actions");
    await expect(bar.getByRole("button", { name: "Hyväksy luovutus" })).toBeVisible(AFTER_ACTION);
    await expect(page.getByRole("button", { name: "Seuraava vaihe" })).toHaveCount(0);
    await bar.getByRole("button", { name: "Hyväksy luovutus" }).click();

    await expect(page.getByTestId("solution-done")).toBeVisible(AFTER_ACTION);
    await expect(page.getByTestId("gate-ring")).toHaveAccessibleName("4/4 gatea hyväksytty");
  });

  test("the wizard's reply at a gate carries the approval", async ({ page, request, baseURL }) => {
    // ses_chatbot has a conversation that ends in the wizard's reply.
    await setMockSessionStep(request, baseURL as string, "ses_chatbot", 9);
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");
    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 2: ratkaisun rakenne");

    // The same decision in the same words as the bar under the workspace.
    const inChat = page.getByTestId("chat-gate-action").getByRole("button", { name: "Hyväksy ratkaisun rakenne" });
    await expect(inChat).toBeVisible();
    await expect(page.getByTestId("gate2-actions").getByRole("button", { name: "Hyväksy ratkaisun rakenne" })).toBeVisible();
    await expect(page.getByTestId("chat-gate-action")).toHaveCount(1);
    await inChat.click();

    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible(AFTER_ACTION);
    await expect(page.getByTestId("chat-event")).toContainText("Gate 2 hyväksytty", AFTER_ACTION);
    await expect(page.getByTestId("chat-gate-action")).toHaveCount(0);
  });

  test("Gate 3 asks for the test run before the approval", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");

    await expect(page.getByTestId("workspace-phase")).toHaveText("Gate 3: testiajo");
    // No successful run yet: the line names the run, not the approval.
    await expect(page.getByTestId("now-line")).toContainText(
      "Tarkista testiajon tulos PoC-välilehdellä. Kerro chatissa, jos jotain pitää muuttaa.",
    );
    await expect(
      page.getByTestId("gate3-actions").getByRole("button", { name: "Hyväksy testiajo" }),
    ).toBeVisible();
  });
});
