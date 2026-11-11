import { describe, expect, it } from "vitest";
import { known, knownList } from "./known-values";

describe("known values", () => {
  it.each(["unknown", "Unknown", " UNKNOWN ", "n/a", "N/A", "na", "none", "TBD", "-", "tuntematon", "Ei tiedossa", "Ei vielä tiedossa", "Unknown.", "not known yet", ""])(
    "reads %j as not known",
    (value) => {
      expect(known(value)).toBeNull();
    },
  );

  it("keeps a real answer, also one that mentions the word", () => {
    expect(known("Three people review invoices by hand")).toBe("Three people review invoices by hand");
    expect(known("unknown suppliers are flagged")).toBe("unknown suppliers are flagged");
    expect(known(undefined)).toBeNull();
    expect(known(null)).toBeNull();
  });

  it("drops the placeholders from a list", () => {
    expect(knownList(["unknown", "Finance team", "n/a"])).toEqual(["Finance team"]);
    expect(knownList(undefined)).toEqual([]);
  });
});
