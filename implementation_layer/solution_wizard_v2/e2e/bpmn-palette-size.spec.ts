import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * The Workflow tab's editor shows bpmn-js's palette over the diagram. At bpmn-js's own size
 * (46 px entries, 94 px wide) it covered a third of the canvas, and a compact rule written
 * inside a CSS layer never applied, because bpmn-js's stylesheet is unlayered. This measures
 * the rendered palette, not the CSS text.
 */
test.describe("BPMN editor palette", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("is compact and keeps all of its tools", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_laskut");
    await page.getByRole("tab", { name: "Työnkulku" }).click();

    const palette = page.locator(".bpmn-editable .djs-palette");
    await expect(palette).toBeVisible({ timeout: 20_000 });

    const entries = palette.locator(".entry");
    expect(await entries.count()).toBeGreaterThanOrEqual(10);
    const entry = await entries.first().boundingBox();
    expect(entry!.width).toBeLessThanOrEqual(32);

    const box = await palette.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(70);
  });
});
