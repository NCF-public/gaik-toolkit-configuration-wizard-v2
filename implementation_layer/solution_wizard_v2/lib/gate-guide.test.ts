import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { LOCALES, dictionary } from "@/lib/i18n";
import { gateReference, nowLine, rejectMessage } from "@/lib/gate-guide";
import { buildGateStatus, GATE_STEPS, STEP_COUNT } from "@/lib/wizard-state-machine";

const fi = dictionary("fi");

describe("nowLine", () => {
  it("has one line for every step, in both languages", () => {
    for (const loc of LOCALES) {
      const t = dictionary(loc);
      expect(t.nowSteps).toHaveLength(STEP_COUNT);
      for (let step = 1; step <= STEP_COUNT; step++) {
        const line = nowLine(t, step, buildGateStatus(step), false);
        expect(line.length).toBeGreaterThan(10);
        // Every tab placeholder is filled with the tab's own name.
        expect(line).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("names the workspace tabs by their labels", () => {
    expect(nowLine(fi, 11, buildGateStatus(11), false)).toBe(
      "Tarkista testiajon tulos PoC-välilehdellä. Kerro chatissa, jos jotain pitää muuttaa.",
    );
    expect(nowLine(fi, 8, buildGateStatus(8), false)).toContain("Työnkulku-välilehdellä");
  });

  it("at Gate 3 follows the test run", () => {
    expect(nowLine(fi, 11, buildGateStatus(11), true)).toMatch(/^Testi onnistui\./);
    // Only Gate 3 changes with a run.
    expect(nowLine(fi, 10, buildGateStatus(10), true)).toBe(nowLine(fi, 10, buildGateStatus(10), false));
  });

  it("on an approved gate before the last points onwards instead of asking to check again", () => {
    const approved = { ...buildGateStatus(9), 9: "approved" as const };
    expect(nowLine(fi, 9, approved, false)).toBe("Gate 2 on jo hyväksytty. Jatka seuraavaan vaiheeseen.");
    expect(nowLine(fi, 9, { ...approved, 9: "rejected" }, false)).toBe(nowLine(fi, 9, buildGateStatus(9), false));
  });

  it("says the work is done once Gate 4 is approved", () => {
    const approved = { ...buildGateStatus(STEP_COUNT), [STEP_COUNT]: "approved" as const };
    expect(nowLine(fi, STEP_COUNT, approved, true)).toBe(fi.nowDone);
    // Without a successful run there is no package below to take yet.
    expect(nowLine(fi, STEP_COUNT, approved, false)).toBe(
      "Kaikki gatet on hyväksytty. Aja vielä testi PoC-välilehdellä, niin käyttöönottopaketin voi ladata.",
    );
    // Until then the last step is still a gate to check.
    expect(nowLine(fi, STEP_COUNT, buildGateStatus(STEP_COUNT), true)).toBe(
      "Lataa käyttöönottopaketti PoC-välilehdeltä ja tarkista sen dokumentaatio. Hyväksy luovutus, kun ne ovat kunnossa.",
    );
  });
});

describe("gate copy", () => {
  it("has a topic, a decision, an approve label, a note and checks for each gate", () => {
    for (const loc of LOCALES) {
      const t = dictionary(loc);
      for (const list of [t.gateTopics, t.gateDecisions, t.gateApprove, t.gateApproveNotes, t.gateChecks]) {
        expect(list).toHaveLength(GATE_STEPS.length);
      }
      for (const checks of t.gateChecks) {
        expect(checks.length).toBeGreaterThanOrEqual(2);
        expect(checks.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("uses one word for a gate in the user's copy", () => {
    for (const loc of LOCALES) {
      const text = JSON.stringify(dictionary(loc)).toLowerCase();
      for (const word of ["tarkastuspiste", "gate-vaihe", "checkpoint", "gate step"]) {
        expect(text).not.toContain(word);
      }
    }
  });
});

describe("gateReference", () => {
  const labels = { topics: fi.gateTopics, chip: fi.gateChip, prefix: fi.gateRequestPrefix };

  it("keys the chip by the gate's step and names the gate and its topic", () => {
    expect(gateReference(labels, 2, 9)).toEqual({
      key: "gate:9",
      label: "Gate 2 · Ratkaisun rakenne",
      prefix: "Muutospyyntö ennen Gate 2:n (ratkaisun rakenne) hyväksyntää:",
    });
  });

  it("writes a change to an approved stage", () => {
    const change = gateReference({ ...labels, prefix: fi.gateChangePrefix }, 1, 4);
    expect(change.prefix).toBe("Haluan muuttaa hyväksyttyä vaihetta Gate 1 (vaatimukset):");
  });
});

describe("rejectMessage", () => {
  it("names the gate and keeps the reason on one line", () => {
    expect(rejectMessage(fi.gateRejectMessage, 3, fi.gateTopics[2], 'Tulos on väärä.\n\nKenttä "summa" puuttuu.')).toBe(
      "Hylkään Gate 3:n (testiajo): Tulos on väärä. Kenttä 'summa' puuttuu.",
    );
  });
});
