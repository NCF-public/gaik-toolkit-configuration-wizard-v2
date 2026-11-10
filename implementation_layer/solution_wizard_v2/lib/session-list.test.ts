import { describe, expect, it } from "vitest";
import { fillQuery, groupSessionsByDay, matchesSearch, showsSearch } from "./session-list";

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

  const days = (sessions: { title: string; updatedAt: string }[], now: string) =>
    groupSessionsByDay(sessions, new Date(now)).map((g) => [g.day, g.sessions.map((s) => s.title)]);

  it("counts calendar days over the change to summer time, a day of 23 hours", () => {
    // Clocks went forward on Sunday 28 Mar 2027. Monday 00:30 in Finland is
    // 21:30 UTC on Sunday; 24 hours earlier it was still Saturday there.
    expect(
      days(
        [
          at("2027-03-28T09:00:00Z", "sunday"),
          at("2027-03-27T09:00:00Z", "saturday"),
          at("2027-03-23T09:00:00Z", "tuesday"),
          at("2027-03-22T09:00:00Z", "monday before"),
        ],
        "2027-03-28T21:30:00Z",
      ),
    ).toEqual([
      ["yesterday", ["sunday"]],
      ["week", ["saturday", "tuesday"]],
      ["earlier", ["monday before"]],
    ]);
  });

  it("counts calendar days over the change to winter time, a day of 25 hours", () => {
    // Clocks went back on Sunday 25 Oct 2026. Sunday 23:30 in Finland is
    // 21:30 UTC; 24 hours earlier it was already Sunday there, 00:30.
    expect(
      days(
        [
          at("2026-10-25T09:00:00Z", "sunday"),
          at("2026-10-24T09:00:00Z", "saturday"),
          at("2026-10-19T09:00:00Z", "monday"),
          at("2026-10-18T09:00:00Z", "sunday before"),
        ],
        "2026-10-25T21:30:00Z",
      ),
    ).toEqual([
      ["today", ["sunday"]],
      ["yesterday", ["saturday"]],
      ["week", ["monday"]],
      ["earlier", ["sunday before"]],
    ]);
  });
});

describe("matchesSearch", () => {
  it("ignores case, Finnish letters included", () => {
    expect(matchesSearch("Ostotilaukset ÄÖ", "äö")).toBe(true);
    expect(matchesSearch("R32 UC04", "uc04")).toBe(true);
    expect(matchesSearch("R32 UC04", "uc05")).toBe(false);
  });
});

describe("showsSearch", () => {
  it("shows the field from six sessions on", () => {
    expect(showsSearch(5, "")).toBe(false);
    expect(showsSearch(6, "")).toBe(true);
  });

  it("keeps the field while a search is on, so a filtered list can be cleared", () => {
    expect(showsSearch(5, "uc04")).toBe(true);
    expect(showsSearch(1, "uc04")).toBe(true);
  });

  it("has nothing to search without sessions", () => {
    expect(showsSearch(0, "uc04")).toBe(false);
  });
});

describe("fillQuery", () => {
  it("puts the search in as typed, replacement patterns included", () => {
    expect(fillQuery('No sessions match "{q}".', "$& $1 $$")).toBe('No sessions match "$& $1 $$".');
  });
});
