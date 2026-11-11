import { expect, test } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { openBlueprintEditor } from "./helpers/workspace";
import { resetMockSessions } from "./helpers/mock";
import { setMockSessionStep } from "./helpers/dev-step";

/**
 * Smoke test for the seeded "Customer service chatbot" mock session (ses_chatbot).
 * Covers login → session list → wizard workspace → chat SSE → blueprint JSON → PoC mock run.
 * The PoC opens after Gate 2, so the session is moved to the PoC step for the last part.
 */
test.describe("Customer service chatbot (mock)", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("walks through chatbot use case in the wizard UI", async ({ page, request, baseURL }) => {
    // The walk now loads the session a second time, at the PoC step.
    test.setTimeout(120_000);
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");
    await page.waitForURL(/\/sessions\/ses_chatbot$/);

    await expect(
      page.getByRole("heading", { name: "Customer service chatbot", level: 1 }),
    ).toBeVisible();

    const workspacePanel = page.locator('[role="tabpanel"]:visible');

    // Step 6 — before phase 8: the blueprint's read view, no BPMN and no Työnkulku tab yet.
    await expect(page.getByRole("tab", { name: "Työnkulku" })).toHaveCount(0);
    await expect(workspacePanel.getByTestId("bpmn-save")).toHaveCount(0);
    await expect(workspacePanel.getByText("Retrieval (RAG)")).toBeVisible();
    // The component sits behind the step's disclosure.
    await workspacePanel.getByTestId("plan-step-1").getByText("Komponentti ja asetukset").click();
    await expect(workspacePanel.getByText("pgvector")).toBeVisible();

    // Advance to phase 8 (Visuaalinen työnkulku / BPMN).
    await page.getByRole("button", { name: "Seuraava vaihe" }).click();
    await page.getByRole("button", { name: "Seuraava vaihe" }).click();
    await expect(page.getByText("Visuaalinen työnkulku (BPMN)")).toBeVisible();

    const bpmnResponse = await page.waitForResponse(
      (r) => r.url().includes("/bpmn"),
      { timeout: 15_000 },
    );
    expect(bpmnResponse.status()).toBe(200);

    // The Työnkulku tab mounts at this step, and in dev React runs its fetch
    // twice: the editor is drawn after the second answer, not the one above.
    await expect(workspacePanel.getByTestId("bpmn-save")).toBeVisible({ timeout: 20_000 });
    await expect(workspacePanel.getByRole("button", { name: "Tallenna", exact: true })).toBeVisible();
    await expect(
      workspacePanel.locator(".bpmn-viewer-themed .djs-container"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      workspacePanel.getByRole("button", { name: "Koko prosessi" }),
    ).toBeVisible();

    // Chat — mock SSE reply references current phase (step 8 = BPMN).
    // BPMN phase collapses chat by default (GAIK review); open it before typing.
    const chatDock = page.getByTestId("chat-dock");
    if ((await chatDock.getAttribute("data-chat-open")) === "false") {
      await page.getByTestId("chat-dock-toggle").click();
    }
    await expect(chatDock).toHaveAttribute("data-chat-open", "true");
    const chatPanel = page.getByRole("complementary", { name: "Keskustelu" });
    await expect(chatPanel.getByTestId("chat-ai-notice")).toHaveText(
      "Vastaukset tuottaa tekoäly. Tarkista ne ennen käyttöä.",
    );
    // Screen readers hear who is speaking before each assistant message.
    await expect(chatPanel.getByRole("log").getByText("Tekoälyavustaja:").first()).toBeAttached();
    const chatInput = chatPanel.getByLabel("Viesti wizardille");
    const sendButton = chatPanel.getByRole("button", { name: "Lähetä" });
    await chatInput.fill("Haluaisimme vastata tuotekysymyksiin automaattisesti.");
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(chatPanel.getByRole("log").getByText("Mock-vastaus")).toBeVisible({
      timeout: 15_000,
    });

    // Blueprint tab: component surfaces in the JSON escape hatch.
    await openBlueprintEditor(page);
    await page.getByTestId("blueprint-json-toggle").click();
    await expect(page.getByTestId("blueprint-json-editor")).toHaveValue(/"pgvector"/);

    // PoC mock run. The tab is locked until Gate 2 is approved; a session at
    // the PoC step opens on it.
    await page.getByRole("tab", { name: "PoC" }).click();
    await expect(workspacePanel.getByTestId("poc-locked")).toBeVisible();
    await setMockSessionStep(request, baseURL as string, "ses_chatbot", 10);
    await page.reload();
    await expect(page.getByRole("tab", { name: "PoC" })).toHaveAttribute("aria-selected", "true");
    await workspacePanel.getByRole("button", { name: "Generoi PoC-paketti" }).click();
    await expect(workspacePanel.getByText("Onnistui")).toBeVisible({
      timeout: 15_000,
    });
  });
});
