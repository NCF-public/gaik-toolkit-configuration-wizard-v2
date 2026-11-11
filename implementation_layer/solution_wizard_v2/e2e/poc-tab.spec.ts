import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";
import { setChatOpen } from "./helpers/workspace";

/**
 * The PoC tab after Gate 2: a checked package folds to one status line with
 * its files and controls behind "Paketin tiedot", the check is remembered for
 * the browser tab, the set-up steps and the result sit side by side on a wide
 * panel, and several flat records come out as one table. The mock store has
 * no PoC package and no sandbox, so the PoC API is answered here. ses_laskut
 * stands at Gate 3 (step 11) and opens on the PoC tab.
 */

const SESSION = "ses_laskut";
const API = `**/api/sessions/${SESSION}`;

const FILES = ["README.md", "run_poc.py", "requirements.txt", "config.yaml", "schemas/output_schema.py"];

const RECORDS = [
  {
    supplier: "Lyreco Finland Oy",
    invoice_number: "INV-2024-118",
    total_amount: "412.90 EUR",
    paid: true,
    confidence: 0.93,
    needs_review: false,
  },
  {
    supplier: "Elisa Oyj",
    invoice_number: "9081-22",
    total_amount: "1 280.00 EUR",
    paid: false,
    confidence: 0.71,
    needs_review: true,
  },
  {
    supplier: "Fazer Food Services",
    invoice_number: "FF-55102",
    total_amount: "86.40 EUR",
    paid: true,
    confidence: 0.88,
    needs_review: false,
  },
];

const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

type Fake = { checks: number; generations: number; version: string; runs: number };
/** How the package check ends: it passes, finds a problem, or cannot run (no sandbox). */
type Check = "ok" | "failed" | "none";

async function fakePoc(
  page: Page,
  {
    record = RECORDS,
    check = "ok",
    inputs = true,
  }: { record?: unknown; check?: Check; /** Test material is in the package. */ inputs?: boolean } = {},
): Promise<Fake> {
  const fake: Fake = { checks: 0, generations: 0, version: "v1", runs: 0 };
  await page.route(`${API}/poc/files`, (route) =>
    route.fulfill({
      json: { generated: true, ready: true, problems: [], files: FILES, version: fake.version },
    }),
  );
  await page.route(`${API}/poc/input`, (route) =>
    route.fulfill({ json: { files: inputs ? [{ name: "invoice_001.pdf", bytes: 184320 }] : [] } }),
  );
  await page.route(`${API}/poc/check`, (route) => {
    fake.checks += 1;
    if (check === "none") return route.fulfill({ status: 503, json: { detail: "no sandbox" } });
    return route.fulfill({ json: { run_id: `check-${fake.checks}` } });
  });
  await page.route(`${API}/runs/check-*/stream`, (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: sse(
        check === "failed"
          ? [
              { log: "PROBLEM: run_poc.py cannot import gaik.software_modules.missing" },
              { done: true, phase: "failed" },
            ]
          : [{ log: "all stages load" }, { done: true, phase: "succeeded" }],
      ),
    }),
  );
  await page.route(`${API}/poc`, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    fake.generations += 1;
    return route.fulfill({
      contentType: "text/event-stream",
      body: sse([{ log: "✓ Kirjoitettu poc/run_poc.py" }, { done: true, status: "success" }]),
    });
  });
  await page.route(`${API}/runs`, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    fake.runs += 1;
    return route.fulfill({ json: { run_id: "run-1" } });
  });
  await page.route(`${API}/runs/run-1/stream`, (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: sse([
        { log: "Stage 1/2: 3 files" },
        { log: "Wrote output/result.json" },
        { done: true, phase: "succeeded" },
      ]),
    }),
  );
  await page.route(`${API}/runs/run-1/output`, (route) =>
    route.fulfill({
      json: {
        runId: "run-1",
        record,
        validation: { passed: true },
        files: [
          { name: "result.json", body: JSON.stringify(record, null, 2) },
          { name: "summary.csv", body: "supplier,total\nLyreco Finland Oy,412.90\n" },
        ],
        downloads: [
          { name: "result.json", size: 2048 },
          { name: "summary.csv", size: 512 },
          { name: "report.pdf", size: 48213 },
        ],
        skipped: [],
      },
    }),
  );
  return fake;
}

const checkPassed = (page: Page) => page.locator('[data-testid="poc-check"][data-phase="ok"]');

/** The session, which opens on its PoC tab. */
async function openPoc(page: Page) {
  await loginAsDev(page);
  await page.goto(`/sessions/${SESSION}`);
  await expect(page.getByRole("tab", { name: "PoC" })).toHaveAttribute("aria-selected", "true");
}

/** The PoC tab of the session, once the package check has passed. */
async function openCheckedPoc(page: Page) {
  await openPoc(page);
  await expect(checkPassed(page)).toBeVisible();
}

/** Start the test run (once the page reacts to the click) and wait for its output. */
async function runTest(page: Page) {
  const run = page.getByTestId("poc-run-sandbox");
  await expect(async () => {
    if ((await page.getByTestId("poc-run-phase").count()) === 0) await run.click({ timeout: 1_000 });
    await expect(page.getByTestId("poc-run-output")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("PoC tab", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("a checked package is one status line, with its files and controls behind Paketin tiedot", async ({
    page,
  }) => {
    const fake = await fakePoc(page);
    await openCheckedPoc(page);

    const details = page.getByTestId("poc-package-details");
    const download = page.getByRole("link", { name: "Lataa työversio" });
    await expect(page.getByTestId("poc-package-status")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("poc-package-status")).toHaveText("Valmis ajettavaksi");
    await expect(details).toHaveJSProperty("open", false);
    await expect(download).toBeHidden();
    await expect(page.getByRole("button", { name: "Generoi uudelleen" })).toBeHidden();
    // The primary generate button is for a session with no package only.
    await expect(page.getByRole("button", { name: "Generoi PoC-paketti" })).toHaveCount(0);

    await details.getByText("Paketin tiedot").click();
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute("href", `/api/sessions/${SESSION}/poc/download`);
    await expect(details.getByRole("listitem")).toHaveText(FILES);

    // Generating again replaces the package, so it asks first.
    await page.getByRole("button", { name: "Generoi uudelleen" }).click();
    const confirm = page.getByTestId("poc-regen-confirm");
    await expect(confirm).toContainText("Uusi paketti korvaa nykyisen.");
    await expect(page.getByRole("button", { name: "Korvaa paketti" })).toBeFocused();
    await page.getByRole("button", { name: "Peruuta" }).click();
    await expect(confirm).toHaveCount(0);
    expect(fake.generations).toBe(0);

    await page.getByRole("button", { name: "Generoi uudelleen" }).click();
    await page.getByRole("button", { name: "Korvaa paketti" }).click();
    await expect(confirm).toHaveCount(0);
    await expect.poll(() => fake.generations).toBe(1);
  });

  test("a failed check keeps the step open: its findings, the working copy and Generoi uudelleen", async ({
    page,
  }) => {
    const fake = await fakePoc(page, { check: "failed" });
    await openPoc(page);

    await expect(page.getByTestId("poc-package-status")).toHaveAttribute("data-state", "failed");
    await expect(page.getByTestId("poc-check-problems").getByRole("listitem")).toHaveText([
      "run_poc.py cannot import gaik.software_modules.missing",
    ]);
    // Nothing is folded away while something is wrong with the package.
    await expect(page.getByTestId("poc-package-details")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Lataa työversio" })).toBeVisible();
    // Replacing a package that cannot run needs no second question.
    await page.getByRole("button", { name: "Generoi uudelleen" }).click();
    await expect(page.getByTestId("poc-regen-confirm")).toHaveCount(0);
    await expect.poll(() => fake.generations).toBe(1);
  });

  test("a package nobody could check is folded the same way, and is not called ready", async ({ page }) => {
    await fakePoc(page, { check: "none" });
    await openPoc(page);

    const status = page.getByTestId("poc-package-status");
    await expect(status).toHaveAttribute("data-state", "unchecked");
    await expect(status).toHaveText("Generoitu PoC-paketti");
    await expect(page.getByTestId("poc-package-details")).toHaveJSProperty("open", false);
    await expect(page.getByRole("link", { name: "Lataa työversio" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Generoi PoC-paketti" })).toHaveCount(0);
  });

  test("a reload shows the stored check; only a new package version is checked again", async ({ page }) => {
    const fake = await fakePoc(page);
    await openCheckedPoc(page);
    expect(fake.checks).toBe(1);

    // Once the page has gone quiet: a second check started after the stored
    // one is shown would be counted too.
    await page.reload();
    await expect(checkPassed(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(fake.checks).toBe(1);

    fake.version = "v2";
    await page.reload();
    await expect(checkPassed(page)).toBeVisible();
    await expect.poll(() => fake.checks).toBe(2);
    // The new version's result is the stored one: a reload starts no third check.
    await page.reload();
    await expect(checkPassed(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(fake.checks).toBe(2);
  });

  test("the test run starts by itself once the package is checked, and once only", async ({ page }) => {
    const fake = await fakePoc(page);
    await openCheckedPoc(page);

    // Nobody pressed Run: the result is there, with the material it is of.
    await expect(page.getByTestId("poc-run-output")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("poc-result-from")).toHaveText("Aineisto: invoice_001.pdf");
    expect(fake.runs).toBe(1);
    await expect(page.getByTestId("poc-run-sandbox")).toHaveText("Aja uudelleen");

    // The package has not changed: looking at another tab and back starts nothing.
    await page.getByRole("tab", { name: "Blueprint" }).click();
    await page.getByRole("tab", { name: "PoC" }).click();
    await expect(page.getByTestId("poc-run-output")).toBeVisible();
    expect(fake.runs).toBe(1);

    // The wizard changes the package: the new one is checked and run.
    fake.version = "v2";
    await expect.poll(() => fake.runs, { timeout: 30_000 }).toBe(2);
  });

  test("without test material the run waits for the user", async ({ page }) => {
    const fake = await fakePoc(page, { inputs: false });
    await openCheckedPoc(page);

    await expect(page.getByTestId("poc-run-sandbox")).toHaveText("Aja testi");
    await page.waitForTimeout(1_000);
    expect(fake.runs).toBe(0);
  });

  test("on a wide panel the set-up steps sit left of the result; with the chat open it is one column", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Without test material the run waits for the user, so the tab can be
    // looked at before its first run.
    await fakePoc(page, { inputs: false });
    await openCheckedPoc(page);
    // The session waits on Gate 3, so the chat is open: measure without it first.
    await setChatOpen(page, false);

    // Before the first run the result keeps its place with one line.
    const result = page.getByTestId("poc-result");
    await expect(page.getByTestId("poc-result-empty")).toHaveText("Tulos näkyy tässä testiajon jälkeen.");
    // The panel widens as the chat closes; the result takes its column then.
    await expect(result).toBeVisible();
    const inputs = (await page.getByTestId("poc-inputs").boundingBox())!;
    const wide = (await result.boundingBox())!;
    expect(wide.x).toBeGreaterThanOrEqual(inputs.x + inputs.width);
    expect(wide.width).toBeGreaterThan(inputs.width * 1.5);

    // The chat takes the width: the steps stack and the empty result goes.
    await setChatOpen(page, true);
    await expect(result).toBeHidden();

    await runTest(page);
    const stacked = (await result.boundingBox())!;
    const inputsNow = (await page.getByTestId("poc-inputs").boundingBox())!;
    expect(stacked.y).toBeGreaterThan(inputsNow.y + inputsNow.height);
  });

  test("several flat records are one table: yes/no, a percentage and a review mark", async ({ page }) => {
    await fakePoc(page);
    await openCheckedPoc(page);
    await runTest(page);

    const table = page.getByTestId("poc-run-table");
    // The review flag marks its row instead of being a column.
    await expect(table.getByRole("columnheader")).toHaveText([
      "Supplier",
      "Invoice number",
      "Total amount",
      "Paid",
      "Confidence",
    ]);
    const rows = page.getByTestId("poc-run-record");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).getByRole("cell")).toHaveText(["INV-2024-118", "412.90 EUR", "Kyllä", "93 %"]);
    await expect(rows.nth(1).getByRole("cell")).toHaveText(["9081-22", "1 280.00 EUR", "Ei", "71 %"]);
    await expect(rows.nth(1)).toHaveAttribute("data-flagged", "true");
    await expect(rows.nth(1).getByRole("rowheader")).toContainText("Tarkistettava");
    await expect(rows.nth(0).getByRole("rowheader")).toHaveText("Lyreco Finland Oy");
    await expect(page.getByTestId("poc-run-grounding")).toHaveText("Lähdetarkistus läpi");
  });

  test("the output files are listed once, each with its download and its text", async ({ page }) => {
    await fakePoc(page);
    await openCheckedPoc(page);
    await runTest(page);

    const files = page.getByTestId("poc-run-downloads").getByRole("listitem");
    await expect(files).toHaveCount(3);
    await expect(page.getByText("Tulostiedostot")).toHaveCount(1);

    const report = page.getByRole("link", { name: "Lataa report.pdf" });
    await expect(report).toHaveAttribute("href", `/api/sessions/${SESSION}/runs/run-1/files/report.pdf`);
    // A file the run printed as text can be read here; a PDF cannot.
    await expect(page.getByRole("button", { name: "Näytä report.pdf" })).toHaveCount(0);
    const show = page.getByRole("button", { name: "Näytä summary.csv" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await show.click();
    await expect(files.nth(1)).toContainText("Lyreco Finland Oy,412.90");
    const hide = page.getByRole("button", { name: "Piilota summary.csv" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await hide.click();
    await expect(files.nth(1)).not.toContainText("Lyreco Finland Oy,412.90");
  });

  test("a single record keeps its field list", async ({ page }) => {
    await fakePoc(page, { record: RECORDS[1] });
    await openCheckedPoc(page);
    await runTest(page);

    await expect(page.getByTestId("poc-run-table")).toHaveCount(0);
    const record = page.getByTestId("poc-run-record");
    await expect(record).toHaveCount(1);
    await expect(record.getByRole("row", { name: /Paid/ })).toContainText("Ei");
    await expect(record.getByRole("row", { name: /Confidence/ })).toContainText("71 %");
  });
});

test.describe("PoC tab on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("the result table scrolls inside its card, with the first column kept in place", async ({ page }) => {
    await fakePoc(page);
    await openCheckedPoc(page);
    await runTest(page);

    const table = page.getByTestId("poc-run-table");
    await table.scrollIntoViewIfNeeded();
    const size = await table.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(size.sw).toBeGreaterThan(size.cw);

    const first = page.getByTestId("poc-run-record").first().getByRole("rowheader");
    const before = (await first.boundingBox())!;
    await table.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const after = (await first.boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    await expect(page.getByTestId("poc-run-record").first().getByRole("cell").last()).toBeInViewport();

    // Nothing pushes the page itself sideways.
    const doc = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(doc.sw).toBeLessThanOrEqual(doc.cw);
  });
});
