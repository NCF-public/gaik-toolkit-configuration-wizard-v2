import { describe, expect, it } from "vitest";
import { DERIVED_TITLE_MAX, sessionTitleFrom } from "./session-title";

const source = {
  sentences: {
    nonTechnical: "Taustani: en ole tekninen. Kysy arkikielellä. ",
    technical: "Taustani: olen tekninen. ",
  },
  examples: [
    { title: "Laskun kentät", prompt: "Haluamme poimia toimittajien PDF-laskuista keskeiset kentät." },
    { title: "Kysymykset ohjeista", prompt: "Haluamme avustajan, joka vastaa kysymyksiin ohjeidemme pohjalta." },
  ],
  fallback: "Nimetön sessio",
};

describe("sessionTitleFrom", () => {
  it("names a session by the example it was started from", () => {
    expect(sessionTitleFrom(source.examples[0].prompt, source)).toBe("Laskun kentät");
  });

  it("finds the example behind the background sentence", () => {
    const message = `${source.sentences.technical}${source.examples[1].prompt}`;
    expect(sessionTitleFrom(message, source)).toBe("Kysymykset ohjeista");
  });

  it("leaves the background sentence out of the name", () => {
    const message = `${source.sentences.nonTechnical}Luokittele saapuvat sähköpostit`;
    expect(sessionTitleFrom(message, source)).toBe("Luokittele saapuvat sähköpostit");
  });

  it("takes the first sentence of the first line that says something", () => {
    expect(sessionTitleFrom("\n\n  Tiivistä kokousmuistiot. Niitä on satoja.\nToinen rivi", source)).toBe(
      "Tiivistä kokousmuistiot",
    );
  });

  it("keeps a short opening together with what follows it", () => {
    // "Hei." alone would name nothing.
    expect(sessionTitleFrom("Hei. Tarvitsen apua laskuissa", source)).toBe("Hei. Tarvitsen apua laskuissa");
  });

  it("does not cut at a full stop inside a word", () => {
    expect(sessionTitleFrom("Vie data tiedostoon raportti.xlsx joka viikko", source)).toBe(
      "Vie data tiedostoon raportti.xlsx joka",
    );
  });

  it("cuts a long line at a word, with no ellipsis", () => {
    const title = sessionTitleFrom(
      "Haluamme koota moniosaisen raportin dokumenteista ja litteroinneista",
      source,
    );
    expect(title).toBe("Haluamme koota moniosaisen raportin");
    expect(title.length).toBeLessThanOrEqual(DERIVED_TITLE_MAX);
  });

  it("cuts a word longer than the limit where the limit falls", () => {
    const title = sessionTitleFrom("x".repeat(90), source);
    expect(title).toBe("x".repeat(DERIVED_TITLE_MAX));
  });

  it("collapses whitespace and drops closing punctuation", () => {
    expect(sessionTitleFrom("Luokittele   laskut\tnopeasti?!", source)).toBe("Luokittele laskut nopeasti");
  });

  it("falls back when nothing is left to name the session by", () => {
    expect(sessionTitleFrom("   ", source)).toBe("Nimetön sessio");
    expect(sessionTitleFrom(source.sentences.technical, source)).toBe("Nimetön sessio");
    expect(sessionTitleFrom("?!", source)).toBe("Nimetön sessio");
  });
});
