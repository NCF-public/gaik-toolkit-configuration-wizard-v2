import { test, expect } from "@playwright/test";
import { DEV_USERS, loginAsDev } from "./helpers/auth";
import { setApiSessionStep, waitForApiHealthy } from "./helpers/api";

const STACK_E2E = process.env.PLAYWRIGHT_STACK_E2E === "true";

function sessionIdFromPath(url: string): string {
  return new URL(url).pathname.split("/").pop() as string;
}

/**
 * #126 — Gate 1 "Request changes" / "Reject" against the real stack
 * (UI + wizard_api + Postgres), so the assertions cover the API path rather
 * than the in-memory mock store.
 *
 * Run via Docker: ./scripts/docker-test.sh --step stack-e2e
 *
 * What used to happen and must not happen again:
 *   - "Request changes" moved the session back to step 3 with no explanation.
 *   - The feedback was never recorded (empty `user_content` is refused by the
 *     API, so the acknowledgement was dropped silently).
 *   - "Reject" left no visible trace anywhere in the UI.
 */
test.describe("#126 Gate 1 objections carry a reason (stack)", () => {
  test.skip(!STACK_E2E, "set PLAYWRIGHT_STACK_E2E=true (docker-test.sh --step stack-e2e)");

  test.beforeAll(async ({ request }) => {
    await waitForApiHealthy(request);
  });

  test("request changes stays on the gate and records the reason", async ({ page, request }) => {
    test.setTimeout(120_000);

    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(`Gate1 feedback ${Date.now()}`);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    // Gate 1 is step 4. Gathering (1–3) is advanced by the agent, not by the
    // UI button, so put the session on the gate through the API.
    await setApiSessionStep(request, sessionIdFromPath(page.url()), 4);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Vaatimusten tarkistus" }),
    ).toBeVisible();

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    const reason = page.getByLabel("Mitä pitää muuttaa? (pakollinen)");
    await expect(reason).toBeVisible();

    // An empty objection is refused by the form itself — nothing is submitted.
    await page.getByRole("button", { name: "Pyydä muutoksia" }).click();
    await expect(reason).toHaveJSProperty("validity.valid", false);
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();

    const feedback = "Syötteet tulevat skannattuina PDF-tiedostoina, ei Word-muodossa.";
    await reason.fill(feedback);
    await page.getByRole("button", { name: "Pyydä muutoksia" }).click();

    // The session stays on Gate 1 — the old behaviour dropped it to step 3 —
    // and both the reason and the acknowledgement land in the chat.
    await expect(page.getByText("VAIHE 4 / 13")).toBeVisible();
    await expect(page.getByText(feedback)).toBeVisible();
    await expect(page.getByText(/Muutospyyntö kirjattu/)).toBeVisible();
  });

  // Both objections in one session, in a row — the demo recording hit this and
  // the second one appeared to do nothing (#126 follow-up).
  test("a reject right after a change request still records", async ({ page, request }) => {
    test.setTimeout(120_000);

    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(`Gate1 both ${Date.now()}`);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//, { timeout: 20_000 });
    const id = sessionIdFromPath(page.url());
    await setApiSessionStep(request, id, 4);
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    const first = "Syötemuoto on väärä.";
    await page.getByLabel("Mitä pitää muuttaa? (pakollinen)").fill(first);
    await page.getByRole("button", { name: "Pyydä muutoksia" }).click();
    await expect(page.getByText(first)).toBeVisible({ timeout: 15_000 });

    const second = "Eivät vastaa prosessia, hylätään.";
    const reason = page.getByLabel("Mitä pitää muuttaa? (pakollinen)");
    if (!(await reason.isVisible())) {
      await page.getByText("Pyydä muutoksia tai hylkää").click();
    }
    await reason.fill(second);
    await page.getByRole("button", { name: "Hylkää" }).click();

    await expect(page.getByText(/Tämä gate on hylätty/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(second)).toBeVisible();
  });

  test("reject records the reason and shows the rejected state", async ({ page, request }) => {
    test.setTimeout(120_000);

    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(`Gate1 reject ${Date.now()}`);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);

    await setApiSessionStep(request, sessionIdFromPath(page.url()), 4);
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.getByText("Pyydä muutoksia tai hylkää").click();
    const reason = "Vaatimukset eivät vastaa sitä mitä prosessissa oikeasti tehdään.";
    await page.getByLabel("Mitä pitää muuttaa? (pakollinen)").fill(reason);
    await page.getByRole("button", { name: "Hylkää" }).click();

    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(/Tämä gate on hylätty/)).toBeVisible();
  });
});
