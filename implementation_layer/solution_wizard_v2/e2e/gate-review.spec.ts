import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Gate 1 review (Gate1Review.tsx) and the generic Gate 2 approve bar —
 * previously untested beyond an incidental best-effort "click approve if
 * visible" inside the BPMN demo specs. Each test uses its own dedicated
 * e2e-only mock fixture (lib/mock-sessions.ts) so approving/rejecting one
 * never affects another test.
 */
test.describe("Gate 1 review", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("approve is disabled until business context is captured", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    await expect(page.getByRole("heading", { name: "Gate 1", exact: true })).toBeVisible();
    const approveButton = page.getByRole("button", { name: /Hyväksy vaatimukset/ });
    await expect(approveButton).toBeDisabled();

    // The hint names what's missing so the SME knows what to keep answering.
    await expect(page.getByText("Nykyprosessi")).toBeVisible();
    await expect(page.getByText("Odotettu arvo")).toBeVisible();
  });

  // These two pinned the #126 bug as it was: reject left no visible trace and
  // request-changes dropped the reviewer back a step. #149 fixed both, so they
  // now pin the fixed behaviour instead — the intentional test change the
  // original comment asked for.
  test("reject records the reason and shows the rejected state (#126)", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    const reason = "Vaatimukset eivät vastaa prosessia.";
    await page.getByLabel("Mitä pitää muuttaa? (pakollinen)").fill(reason);
    await page.getByRole("button", { name: "Hylkää" }).click();

    await expect(page.getByText(/Tämä gate on hylätty/)).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();
  });

  test("request changes stays on the gate and records the reason (#126)", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    const reason = "Syöte tulee ääniviestinä, ei tekstinä.";
    await page.getByLabel("Mitä pitää muuttaa? (pakollinen)").fill(reason);
    await page.getByRole("button", { name: "Pyydä muutoksia" }).click();

    // The old behaviour was moveTo(step - 1) — VAIHE 3 / 13. It now stays.
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(/Muutospyyntö kirjattu/)).toBeVisible();
  });

  test("neither objection can be submitted without a reason (#126)", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_blocked");

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    const reason = page.getByLabel("Mitä pitää muuttaa? (pakollinen)");
    await page.getByRole("button", { name: "Pyydä muutoksia" }).click();
    await expect(reason).toHaveJSProperty("validity.valid", false);
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();
  });

  test("business context and open assumptions render", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    await expect(page.getByText("Liiketoimintakonteksti")).toBeVisible();
    await expect(
      page.getByText("Three people manually review invoices every morning."),
    ).toBeVisible();
    await expect(page.getByText("Faster processing")).toBeVisible();

    await expect(page.getByText("Avoimet oletukset")).toBeVisible();
    await expect(page.getByText("Invoices arrive as PDF email attachments.")).toBeVisible();
    await expect(page.getByText("Currency is always EUR.")).toBeVisible();
    // One confirmed, one not — the counter in the card header reflects it.
    await expect(page.getByText("1 / 2 kuitattu")).toBeVisible();
  });

  test("approve advances past the gate once context is complete", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate1_ready");

    const approveButton = page.getByRole("button", { name: /Hyväksy vaatimukset/ });
    await expect(approveButton).toBeEnabled();
    await approveButton.click();

    await expect(page.getByText("VAIHE 5 / 13")).toBeVisible();
  });
});

test.describe("Gate 2 — generic approve/reject/request-changes bar", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("approve advances past Gate 2", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_gate2_pending");

    await expect(page.getByText("Tämä on gate-vaihe")).toBeVisible();
    await page.getByRole("button", { name: /Hyväksy gate/ }).click();

    await expect(page.getByText("VAIHE 10 / 13")).toBeVisible();
  });
});
