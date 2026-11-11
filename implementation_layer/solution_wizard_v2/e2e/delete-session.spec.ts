import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

test.describe.configure({ mode: "serial" });

test.describe("Deleting a session", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("needs the session's name, then removes it from the list", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/");
    const row = page.locator("li").filter({ has: page.getByTestId("delete-session-open") }).first();
    const title = (await row.locator("a span").first().textContent())!.trim();
    await row.getByTestId("delete-session-open").click();

    const confirm = row.getByTestId("delete-session-confirm");
    await expect(confirm).toBeDisabled();
    await row.getByTestId("delete-session-confirmation").fill("something else");
    await expect(confirm).toBeDisabled();
    await page.screenshot({ path: process.env.DELETE_SHOT ?? "test-results/delete-session.png" });
    await row.getByTestId("delete-session-confirmation").fill(title);
    await confirm.click();

    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  });

  test("cancel keeps the session", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/");
    const links = page.locator("li a");
    const before = await links.count();
    await page.getByTestId("delete-session-open").first().click();
    await page.getByRole("button", { name: /Peruuta|Cancel/ }).first().click();
    await expect(links).toHaveCount(before);
    await expect(page.getByTestId("delete-session-confirm").first()).toBeHidden();
  });
});

test("each session offers its data as a download", async ({ page }) => {
  await loginAsDev(page);
  await page.goto("/");
  const link = page.getByTestId("export-session").first();
  await expect(link).toHaveAttribute("href", /\/api\/sessions\/.+\/export$/);
});
