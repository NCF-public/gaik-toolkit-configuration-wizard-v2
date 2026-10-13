import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import fs from "node:fs";
import path from "node:path";

/**
 * Screenshots: V2 BPMN with integration_targets → data store.
 *
 *   PLAYWRIGHT_SKIP_WEBSERVER=true \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3040 \
 *   npx playwright test e2e/bpmn-data-stores.spec.ts --project=chromium
 */
const SHOT_DIR = path.join(__dirname, "screenshots", "bpmn-data-stores");

test.describe("BPMN data stores", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("chatbot BPMN shows Knowledge Base data store", async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");
    await page.waitForURL(/\/sessions\/ses_chatbot$/);

    // step 6 → 7 → 8 (Visuaalinen työnkulku)
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await expect(
      page.getByRole("heading", { name: "Visuaalinen työnkulku (BPMN)" }),
    ).toBeVisible();

    const workspacePanel = page.locator('[role="tabpanel"]:visible');
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 20_000 });

    // Fit overview so data store is in frame
    const overview = workspacePanel.getByRole("button", {
      name: /Koko prosessi|Overview/i,
    });
    if (await overview.isVisible().catch(() => false)) {
      await overview.click();
    }
    await page.waitForTimeout(1200);

    await page.screenshot({
      path: path.join(SHOT_DIR, "01-bpmn-with-data-store.png"),
      fullPage: true,
    });

    // Diagram canvas only
    await workspacePanel
      .locator(".bpmn-viewer-themed")
      .screenshot({ path: path.join(SHOT_DIR, "02-canvas-data-store.png") });

    // Invoice session — finance_system store
    await page.goto("/sessions/ses_laskut");
    await page.waitForURL(/\/sessions\/ses_laskut$/);
    // ses_laskut is already at step 11 — past BPMN; jump via timeline if needed
    const bpmnStep = page.getByText("Visuaalinen työnkulku (BPMN)");
    if (await bpmnStep.isVisible().catch(() => false)) {
      await bpmnStep.click();
      await page.waitForTimeout(800);
    }
    await expect(
      page.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(SHOT_DIR, "03-invoice-finance-store.png"),
      fullPage: true,
    });
  });
});
