import { expect, test } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * Smoke test for the seeded "Customer service chatbot" mock session (ses_chatbot).
 * Covers login → session list → wizard workspace → chat SSE → blueprint JSON → PoC mock run.
 */
test.describe("Customer service chatbot (mock)", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("walks through chatbot use case in the wizard UI", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");
    await page.waitForURL(/\/sessions\/ses_chatbot$/);

    await expect(
      page.getByRole("heading", { name: "Customer service chatbot", level: 1 }),
    ).toBeVisible();

    const workspacePanel = page.locator('[role="tabpanel"]:visible');

    // Step 6 — before phase 8: text step list only, no BPMN yet.
    await expect(workspacePanel.getByText("V2 aloitettu")).toHaveCount(0);
    await expect(workspacePanel.getByText("Retrieval (RAG)")).toBeVisible();
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

    await expect(workspacePanel.getByText("V2 aloitettu")).toBeVisible();
    await expect(workspacePanel.getByRole("button", { name: "Tallenna → JSON" })).toBeVisible();
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      workspacePanel.getByRole("button", { name: "Koko prosessi" }),
    ).toBeVisible();

    // Chat — mock SSE reply references current phase (step 8 = BPMN).
    const chatPanel = page.getByRole("complementary", { name: "Keskustelu" });
    const chatInput = chatPanel.getByLabel("Viesti wizardille");
    const sendButton = chatPanel.getByRole("button", { name: "Lähetä" });
    await chatInput.fill("Haluaisimme vastata tuotekysymyksiin automaattisesti.");
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(chatPanel.getByRole("log").getByText("Mock-vastaus")).toBeVisible({
      timeout: 15_000,
    });

    // Blueprint JSON tab.
    await page.getByRole("tab", { name: "Blueprint (JSON)" }).click();
    await expect(workspacePanel.locator("textarea")).toHaveValue(/"pgvector"/);

    // PoC mock run.
    await page.getByRole("tab", { name: "PoC" }).click();
    await workspacePanel.getByRole("button", { name: "Aja PoC" }).click();
    await expect(workspacePanel.getByText("Onnistui")).toBeVisible({
      timeout: 15_000,
    });
  });
});
