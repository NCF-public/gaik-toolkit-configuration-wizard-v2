import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FieldSpec } from "@/components/field-schema-editor";
import { SolutionPlanView } from "@/components/solution-plan-view";
import type { Blueprint } from "./mock-sessions";
import { dictionary } from "./i18n";

const t = dictionary("fi");

const blueprint: Blueprint = {
  name: "Laskujen poiminta",
  description: "",
  goal: "Poimitaan laskuista toimittaja ja summa.",
  steps: [],
};

const fields: FieldSpec[] = [
  { name: "supplier", type: "text", required: true, missingBehavior: "empty" },
];

/** A guide the reader takes as not generated: the state a finished package can be read in (#325). */
const ungenerated = { promptMarkdown: "## Kentät\n\n- supplier", schemaGenerated: false };

const render = (gate2Approved: boolean) =>
  renderToStaticMarkup(
    createElement(SolutionPlanView, {
      blueprint,
      outputFields: fields,
      extractionProposal: ungenerated,
      wizardStep: 12,
      gate1Approved: true,
      gate2Approved,
      t,
    }),
  );

describe("SolutionPlanView and the extraction guide", () => {
  it("offers the guide for approval between Gate 1 and Gate 2", () => {
    expect(render(false)).toContain('data-testid="extraction-proposal-actions"');
  });

  it("offers no approval once Gate 2 is approved, so the package is not changed after Gate 4 (#325)", () => {
    expect(render(true)).not.toContain('data-testid="extraction-proposal-actions"');
  });
});
