import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Step 1 of the PoC tab says "ready to run" only once the preflight passed. A
 * failed check is shown as such and the run is no longer the suggested action;
 * a package nobody could check (no sandbox) reads as generated, not ready.
 * The mock store has no PoC package, so the package API is answered here.
 */

const SESSION = "ses_ui_basics";

async function fakePackage(page: Page, check: "succeeded" | "failed" | "no-sandbox") {
  await page.route(`**/api/sessions/${SESSION}/poc/files`, (route) =>
    route.fulfill({
      json: {
        generated: true,
        ready: true,
        problems: [],
        files: ["run_poc.py", "requirements.txt", "README.md"],
        version: "v1",
      },
    }),
  );
  await page.route(`**/api/sessions/${SESSION}/poc/check`, (route) =>
    check === "no-sandbox"
      ? route.fulfill({ status: 503, json: { detail: "no sandbox" } })
      : route.fulfill({ json: { run_id: "check-1" } }),
  );
  const events =
    check === "failed"
      ? [{ log: "PROBLEM: run_poc.py cannot import gaik.software_modules.missing" }, { done: true, phase: "failed" }]
      : [{ log: "all stages load" }, { done: true, phase: "succeeded" }];
  await page.route(`**/api/sessions/${SESSION}/runs/check-1/stream`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    }),
  );
}

async function openPocTab(page: Page) {
  await loginAsDev(page);
  await page.goto(`/sessions/${SESSION}`);
  await page.getByRole("tab", { name: "PoC" }).click();
}

test.describe("PoC package status", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("a package that passed the check is ready to run", async ({ page }) => {
    await fakePackage(page, "succeeded");
    await openPocTab(page);

    const status = page.getByTestId("poc-package-status");
    await expect(status).toContainText("Valmis ajettavaksi");
    await expect(status).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("poc-run-sandbox")).toHaveClass(/btn-brand/);
  });

  test("a failed check is shown as such and the run is no longer the suggested step", async ({ page }) => {
    await fakePackage(page, "failed");
    await openPocTab(page);

    const status = page.getByTestId("poc-package-status");
    await expect(page.getByText("run_poc.py cannot import gaik.software_modules.missing")).toBeVisible();
    await expect(status).not.toContainText("Valmis ajettavaksi");
    await expect(status).toContainText("Tarkistus ei mennyt läpi");

    const run = page.getByTestId("poc-run-sandbox");
    await expect(run).toHaveClass(/btn-secondary/);
    await expect(run).toBeEnabled();
    await expect(status).toHaveAttribute("data-state", "failed");
  });

  test("a package nobody could check reads as generated, not ready", async ({ page }) => {
    await fakePackage(page, "no-sandbox");
    await openPocTab(page);

    const status = page.getByTestId("poc-package-status");
    await expect(status).toContainText("Generoitu PoC-paketti");
    await expect(status).not.toContainText("Valmis ajettavaksi");
    await expect(status).toHaveAttribute("data-state", "unchecked");
  });
});
