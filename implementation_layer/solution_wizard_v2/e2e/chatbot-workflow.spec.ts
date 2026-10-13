import { expect, test } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";

/**
 * Smoke test for the seeded "Asiakaspalvelun chatbot" mock session (ses_chatbot).
 * Covers login → session list → wizard workspace → chat SSE → blueprint JSON → PoC mock run.
 */
test.describe("Asiakaspalvelun chatbot (mock)", () => {
  test("walks through chatbot use case in the wizard UI", async ({ page }) => {
    await loginAsDev(page);

    await expect(page.getByRole("heading", { name: "Wizard-sessiot" })).toBeVisible();

    await page.getByRole("link", { name: "Asiakaspalvelun chatbot" }).click();
    await page.waitForURL(/\/sessions\/ses_chatbot$/);

    await expect(
      page.getByRole("heading", { name: "Asiakaspalvelun chatbot", level: 1 }),
    ).toBeVisible();

    const workspacePanel = page.locator('[role="tabpanel"]:visible');

    // Step 6 — before phase 8: text step list only, no BPMN yet.
    await expect(workspacePanel.getByRole("button", { name: "Avaa työnkulku" })).toHaveCount(0);
    await expect(workspacePanel.getByText("Tietohaku (RAG)")).toBeVisible();
    await expect(workspacePanel.getByText("pgvector")).toBeVisible();

    // Advance to phase 8 (Visuaalinen työnkulku / BPMN).
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await page.getByRole("button", { name: "Seuraava vaihe →" }).click();
    await expect(page.getByText("Visuaalinen työnkulku (BPMN)")).toBeVisible();

    const bpmnResponse = await page.waitForResponse(
      (r) => r.url().includes("/bpmn"),
      { timeout: 15_000 },
    );
    expect(bpmnResponse.status()).toBe(200);

    await expect(workspacePanel.getByRole("button", { name: "Avaa työnkulku" })).toBeVisible();
    await workspacePanel.getByRole("button", { name: "Avaa työnkulku" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".bpmn-viewer-themed .djs-container")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByRole("button", { name: "Luettava", pressed: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Sulje" }).click();
    await expect(dialog).toBeHidden();
    await workspacePanel.getByText("mock step list").click();
    await expect(workspacePanel.getByText("Tietohaku (RAG)")).toBeVisible();

    // Chat — mock SSE reply references current phase (step 8 = BPMN).
    const chatPanel = page.getByLabel("Keskustelu");
    const chatInput = chatPanel.getByLabel("Viesti wizardille");
    await chatInput.fill("Haluaisimme vastata tuotekysymyksiin automaattisesti.");
    await chatPanel.getByRole("button", { name: "Lähetä" }).click();

    await expect(chatPanel.getByText("Mock-vastaus")).toBeVisible({
      timeout: 15_000,
    });

    // Blueprint JSON tab.
    await page.getByRole("tab", { name: "Blueprint (JSON)" }).click();
    await expect(workspacePanel.locator("pre")).toContainText('"pgvector"');

    // PoC mock run.
    await page.getByRole("tab", { name: "PoC" }).click();
    await workspacePanel.getByRole("button", { name: "Aja PoC" }).click();
    await expect(workspacePanel.getByText("Onnistui")).toBeVisible({
      timeout: 15_000,
    });
  });
});
