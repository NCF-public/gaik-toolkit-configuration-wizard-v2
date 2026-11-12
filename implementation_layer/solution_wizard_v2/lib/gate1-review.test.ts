import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Gate1Review } from "@/components/gate1-review";
import { dictionary } from "./i18n";

const fi = dictionary("fi");
const en = dictionary("en");

const render = (props: Partial<Parameters<typeof Gate1Review>[0]>, t = fi) =>
  renderToStaticMarkup(createElement(Gate1Review, { points: [], answers: [], t, ...props }));

/** The page's text without its markup. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("Gate1Review", () => {
  it("says so when the wizard has recorded nothing, in place of an empty sheet", () => {
    const html = render({ businessContext: null, assumptions: [] });
    expect(html).toContain('data-testid="gate1-review-empty"');
    expect(html).toContain(fi.gate1ReviewEmpty);
    expect(html).not.toContain('data-testid="gate1-review"');
  });

  it("shows the agent's identifiers in plain words, in both languages", () => {
    const props = {
      businessContext: {
        currentProcess: "Invoices are typed in by hand.",
        painPoints: [],
        intendedUsers: [],
        reviewers: [],
        expectedValue: ["Less typing"],
        knowledgeProcesses: ["knowledge_capture", "knowledge_access", "audit_trail"],
        domain: "accounts_payable",
      },
      assumptions: [
        { id: "a1", text: "PDF only.", status: "unconfirmed" as const, impact: "component_selection" },
        { id: "a2", text: "EUR only.", status: "confirmed" as const, impact: "schema" },
        { id: "a3", text: "Six years.", status: "confirmed" as const, impact: "data_retention_policy" },
      ],
    };
    const inFinnish = textOf(render(props));
    expect(inFinnish).toContain("Toimiala: Accounts payable");
    expect(inFinnish).toContain("Tiedon tallentaminen, tiedon haku, audit trail");
    expect(inFinnish).toContain("Vaikutus: komponenttien valinta");
    expect(inFinnish).toContain("Vaikutus: tietorakenne");
    expect(inFinnish).toContain("Vaikutus: data retention policy");
    expect(inFinnish).not.toMatch(/[a-z]_[a-z]/);

    const inEnglish = textOf(render(props, en));
    expect(inEnglish).toContain("Capturing knowledge, finding knowledge, audit trail");
    expect(inEnglish).toContain("Affects: component selection");
    expect(inEnglish).not.toMatch(/[a-z]_[a-z]/);
  });

  it("gives each assumption one status and keeps the missing-context note", () => {
    const html = render({
      businessContext: {
        currentProcess: "unknown",
        painPoints: [],
        intendedUsers: ["Finance team"],
        reviewers: [],
        expectedValue: ["Less typing"],
        knowledgeProcesses: [],
        domain: "",
      },
      assumptions: [
        { id: "a1", text: "PDF only.", status: "unconfirmed", impact: "" },
        { id: "a2", text: "EUR only.", status: "confirmed", impact: "low" },
      ],
    });
    expect(html.match(/data-testid="assumption-status"/g)).toHaveLength(2);
    expect(textOf(html)).toContain(`${fi.bcNotKnown}: ${fi.bcCurrentProcess}, ${fi.bcPainPoints}`);
    // One sheet: no card inside it.
    expect(html.match(/rounded-xl/g)).toHaveLength(1);
    // The requirement list is the mock store's: without points it is left out.
    expect(html).not.toContain(fi.gate1ChecklistTitle);
  });

  it("gives every assumption and business-context item a control that is always in view", () => {
    const html = render({
      businessContext: {
        currentProcess: "Invoices are typed in by hand.",
        painPoints: [],
        intendedUsers: [],
        reviewers: [],
        expectedValue: ["Less typing"],
        knowledgeProcesses: [],
        domain: "",
      },
      assumptions: [
        { id: "a1", text: "PDF only.", status: "unconfirmed", impact: "" },
        { id: "a2", text: "EUR only.", status: "confirmed", impact: "low" },
      ],
    });
    for (const name of ["Muuta: Oletus 1", "Muuta: Oletus 2", "Muuta: Nykyprosessi", "Muuta: Odotettu arvo"]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    // Nothing waits for a pointer to hover: a touch screen has none.
    expect(html).not.toMatch(/group-hover|opacity-0/);
    // The field opens on a press; until then the sheet has no form.
    expect(html).not.toContain("<form");
  });
});
