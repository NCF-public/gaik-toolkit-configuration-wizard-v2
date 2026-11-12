import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASE_STRINGS } from "./case-strings";

// The customer read developer notes in the Workflow tab ("mock step list", "V2 BPMN (#34)
// … bpmn_generator") and a version label that said v1 beside a header that said v2
// (feedback of 27 Oct 2026). These pin the texts a user sees.
const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("texts on the Workflow tab", () => {
  it("carry no developer notes", () => {
    const i18n = read("lib/i18n.ts");
    const panel = read("components/workspace-panel.tsx");
    for (const note of ["mock step list", "V2 BPMN (#34)", "bpmn_generator"]) {
      expect(i18n).not.toContain(note);
      expect(panel).not.toContain(note);
    }
  });

  it("show no version label of the diagram's own", () => {
    // The label defaulted to 1 and said v1 beside a header that said v2; the diagram has
    // no version label now. The one place a version is named is the status line of a
    // diagram drawn from a version written elsewhere, and that number is the session's
    // own, handed down from the page (lib/blueprint-update knownVersion): never a default.
    for (const file of ["components/bpmn-diagram-panel.tsx", "components/workflow-flow-view.tsx"]) {
      const diagram = read(file);
      expect(diagram).not.toContain("bpmn-version-label");
      expect(diagram).not.toMatch(/activeVersion/);
      expect(diagram).not.toMatch(/version\s*=\s*\d/);
    }
    expect(read("app/sessions/[id]/page.tsx")).toContain("blueprintVersion={session.activeVersion}");
  });
});

describe("case review", () => {
  it("has a text for one field to fix and a counted one for several, in both languages", () => {
    // "1 kenttää vaatii korjausta" was what one count-plus-word string gave.
    for (const s of Object.values(CASE_STRINGS)) {
      expect(s.fixOne).toMatch(/^1 /);
      expect(s.fixMany).toContain("{n}");
    }
  });
});
