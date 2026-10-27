import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The read-only viewer and the modeler share the .bpmn-viewer-themed styles. The rule that
// hides bpmn-js's palette and context pad must leave the modeler (.bpmn-editable) alone, or
// the Workflow tab says "editable" while every editing tool is invisible.
const root = join(__dirname, "..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");
const modeler = readFileSync(join(root, "components/bpmn-modeler.tsx"), "utf8");
const viewer = readFileSync(join(root, "components/bpmn-viewer.tsx"), "utf8");

function rulesHiding(selectorPart: string): string[] {
  const rules = css.match(/[^{}]+\{[^{}]*display:\s*none[^{}]*\}/g) ?? [];
  return rules
    .map((r) => r.slice(0, r.indexOf("{")))
    .filter((sel) => sel.includes(selectorPart));
}

describe("BPMN editing tools", () => {
  it("hides the palette and context pad only outside the modeler", () => {
    for (const part of [".djs-palette", ".djs-context-pad"]) {
      const selectors = rulesHiding(part);
      expect(selectors.length).toBeGreaterThan(0);
      for (const sel of selectors) {
        for (const one of sel.split(",").filter((s) => s.includes(part))) {
          expect(one).toContain(":not(.bpmn-editable)");
        }
      }
    }
  });

  it("marks the modeler editable and leaves the viewer read-only", () => {
    expect(modeler).toMatch(/className=\{`bpmn-viewer-themed bpmn-editable /);
    expect(viewer).not.toContain("bpmn-editable");
  });
});
