import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import fs from "node:fs";
import path from "node:path";

/**
 * Demo — create from scratch → dummy BPMN → JSON + BPMN edits (MIC012).
 *
 *   PLAYWRIGHT_SKIP_WEBSERVER=true \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3026 \
 *   PLAYWRIGHT_SLOW_MO=700 \
 *   npx playwright test e2e/demo-new-session-bpmn-video.spec.ts --project=chromium
 *
 * Video → e2e/videos/wizard-v2-new-session-bpmn-demo-1080p.webm
 */
test.use({
  video: {
    mode: "on",
    size: { width: 1920, height: 1080 },
  },
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});

const OUT_DIR = path.join(__dirname, "videos");

test.describe("Wizard V2 new-session BPMN demo video", () => {
  // Demo recording only — keep CI focused on new-session-dummy-bpmn.spec.ts.
  test.skip(!!process.env.CI, "demo video — run locally with PLAYWRIGHT_SLOW_MO");

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("create → BPMN → JSON edit → BPMN edit", async ({ page }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const video = page.video();

    await loginAsDev(page);
    await page.waitForTimeout(900);

    const title = "Factory safety — new session demo";
    await page.locator("#session-title").fill(title);
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\/ses_/);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await page.waitForTimeout(1400);

    for (let i = 0; i < 12; i++) {
      const phaseHeading = page.locator("main h2");
      const phase = (await phaseHeading.textContent())?.trim() ?? "";
      if (phase.includes("Visuaalinen työnkulku")) break;

      const approve = page.getByRole("button", { name: /Hyväksy gate/ });
      if (await approve.isVisible().catch(() => false)) {
        await approve.click();
        await expect(phaseHeading).not.toHaveText(phase, { timeout: 15_000 });
        await page.waitForTimeout(700);
        continue;
      }
      await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
      await expect(phaseHeading).not.toHaveText(phase, { timeout: 15_000 });
      await page.waitForTimeout(700);
    }

    await expect(
      page.getByRole("heading", { name: "Visuaalinen työnkulku (BPMN)" }),
    ).toBeVisible();
    await page.waitForTimeout(1000);

    await expect(page.getByTestId("chat-dock")).toHaveAttribute(
      "data-chat-open",
      "false",
    );

    const workspacePanel = page.locator('[role="tabpanel"]:visible');
    await expect(workspacePanel.getByTestId("bpmn-save")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1800);

    // --- JSON edit ---
    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.waitForTimeout(900);
    await page.getByTestId("blueprint-json-toggle").click();
    await page.waitForTimeout(400);
    const editor = page.getByTestId("blueprint-json-editor");
    await expect(editor).toBeVisible();
    const parsed = JSON.parse(await editor.inputValue()) as {
      description: string;
      steps: Array<{ id: string; name: string }>;
    };
    expect(parsed.steps.length).toBeGreaterThanOrEqual(3);
    parsed.steps = parsed.steps.map((s) =>
      s.id === "input" ? { ...s, name: "Safety observation note" } : s,
    );
    await editor.fill(JSON.stringify(parsed, null, 2));
    await page.waitForTimeout(1200);
    await page.getByTestId("blueprint-save").click();
    await expect(page.getByText("Tallennettu")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1400);

    // --- BPMN edit ---
    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1600);

    const label = workspacePanel
      .locator(".djs-label")
      .filter({ hasText: /Process|Human review|Safety observation/ })
      .first();
    await expect(label).toBeVisible({ timeout: 15_000 });
    await label.click({ force: true });
    await page.waitForTimeout(900);

    const nameInput = workspacePanel.getByTestId("bpmn-property-name");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill("Assess factory risk");
    await page.waitForTimeout(1400);

    await workspacePanel.getByTestId("bpmn-save").click();
    const saved = page.getByText("Tallennettu");
    const lintBlocked = page.getByText(/BPMN-validointi|bpmnlint|epäonnistui/i);
    await expect(saved.or(lintBlocked).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1600);

    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.waitForTimeout(1200);
    const after = JSON.parse(await editor.inputValue()) as {
      steps: Array<{ id: string; name: string }>;
    };
    const names = after.steps.map((s) => s.name);
    expect(
      names.some(
        (n) =>
          n === "Safety observation note" ||
          n === "Assess factory risk" ||
          n.includes("Assess"),
      ),
    ).toBe(true);
    await page.waitForTimeout(1400);

    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await page.waitForTimeout(1800);

    await page.getByTestId("chat-dock-toggle").click();
    await expect(page.getByTestId("chat-dock")).toHaveAttribute(
      "data-chat-open",
      "true",
    );
    await page.waitForTimeout(1400);
    await page.getByTestId("chat-dock-toggle").click();
    await page.waitForTimeout(1600);

    await page.close();
    const videoPath = await video?.path();
    if (videoPath && fs.existsSync(videoPath)) {
      const dest1080 = path.join(
        OUT_DIR,
        "wizard-v2-new-session-bpmn-demo-1080p.webm",
      );
      const dest = path.join(OUT_DIR, "wizard-v2-new-session-bpmn-demo.webm");
      fs.copyFileSync(videoPath, dest1080);
      fs.copyFileSync(videoPath, dest);
    }
  });
});
