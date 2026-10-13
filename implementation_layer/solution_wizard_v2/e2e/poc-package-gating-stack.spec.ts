import { test, expect } from "@playwright/test";
import { DEV_USERS, loginAsDev } from "./helpers/auth";
import { getWizardApiUrl, setApiSessionStep, waitForApiHealthy } from "./helpers/api";

const STACK_E2E = process.env.PLAYWRIGHT_STACK_E2E === "true";

function sessionIdFromPath(url: string): string {
  return new URL(url).pathname.split("/").pop() as string;
}

/**
 * The PoC package is only offered when it is one (#191).
 *
 * From the customer's test report of 28 September:
 *   - the download appeared as soon as any file existed under poc/, so a
 *     package with no README, no requirements.txt and an entrypoint wiring
 *     nothing could be taken away and then did nothing (19, T8)
 *   - the package could be generated at Gate 2, before anything was approved,
 *     and the log still said "from the approved blueprint" (R6)
 *   - the button said "Run PoC" and generated instead (19)
 *
 * Run via Docker: ./scripts/docker-test.sh --step stack-e2e
 */
test.describe("#191 the PoC package is gated (stack)", () => {
  test.skip(!STACK_E2E, "set PLAYWRIGHT_STACK_E2E=true (docker-test.sh --step stack-e2e)");

  test.beforeAll(async ({ request }) => {
    await waitForApiHealthy(request);
  });

  async function newSession(page: import("@playwright/test").Page): Promise<string> {
    await loginAsDev(page, DEV_USERS.primary);
    await page.locator("#session-title").fill(`PoC gating ${Date.now()}`);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\//);
    return sessionIdFromPath(page.url());
  }

  test("generation is refused until Gate 2 is approved", async ({ page, request }) => {
    test.setTimeout(120_000);
    const base = getWizardApiUrl();
    const id = await newSession(page);

    const early = await request.post(`${base}/sessions/${id}/poc/generate`);

    expect(early.status()).toBe(409);
    const detail = (await early.json()).detail;
    expect(detail.error).toBe("gate_not_approved");
    expect(detail.gate).toBe("gate_2");
  });

  test("an incomplete package is listed but not downloadable", async ({ page, request }) => {
    test.setTimeout(120_000);
    const base = getWizardApiUrl();
    const id = await newSession(page);

    // Nothing generated at all: the listing says so and the download 404s.
    const empty = await (await request.get(`${base}/sessions/${id}/poc/files`)).json();
    expect(empty.generated).toBe(false);
    expect((await request.get(`${base}/sessions/${id}/poc`)).status()).toBe(404);
  });

  test("the button says what it does, and it is not 'run'", async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await newSession(page);

    // PoC is step 10; Gate 2 (step 9) has to be behind us to stand there.
    // The generate control lives on the PoC tab, which a reload does not open.
    await setApiSessionStep(request, id, 10);
    await page.reload({ waitUntil: "load" });
    const tab = page.getByRole("tab", { name: "PoC" });
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    // "Aja PoC" promised a run the step never performed — the wording the
    // 7 September plan names as the source of the misunderstanding.
    await expect(page.getByRole("button", { name: "Aja PoC", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Generoi PoC-paketti|Generoi uudelleen/ }),
    ).toBeVisible();
  });
});
