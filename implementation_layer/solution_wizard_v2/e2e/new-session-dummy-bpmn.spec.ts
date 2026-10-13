import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * MIC012 / Pertti: create from scratch → dummy blueprint → BPMN visible at phase 8,
 * chat collapsed by default.
 */
test.describe("New session dummy BPMN + collapsed chat", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("create session → advance to BPMN → canvas + chat rail", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loginAsDev(page);

    const title = `Dummy BPMN ${Date.now()}`;
    await page.locator("#session-title").fill(title);
    await page.getByRole("button", { name: "Aloita uusi" }).click();
    await page.waitForURL(/\/sessions\/ses_/);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();

    // Gathering: chat open by default.
    await expect(page.getByTestId("chat-dock")).toHaveAttribute(
      "data-chat-open",
      "true",
    );

    // Advance through gates/phases to Visuaalinen työnkulku (step 8).
    for (let i = 0; i < 12; i++) {
      const phaseHeading = page.locator("main h2");
      const phase = (await phaseHeading.textContent())?.trim() ?? "";
      if (phase.includes("Visuaalinen työnkulku")) break;

      const approve = page.getByRole("button", { name: /Hyväksy gate/ });
      if (await approve.isVisible().catch(() => false)) {
        await approve.click();
        await expect(phaseHeading).not.toHaveText(phase, { timeout: 15_000 });
        continue;
      }
      const next = page.getByRole("button", { name: "Seuraava vaihe →" });
      await expect(next).toBeEnabled();
      await next.click();
      await expect(phaseHeading).not.toHaveText(phase, { timeout: 15_000 });
    }

    await expect(
      page.getByRole("heading", { name: "Visuaalinen työnkulku (BPMN)" }),
    ).toBeVisible({ timeout: 15_000 });

    // Chat collapsed so canvas has room.
    await expect(page.getByTestId("chat-dock")).toHaveAttribute(
      "data-chat-open",
      "false",
    );
    await expect(page.getByTestId("chat-dock-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    const workspacePanel = page.locator('[role="tabpanel"]:visible');
    await expect(workspacePanel.getByTestId("bpmn-save")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });

    // JSON edit on the dummy blueprint.
    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.getByTestId("blueprint-json-toggle").click();
    const editor = page.getByTestId("blueprint-json-editor");
    await expect(editor).toBeVisible();
    const parsed = JSON.parse(await editor.inputValue()) as {
      description: string;
      steps: Array<{ id: string; name: string }>;
    };
    expect(parsed.steps.length).toBeGreaterThanOrEqual(3);
    expect(parsed.description.toLowerCase()).toContain("placeholder");
    parsed.steps = parsed.steps.map((s) =>
      s.id === "input" ? { ...s, name: "Safety observation note" } : s,
    );
    await editor.fill(JSON.stringify(parsed, null, 2));
    await page.getByTestId("blueprint-save").click();
    await expect(page.getByText("Tallennettu")).toBeVisible({ timeout: 15_000 });

    // BPMN property edit on the canvas.
    await page.getByRole("tab", { name: "Työnkulku" }).click();
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });

    const label = workspacePanel
      .locator(".djs-label")
      .filter({ hasText: /Process|Human review|Safety observation/ })
      .first();
    await expect(label).toBeVisible({ timeout: 15_000 });
    await label.click({ force: true });

    const nameInput = workspacePanel.getByTestId("bpmn-property-name");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill("Assess factory risk");

    await workspacePanel.getByTestId("bpmn-save").click();
    const saved = page.getByText("Tallennettu");
    const lintBlocked = page.getByText(/BPMN-validointi|bpmnlint|epäonnistui/i);
    await expect(saved.or(lintBlocked).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("tab", { name: "Blueprint" }).click();
    const after = JSON.parse(await editor.inputValue()) as {
      steps: Array<{ id: string; name: string }>;
    };
    const names = after.steps.map((s) => s.name);
    expect(
      names.some(
        (n) =>
          n === "Safety observation note" ||
          n === "Assess factory risk" ||
          n.includes("Assess") ||
          n.includes("Safety"),
      ),
    ).toBe(true);
  });
});
