import { test, expect, type Page } from "@playwright/test";
import { DEV_USERS, loginAsDev, signOutDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import { createSession, hydrated } from "./helpers/session";

/**
 * The shell's sidebar: the user's sessions beside every page, a new session,
 * and the signed-in user. It took over what the session list page did (the
 * rows with their gates, the search, download and delete) and what the top
 * bar did (the language, the privacy notice, signing out).
 */

// A sidebar action is a server action: on a busy dev server it takes a few seconds.
const AFTER_ACTION = { timeout: 20_000 };

const sidebar = (page: Page) => page.getByTestId("sidebar");
const cards = (page: Page) => page.getByTestId("session-card");
const card = (page: Page, title: string) => cards(page).filter({ hasText: title });
/** The row of a session: its link and the menu button beside it. */
const row = (page: Page, title: string) =>
  sidebar(page).locator("li").filter({ has: card(page, title) });
const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

test.beforeEach(async ({ request }) => {
  await resetMockSessions(request);
});

test.describe("the sidebar on a desktop", () => {
  test("lists the sessions by day, each with its gates and where it stands", async ({ page }) => {
    await loginAsDev(page);
    const list = sidebar(page).getByRole("navigation", { name: "Sessiot" });
    await expect(list.getByRole("heading", { name: "Tänään" })).toBeVisible();
    expect(await cards(page).count()).toBeGreaterThan(5);

    // A session waiting at a gate says so; one between gates names its phase.
    // One short text per row, with the step count for a screen reader.
    const atGate = card(page, "Gate 2 — pending review");
    await expect(atGate).toContainText("Odottaa hyväksyntää");
    await expect(atGate).toContainText("Vaihe 9/13");
    await expect(atGate).not.toContainText("Gate 2: ratkaisun rakenne");
    const between = card(page, "UI basics");
    await expect(between).toContainText("Komponenttivalinta");
    await expect(between).not.toContainText("Odottaa hyväksyntää");
    await expect(list).not.toContainText(/blueprint v\d/i);

    // A row is as wide as the list, and its text stays inside it.
    const listBox = (await list.boundingBox())!;
    for (const one of await cards(page).all()) {
      const box = (await one.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(listBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(listBox.x + listBox.width);
    }
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
  });

  test("opens a session from its row and marks it as the open one", async ({ page }) => {
    await loginAsDev(page);
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(0);

    await card(page, "UI basics").click();
    await page.waitForURL(/\/sessions\/ses_ui_basics$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("UI basics (e2e fixture)");
    await expect(card(page, "UI basics")).toHaveAttribute("aria-current", "page");
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);

    // Another session: the mark moves, and the page is the other session's.
    await card(page, "Gate 2 — pending review").click();
    await page.waitForURL(/\/sessions\/ses_gate2_pending$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gate 2 — pending review (e2e fixture)");
    await expect(card(page, "Gate 2 — pending review")).toHaveAttribute("aria-current", "page");
    await expect(card(page, "UI basics")).not.toHaveAttribute("aria-current", "page");

    // One landmark of each kind, each with its own name.
    await expect(page.locator("#main-content")).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Sivupalkki" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sessiot" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Vaiheet" })).toBeVisible();
  });

  test("follows the open session: a reply moves it to the top of today", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_chatbot");
    await hydrated(page);
    const open = card(page, "Customer service chatbot");
    await expect(open).toHaveAttribute("aria-current", "page");
    // Last touched days ago, it is far down the list.
    await expect(cards(page).first()).not.toContainText("Customer service chatbot");

    const field = page.locator('textarea[name="message"]');
    await field.fill("Lisää vaihe, joka tarkistaa vastauksen lähteet.");
    await field.press("Enter");
    await expect(
      page.locator('form:has(textarea[name="message"]) button[type="submit"]'),
    ).toBeEnabled({ timeout: 30_000 });

    // The page reads the session again after a reply, and the sidebar with it.
    await expect(cards(page).first()).toContainText("Customer service chatbot", AFTER_ACTION);
    await expect(cards(page).first()).toHaveAttribute("aria-current", "page");
    const today = sidebar(page).getByRole("region", { name: "Tänään" });
    await expect(today.getByTestId("session-card").first()).toContainText("Customer service chatbot");
  });

  test("the search narrows the list at once, on any page, and leaves the address alone", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");
    const all = await cards(page).count();

    const search = page.getByRole("searchbox", { name: "Hae sessioita" });
    await search.fill("gate 2");
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toContainText("Gate 2 — pending review");
    await expect(page).toHaveURL(/\/sessions\/ses_ui_basics$/);

    // The search stays while the page beside it changes.
    await cards(page).click();
    await page.waitForURL(/\/sessions\/ses_gate2_pending$/);
    await expect(search).toHaveValue("gate 2");
    await expect(cards(page)).toHaveCount(1);

    // Nothing found: the search is said as it was typed, and one press clears it.
    await search.fill("$&");
    await expect(sidebar(page)).toContainText('Ei sessioita haulla "$&".');
    await sidebar(page).getByRole("button", { name: "Näytä kaikki" }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(cards(page)).toHaveCount(all);
  });

  test("a few sessions need no search field", async ({ page }) => {
    await loginAsDev(page, DEV_USERS.secondary);
    await expect(sidebar(page)).toContainText("Ei vielä sessioita.");
    await createSession(page, "Hakutesti");
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
  });

  test("folds to a rail and stays folded over a reload", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");
    await hydrated(page);
    const toggle = page.getByTestId("sidebar-toggle");
    const width = async () => Math.round((await sidebar(page).boundingBox())!.width);
    expect(await width()).toBe(264);
    await expect(toggle).toHaveAccessibleName("Pienennä sivupalkki");

    await toggle.click();
    expect(await width()).toBe(52);
    await expect(cards(page).first()).toBeHidden();
    // The pressed button went with the full column; its counterpart has the focus.
    await expect(toggle).toHaveAccessibleName("Avaa sivupalkki");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    // A new session is one press away on the rail too.
    await expect(sidebar(page).getByRole("link", { name: "Uusi sessio" })).toBeVisible();

    // The server renders the rail: no full column for a moment after a reload.
    await page.reload();
    expect(await width()).toBe(52);
    await expect(cards(page).first()).toBeHidden();

    await hydrated(page);
    await toggle.click();
    expect(await width()).toBe(264);
    await expect(cards(page).first()).toBeVisible();
    await expect(toggle).toBeFocused();
    await page.reload();
    expect(await width()).toBe(264);
  });

  test("renames a session from its row's menu: the row and the page's heading follow", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");
    await hydrated(page);
    const old = "UI basics (e2e fixture)";

    await row(page, old).getByTestId("session-actions").click();
    await row(page, old).getByTestId("rename-session").click();
    const name = page.getByTestId("rename-session-input");
    await expect(name).toBeFocused();
    await expect(name).toHaveValue(old);
    await expect(name).toHaveAccessibleName("Session nimi");

    // Esc leaves the name as it was.
    await name.fill("Hylätty nimi");
    await name.press("Escape");
    await expect(name).toHaveCount(0);
    await expect(card(page, old)).toBeVisible();
    await expect(card(page, old)).toBeFocused();

    // Enter saves it.
    await row(page, old).getByTestId("session-actions").click();
    await row(page, old).getByTestId("rename-session").click();
    await name.fill("  Laskujen   luokittelu ");
    await name.press("Enter");
    await expect(card(page, "Laskujen luokittelu")).toBeVisible(AFTER_ACTION);
    await expect(card(page, old)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Laskujen luokittelu", AFTER_ACTION);
    await expect(card(page, "Laskujen luokittelu")).toHaveAttribute("aria-current", "page");

    // Leaving the field saves too, and the name is there after a reload.
    await row(page, "Laskujen luokittelu").getByTestId("session-actions").click();
    await row(page, "Laskujen luokittelu").getByTestId("rename-session").click();
    await name.fill("Ostolaskut");
    await page.getByRole("heading", { level: 1 }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ostolaskut", AFTER_ACTION);
    await page.reload();
    await expect(card(page, "Ostolaskut")).toHaveAttribute("aria-current", "page");
  });

  test("the user area says who is signed in, switches the language and signs out", async ({ page }) => {
    await loginAsDev(page);
    const account = sidebar(page).getByRole("group", { name: "Käyttäjä" });
    await expect(account.getByTestId("user-email")).toHaveText(DEV_USERS.primary.email);
    await expect(account.getByTestId("privacy-link")).toHaveText("Tietosuojaseloste");

    await account.locator('button[name="locale"][value="en"]').click();
    const inEnglish = sidebar(page).getByRole("group", { name: "Account" });
    await expect(inEnglish.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "New session" })).toBeVisible();
    await inEnglish.locator('button[name="locale"][value="fi"]').click();
    await expect(account.getByRole("button", { name: "Kirjaudu ulos" })).toBeVisible();

    await signOutDev(page);
    // Signed out, the shell is out of reach.
    await page.goto("/");
    await page.waitForURL("/login");
  });

  test("New session leads to the start view, and on it puts the cursor in the field", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/sessions/ses_ui_basics");
    await hydrated(page);
    await page.getByTestId("new-session").click();
    await page.waitForURL("/");
    const start = page.getByTestId("start-view").locator('textarea[name="message"]');
    await expect(start).toBeFocused();

    // Already on the start view: there is no page to go to, so the field takes the cursor.
    await page.getByRole("searchbox", { name: "Hae sessioita" }).focus();
    await expect(start).not.toBeFocused();
    await page.getByTestId("new-session").click();
    await expect(start).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("the sidebar on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("is a drawer: opened from its button, closed by Esc and by opening a session", async ({ page }) => {
    await loginAsDev(page);
    await hydrated(page);
    const opener = page.getByTestId("sidebar-open");
    // Closed, the drawer is out of sight and out of the tab order.
    await expect(sidebar(page)).toBeHidden();
    await expect(page.getByTestId("start-view")).toBeVisible();
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);

    await opener.click();
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: "Sulje sivupalkki" })).toBeFocused();
    const box = (await sidebar(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBeLessThanOrEqual(390 * 0.86 + 1);
    // Everything is in it, also what a folded desktop column leaves out.
    await expect(cards(page).first()).toBeVisible();
    await expect(sidebar(page).getByTestId("user-email")).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: "Kirjaudu ulos" })).toBeVisible();
    // The page under it is out of reach meanwhile.
    await expect(page.locator("[data-shell-main]")).toHaveAttribute("inert", "");
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);

    await page.keyboard.press("Escape");
    await expect(sidebar(page)).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator("[data-shell-main]")).not.toHaveAttribute("inert", "");

    // Opening a session closes it, and the session's bar keeps clear of the button.
    await opener.click();
    await card(page, "Gate 2 — pending review").click();
    await page.waitForURL(/\/sessions\/ses_gate2_pending$/);
    await expect(sidebar(page)).toBeHidden();
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText("Gate 2 — pending review (e2e fixture)");
    const button = (await opener.boundingBox())!;
    const heading = (await title.boundingBox())!;
    expect(heading.x).toBeGreaterThanOrEqual(button.x + button.width);
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);

    // The row of the open session closes the drawer too, though it leads nowhere new.
    await opener.click();
    await expect(card(page, "Gate 2 — pending review")).toHaveAttribute("aria-current", "page");
    await card(page, "Gate 2 — pending review").click();
    await expect(sidebar(page)).toBeHidden();
  });

  test("a row's menu opens inside the window, and a press on the page behind closes the drawer", async ({ page }) => {
    await loginAsDev(page);
    await hydrated(page);
    await page.getByTestId("sidebar-open").click();

    // The last row, near the bottom of the list: its menu opens upward.
    const last = sidebar(page).locator("li").filter({ has: cards(page) }).last();
    await last.scrollIntoViewIfNeeded();
    const menuButton = last.getByTestId("session-actions");
    await menuButton.click();
    const rename = last.getByTestId("rename-session");
    await expect(rename).toBeVisible();
    const item = (await rename.boundingBox())!;
    expect(item.x).toBeGreaterThanOrEqual(0);
    expect(item.x + item.width).toBeLessThanOrEqual(390);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(item.y + item.height).toBeLessThanOrEqual(844);
    // Esc closes the menu only; the drawer stays.
    await page.keyboard.press("Escape");
    await expect(rename).toBeHidden();
    await expect(sidebar(page)).toBeVisible();
    await expect(menuButton).toBeFocused();

    // The strip of the page left in view closes the drawer.
    await page.mouse.click(380, 400);
    await expect(sidebar(page)).toBeHidden();
  });
});
