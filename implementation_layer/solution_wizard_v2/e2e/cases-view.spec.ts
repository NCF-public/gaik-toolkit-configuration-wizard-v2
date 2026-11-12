import { test, expect, type Page } from "@playwright/test";
import { loginAsDev } from "./helpers/auth";
import { resetMockSessions } from "./helpers/mock";

/**
 * The cases view: the generated solution tried on own material, with a second
 * role deciding on the result. Three things a customer review found missing
 * (12 Nov 2026): a case still waiting for its input could not be removed, the
 * decision buttons did not say what each leads to, and a returned case offered
 * no way to hand the correction to the wizard.
 *
 * The mock store has no cases (they live in wizard_api), so the cases API is
 * answered here, with the state a test needs. ses_laskut is a session the mock
 * store holds; only its page shell comes from there.
 */

const SESSION = "ses_laskut";
const CASES = `/api/sessions/${SESSION}/cases`;

const MODEL = {
  title: "Vikailmoitukset",
  spec: {
    schema_name: "Ticket",
    fields: ["reporter", "location", "urgency"],
    required_fields: ["location", "urgency"],
    allowed_values: { urgency: ["low", "medium", "high"] },
  },
  process: {
    lanes: [
      { id: "L_tech", name: "Asentaja", human: true },
      { id: "L_ai", name: "GAIK AI", human: false },
      { id: "L_sup", name: "Työnjohtaja", human: true },
    ],
    nodes: [
      { id: "S", kind: "startEvent", name: "", lane: "L_tech", inputs: [], outputs: [] },
      { id: "T_report", kind: "userTask", name: "Kirjaa vikailmoitus", lane: "L_tech", inputs: [], outputs: ["Voice Message Audio"] },
      { id: "T_extract", kind: "serviceTask", name: "Poimi tiedot", lane: "L_ai", inputs: [], outputs: [] },
      { id: "T_review", kind: "userTask", name: "Tarkista tiketti", lane: "L_sup", inputs: [], outputs: [] },
      { id: "G", kind: "exclusiveGateway", name: "", lane: "L_sup", inputs: [], outputs: [] },
      { id: "E_ok", kind: "endEvent", name: "", lane: "L_sup", inputs: [], outputs: [] },
      { id: "E_no", kind: "endEvent", name: "", lane: "L_sup", inputs: [], outputs: [] },
    ],
    flows: [
      { from: "S", to: "T_report", name: "" },
      { from: "T_report", to: "T_extract", name: "" },
      { from: "T_extract", to: "T_review", name: "" },
      { from: "T_review", to: "G", name: "" },
      { from: "G", to: "E_ok", name: "Kyllä" },
      { from: "G", to: "E_no", name: "Ei" },
    ],
  },
  reviewer: "T_review",
  accepted_inputs: [{ kind: "audio", label: "WAV", extensions: [".wav"] }],
  package_ready: true,
  package_problems: [],
};

const RECORD = { reporter: "A. Testaaja", location: "Halli 3", urgency: "high" };

type FakeCase = {
  id: string;
  number: number;
  created_at: string;
  status: string;
  round: number;
  comment: string;
  return_to: string | null;
  steps_done: string[];
  events: { at: string; role: string; action: string; detail: string }[];
  [key: string]: unknown;
};

const caseId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fakeCase(number: number, status: string): FakeCase {
  const at = `2026-11-12T08:${String(number).padStart(2, "0")}:00+00:00`;
  const sent = status !== "draft";
  return {
    id: caseId(number),
    number,
    created_at: at,
    status,
    round: 1,
    note: "",
    comment: "",
    run_id: sent ? "run-1" : null,
    run_message: null,
    inputs: sent ? [{ name: "report.wav", bytes: 12, task: "T_report" }] : [],
    steps_done: sent ? ["T_report"] : [],
    input_tasks: sent ? { "report.wav": "T_report" } : {},
    notes: {},
    return_to: null,
    result: sent ? { record: RECORD, validation: null, transcript: "", files: ["ticket.json"] } : null,
    record: sent ? RECORD : null,
    events: sent
      ? [
          { at, role: "Asentaja", action: "submit", detail: "" },
          { at, role: "ai", action: "result", detail: "" },
        ]
      : [],
  };
}

type Fake = { cases: FakeCase[]; removed: string[] };

/** Answers the cases API from `cases` (oldest first), as wizard_api would. */
async function fakeCases(page: Page, cases: FakeCase[]): Promise<Fake> {
  const fake: Fake = { cases, removed: [] };
  await page.route(`**${CASES}**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.split(CASES)[1].replace(/^\//, "");
    if (method === "GET" && path === "model") return route.fulfill({ json: MODEL });
    if (method === "GET" && path === "") {
      const listed = [...fake.cases]
        .reverse()
        .map(({ id, number, created_at, status, round }) => ({ id, number, created_at, status, round }));
      return route.fulfill({ json: { cases: listed } });
    }
    const [id, action] = path.split("/");
    const found = fake.cases.find((c) => c.id === id);
    const refuse = (status: number, error: string, message: string) =>
      route.fulfill({ status, json: { detail: { error, message, trace_id: "trace-e2e" } } });
    if (!found) return refuse(404, "not_found", "case not found");
    if (method === "GET" && !action) return route.fulfill({ json: found });
    if (method === "DELETE" && !action) {
      if (found.status !== "draft") {
        return refuse(409, "case_state", `the case is ${found.status}; only a case still waiting for its input can be removed`);
      }
      fake.cases = fake.cases.filter((c) => c !== found);
      fake.removed.push(found.id);
      return route.fulfill({ status: 204 });
    }
    if (method === "POST" && action === "review") {
      const body = request.postDataJSON() as { action: string; role: string; comment: string; return_to: string | null };
      const at = "2026-11-12T09:00:00+00:00";
      if (body.action === "return") {
        Object.assign(found, { status: "returned", comment: body.comment, round: found.round + 1, return_to: body.return_to, steps_done: [] });
      } else {
        Object.assign(found, { status: body.action === "approve" ? "approved" : "rejected", comment: body.comment });
      }
      found.events.push({ at, role: body.role, action: body.action, detail: body.comment });
      return route.fulfill({ json: found });
    }
    // A recording asked for by the source panel's player, and anything else.
    return refuse(404, "not_found", "not found");
  });
  return fake;
}

async function openCases(page: Page) {
  await loginAsDev(page);
  await page.goto(`/sessions/${SESSION}/cases`);
  await expect(page.getByTestId("case-intro")).toBeVisible();
}

/** The page's own error line; Next's route announcer is an alert too. */
const problem = (page: Page) => page.locator("main").getByRole("alert");

const rowNumbers = (page: Page) =>
  page.getByTestId("case-row").evaluateAll((rows) => rows.map((r) => /#\d+/.exec(r.textContent ?? "")?.[0]));

test.describe("cases view: removing a case that waits for its input", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("a waiting case is removed after asking, and the others keep their numbers", async ({ page }) => {
    // #4 was removed earlier: the numbers are the api's, not places in the list.
    const fake = await fakeCases(page, [fakeCase(1, "approved"), fakeCase(2, "review"), fakeCase(3, "draft"), fakeCase(5, "draft")]);
    await openCases(page);

    await expect(page.getByRole("heading", { name: "Tapaus #5" })).toBeVisible();
    expect(await rowNumbers(page)).toEqual(["#5", "#3", "#2", "#1"]);
    // Only the cases that were never sent can be removed.
    await expect(page.getByTestId("case-remove")).toHaveCount(2);

    // Asked first, in the row; "Peruuta" leaves the case and gives the focus back.
    await page.getByRole("button", { name: "Poista tapaus #3" }).click();
    const ask = page.getByTestId("case-remove-ask");
    await expect(ask).toContainText("Poistetaanko tapaus #3?");
    await expect(page.getByTestId("case-remove-cancel")).toBeFocused();
    await page.getByTestId("case-remove-cancel").click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Poista tapaus #3" })).toBeFocused();
    expect(fake.removed).toEqual([]);

    await page.getByRole("button", { name: "Poista tapaus #3" }).click();
    await page.getByTestId("case-remove-confirm").click();

    await expect(page.getByTestId("case-row")).toHaveCount(3);
    expect(fake.removed).toEqual([caseId(3)]);
    expect(await rowNumbers(page)).toEqual(["#5", "#2", "#1"]);
    await expect(page.getByTestId("case-removed")).toHaveText("Tapaus #3 poistettu.");
    // The open case stays open.
    await expect(page.getByRole("heading", { name: "Tapaus #5" })).toBeVisible();
    await expect(problem(page)).toHaveCount(0);
  });

  test("removing the open case opens the newest one left", async ({ page }) => {
    const fake = await fakeCases(page, [fakeCase(1, "approved"), fakeCase(2, "review"), fakeCase(3, "draft")]);
    await openCases(page);
    await expect(page.getByRole("heading", { name: "Tapaus #3" })).toBeVisible();

    await page.getByRole("button", { name: "Poista tapaus #3" }).click();
    await page.getByTestId("case-remove-confirm").click();

    await expect(page.getByRole("heading", { name: "Tapaus #2" })).toBeVisible();
    await expect(page.getByTestId("case-review")).toBeVisible();
    expect(fake.removed).toEqual([caseId(3)]);
    expect(await rowNumbers(page)).toEqual(["#2", "#1"]);
    await expect(page.getByTestId("case-remove")).toHaveCount(0);
  });

  test("a case that was sent meanwhile is not removed: the refusal is shown and the list read again", async ({ page }) => {
    const fake = await fakeCases(page, [fakeCase(1, "approved"), fakeCase(2, "draft"), fakeCase(3, "draft")]);
    await openCases(page);
    await page.getByRole("button", { name: "Poista tapaus #2" }).click();
    // Sent from another tab while the question was open.
    Object.assign(fake.cases[1], fakeCase(2, "review"));

    await page.getByTestId("case-remove-confirm").click();

    await expect(problem(page)).toContainText("only a case still waiting for its input can be removed");
    expect(fake.removed).toEqual([]);
    await expect(page.getByTestId("case-row").filter({ hasText: "#2" })).toContainText("Odottaa hyväksyntää");
    await expect(page.getByRole("button", { name: "Poista tapaus #2" })).toHaveCount(0);
  });
});

test.describe("cases view: the decision", () => {
  test.beforeEach(async ({ request }) => {
    await resetMockSessions(request);
  });

  test("each decision says what it leads to, on a wide and on a narrow screen", async ({ page }) => {
    await fakeCases(page, [fakeCase(1, "review")]);
    await openCases(page);

    const hints = page.getByTestId("case-decision-hints");
    await expect(hints.getByRole("listitem")).toHaveText([
      "Hyväksy: tulos on valmis vietäväksi",
      "Palauta: tapaus palaa syötteen antajalle kommenttisi kanssa",
      "Hylkää: tapaus päättyy ilman tulosta",
    ]);
    // Each line is its button's description, not only text near it.
    await expect(page.getByTestId("case-approve")).toHaveAccessibleDescription("Hyväksy: tulos on valmis vietäväksi");
    await expect(page.getByTestId("case-return")).toHaveAccessibleDescription(/palaa syötteen antajalle/);
    await expect(page.getByTestId("case-reject")).toHaveAccessibleDescription(/päättyy ilman tulosta/);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(hints).toBeVisible();
    await expect(page.getByTestId("case-reject")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("a returned case offers the wizard, with the reviewer's comment as the quote", async ({ page }) => {
    await page.addInitScript(() => {
      // What the case page keeps for the chat, before the session page takes it.
      const store = window as unknown as { __kept: string[] };
      store.__kept = [];
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.startsWith("gaik-wizard:pending-chat-reference:")) store.__kept.push(value);
        return setItem.call(this, key, value);
      };
    });
    await fakeCases(page, [fakeCase(1, "approved"), fakeCase(2, "review")]);
    await openCases(page);

    await page.getByTestId("case-return").click();
    await page.locator("#case-comment").fill('Kenttä "halli" puuttuu tuloksesta.');
    await page.getByTestId("case-confirm").click();

    // Back at the input step, with the comment and the way to the wizard beside it.
    const returned = page.getByTestId("case-returned");
    await expect(returned).toContainText('Palautettu korjattavaksi: Kenttä "halli" puuttuu tuloksesta.');
    await expect(page.getByTestId("case-drop")).toBeVisible();
    await returned.getByTestId("case-ask-fix-returned").click();

    await page.waitForURL(`**/sessions/${SESSION}?tab=poc`);
    const kept = await page.evaluate(() => (window as unknown as { __kept: string[] }).__kept);
    expect(kept).toHaveLength(1);
    const reference = JSON.parse(kept[0]) as { label: string; prefix: string; draft?: string };
    expect(reference.label).toBe("Tapaus #2");
    expect(reference.prefix).toContain("tulos palautettiin korjattavaksi");
    expect(reference.prefix).toContain("\"Kenttä 'halli' puuttuu tuloksesta.\"");
    expect(reference.draft).toBe("Korjaa ratkaisu tämän palautteen mukaan.");
    // The chat opens with the case as its chip and the words ready to send.
    await expect(page.getByTestId("chat-reference")).toContainText("Tapaus #2");
    await expect(page.getByLabel("Viesti wizardille")).toHaveValue("Korjaa ratkaisu tämän palautteen mukaan.");
  });
});
