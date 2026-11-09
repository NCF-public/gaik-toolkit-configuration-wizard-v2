import { describe, expect, it } from "vitest";
import { groupSessionsByDay, matchesSearch } from "./session-list";

// 9 Nov 2026, 10:00 in Finland (08:00 UTC).
const NOW = new Date("2026-11-09T08:00:00Z");
const at = (iso: string, title = iso) => ({ title, updatedAt: iso });

describe("groupSessionsByDay", () => {
  it("groups by the day in Finland and keeps the order", () => {
    const groups = groupSessionsByDay(
      [
        at("2026-11-09T07:00:00Z", "a"),
        // 00:30 in Finland on the 9th, though still the 8th in UTC.
        at("2026-11-08T22:30:00Z", "b"),
        at("2026-11-08T09:00:00Z", "c"),
        at("2026-11-04T09:00:00Z", "d"),
        at("2026-11-02T09:00:00Z", "e"),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.day, g.sessions.map((s) => s.title)])).toEqual([
      ["today", ["a", "b"]],
      ["yesterday", ["c"]],
      ["week", ["d"]],
      ["earlier", ["e"]],
    ]);
  });

  it("leaves out empty groups", () => {
    expect(groupSessionsByDay([at("2026-10-01T09:00:00Z")], NOW).map((g) => g.day)).toEqual(["earlier"]);
  });
});

describe("matchesSearch", () => {
  it("ignores case, Finnish letters included", () => {
    expect(matchesSearch("Ostotilaukset ÄÖ", "äö")).toBe(true);
    expect(matchesSearch("R32 UC04", "uc04")).toBe(true);
    expect(matchesSearch("R32 UC04", "uc05")).toBe(false);
  });
});
