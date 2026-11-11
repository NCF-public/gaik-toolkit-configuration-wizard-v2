import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";

test("the privacy notice opens from the sign-in page without signing in", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("privacy-link").click();
  await page.waitForURL("/privacy");
  await expect(page.getByRole("heading", { name: "Tietosuojaseloste", level: 1 })).toBeVisible();
  await expect(page.getByTestId("privacy-draft-note")).toBeVisible();
});

test("the session list links to it at the top of the page", async ({ page }) => {
  await loginAsDev(page);
  await page.goto("/");
  await expect(page.locator("header").getByTestId("privacy-link")).toBeVisible();
});
