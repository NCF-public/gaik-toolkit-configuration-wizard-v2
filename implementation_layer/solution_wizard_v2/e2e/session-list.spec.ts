import { test, expect } from "@playwright/test";
import { DEV_USERS, loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

test.describe("Session list on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a session card keeps the full width, with download and delete inside it", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/");

    const row = page.locator("li").filter({ has: page.getByTestId("delete-session-open") }).first();
    const card = row.locator('a[href^="/sessions/"]');
    const rowBox = (await row.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(cardBox.width).toBe(rowBox.width);

    for (const button of [row.getByTestId("export-session"), row.getByTestId("delete-session-open")]) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
      expect(box.width).toBeGreaterThanOrEqual(32);
    }

    // The title has most of the card, not a word per line.
    const titleBox = (await card.locator("span").first().boundingBox())!;
    expect(titleBox.width).toBeGreaterThan(cardBox.width * 0.8);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test("the new-session field shows its whole example", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/");
    const field = page.locator("#session-title");
    await expect(field).toHaveAttribute("placeholder", "Esim. Asiakaspalvelun chatbot");
    await expect(page.getByLabel("Session nimi", { exact: true })).toHaveAttribute("id", "session-title");
    const fits = await field.evaluate((input: HTMLInputElement) => {
      const style = getComputedStyle(input);
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `${style.fontSize} ${style.fontFamily}`;
      const room =
        input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return ctx.measureText(input.placeholder).width <= room;
    });
    expect(fits).toBe(true);
  });
});

test("a session card shows the phase, not the blueprint version", async ({ page }) => {
  await loginAsDev(page);
  await page.goto("/");
  const card = page
    .locator("li")
    .filter({ has: page.getByTestId("delete-session-open") })
    .first()
    .locator('a[href^="/sessions/"]');
  await expect(card).toContainText(/Vaihe \d+\/13|Valmis/);
  await expect(page.locator("main")).not.toContainText(/blueprint v\d/i);
});

test("a search in the address keeps its field on the page, also with few sessions", async ({ page, request }) => {
  await resetMockSessions(request);
  // The second dev user starts without sessions, so one session is far below
  // the number that shows the field by itself.
  await loginAsDev(page, DEV_USERS.secondary);
  await page.locator("#session-title").fill("Hakutesti");
  await page.getByRole("button", { name: "Aloita uusi" }).click();
  await page.waitForURL(/\/sessions\//);

  await page.goto("/");
  await expect(page.getByTestId("session-card")).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toHaveCount(0);

  await page.goto("/?q=haku");
  await expect(page.getByRole("searchbox", { name: "Hae sessioita" })).toHaveValue("haku");
  await expect(page.getByTestId("session-card")).toHaveCount(1);

  // "$&" read as a replacement pattern would show the placeholder instead.
  await page.goto(`/?q=${encodeURIComponent("$&")}`);
  await expect(page.getByRole("searchbox", { name: "Hae sessioita" })).toHaveValue("$&");
  await expect(page.locator("main")).toContainText('Ei sessioita haulla "$&".');
  await page.getByRole("link", { name: "Näytä kaikki" }).click();
  await expect(page.getByTestId("session-card")).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});
