import { describe, expect, it } from "vitest";
import { answersMessage, questionsIn } from "./chat-questions";

const ROUND = `Kiitos! Aloitetaan liiketoimintakontekstista:

- Millaisessa muodossa ostotilaukset saapuvat (esim. **PDF**, Word)? Tulevatko ne
  yhdeltä vai usealta toimittajalta?
- Miten ostotilaukset käsitellään nyt?
- Taustaksi: tiedot menevät ERP:hen.
1. Mitä tulosta haluat (esim. [JSON](https://example.com))?

Vastaa niihin, joihin osaat.`;

describe("questionsIn", () => {
  it("takes the list items that ask something, wrapped lines included", () => {
    expect(questionsIn(ROUND)).toEqual([
      "Millaisessa muodossa ostotilaukset saapuvat (esim. PDF, Word)? Tulevatko ne yhdeltä vai usealta toimittajalta?",
      "Miten ostotilaukset käsitellään nyt?",
      "Mitä tulosta haluat (esim. JSON)?",
    ]);
  });

  it("finds nothing in a message without a list", () => {
    expect(questionsIn("Mitä haluat ratkaista? Kerro vapaasti.")).toEqual([]);
  });
});

describe("answersMessage", () => {
  const template = { intro: "Vastaukseni:", line: '{n}. "{question}": {answer}', skip: "skip" };

  it("numbers the answers, quotes each question on one line and skips the empty ones", () => {
    expect(
      answersMessage(['Kysymys "A"\nrivi kaksi?', "Kysymys B?"], ["  PDF\nsähköpostilla ", ""], template),
    ).toBe("Vastaukseni:\n1. \"Kysymys 'A' rivi kaksi?\": PDF sähköpostilla\n2. \"Kysymys B?\": skip");
  });
});
