import { describe, expect, it } from "vitest";
import { answersMessage, questionsIn } from "./chat-questions";

const ROUND = `Kiitos! Aloitetaan liiketoimintakontekstista:

- Millaisessa muodossa ostotilaukset saapuvat (esim. **PDF**, Word)? Tulevatko ne
  yhdeltä vai usealta toimittajalta?
- Miten ostotilaukset käsitellään nyt?
- Taustaksi: tiedot menevät ERP:hen.
1. Mitä tulosta haluat (esim. [JSON](https://example.com))?

Vastaa niihin, joihin osaat.`;

const texts = (markdown: string) => questionsIn(markdown).map((q) => q.text);
const numbers = (markdown: string) => questionsIn(markdown).map((q) => q.n);

describe("questionsIn", () => {
  it("takes the list items that ask something, wrapped lines included", () => {
    expect(texts(ROUND)).toEqual([
      "Millaisessa muodossa ostotilaukset saapuvat (esim. PDF, Word)? Tulevatko ne yhdeltä vai usealta toimittajalta?",
      "Miten ostotilaukset käsitellään nyt?",
      "Mitä tulosta haluat (esim. JSON)?",
    ]);
  });

  it("finds nothing in a message without a list", () => {
    expect(questionsIn("Mitä haluat ratkaista? Kerro vapaasti.")).toEqual([]);
  });

  it("leaves out what is inside a fenced code block", () => {
    const reply = [
      "- Missä muodossa tilaukset saapuvat?",
      "",
      "```bash",
      "- curl https://example.com/haku?q=tilaus",
      "1. echo valmis?",
      "```",
      "~~~",
      "- onko tämä kysymys?",
      "~~~",
      "- Kuka tilaukset käsittelee?",
    ].join("\n");
    expect(texts(reply)).toEqual(["Missä muodossa tilaukset saapuvat?", "Kuka tilaukset käsittelee?"]);
  });

  it("does not take a question mark in inline code or a web address for a question", () => {
    const reply = [
      "- Haku tehdään kutsulla `GET /haku?q=tilaus`.",
      "- Ohje on osoitteessa https://example.com/ohje?kieli=fi.",
      "- Katso myös [ohje](https://example.com/ohje?kieli=fi) ja <https://example.com/?a=1>.",
      "- Onko `status?`-kenttä pakollinen?",
      "- Onko oikea osoite https://example.com/haku?",
    ].join("\n");
    expect(texts(reply)).toEqual([
      "Onko status?-kenttä pakollinen?",
      "Onko oikea osoite https://example.com/haku?",
    ]);
  });

  it("keeps the agent's own numbers when its list is numbered", () => {
    const reply = [
      "1. Taustaksi: tiedot menevät ERP:hen.",
      "2. Missä muodossa tilaukset saapuvat?",
      "3. Kuka tilaukset käsittelee?",
    ].join("\n");
    expect(numbers(reply)).toEqual([2, 3]);
    expect(numbers("4) Montako tilausta päivässä?\n5) Millä kielellä?")).toEqual([4, 5]);
  });

  it("numbers from 1 when the list is bulleted, mixed or repeats a number", () => {
    expect(numbers(ROUND)).toEqual([1, 2, 3]);
    expect(numbers("1. Mitä?\n2. Miksi?\n\nJa vielä:\n\n1. Milloin?")).toEqual([1, 2, 3]);
  });
});

describe("answersMessage", () => {
  const template = { intro: "Vastaukseni:", line: '{n}. "{question}": {answer}', skip: "skip" };

  it("numbers the answers as the questions are, quotes each question on one line and skips the empty ones", () => {
    expect(
      answersMessage(
        [
          { n: 2, text: 'Kysymys "A"\nrivi kaksi?' },
          { n: 3, text: "Kysymys B?" },
        ],
        ["  PDF   sähköpostilla ", " \n "],
        template,
      ),
    ).toBe("Vastaukseni:\n2. \"Kysymys 'A' rivi kaksi?\": PDF sähköpostilla\n3. \"Kysymys B?\": skip");
  });

  it("keeps the line breaks of an answer, its later lines indented under the first", () => {
    expect(answersMessage([{ n: 1, text: "Mitkä järjestelmät?" }], ["SAP  \n\n  Lemonsoft\nM-Files"], template)).toBe(
      'Vastaukseni:\n1. "Mitkä järjestelmät?": SAP\n   Lemonsoft\n   M-Files',
    );
  });
});

describe("a question that carries a number of its own", () => {
  it("drops the number inside the item, so the form shows one", () => {
    expect(questionsIn("- 1. Miten viat käsitellään nyt?\n- 2. Ketkä tarkastavat tiketit?")).toEqual([
      { n: 1, text: "Miten viat käsitellään nyt?" },
      { n: 2, text: "Ketkä tarkastavat tiketit?" },
    ]);
    expect(questionsIn("1. **1.** Missä muodossa?\n2. **2)** Kuinka monta?")).toEqual([
      { n: 1, text: "Missä muodossa?" },
      { n: 2, text: "Kuinka monta?" },
    ]);
  });

  it("keeps a number that is part of the question", () => {
    expect(questionsIn("- 24/7-päivystys vai arkisin?\n- 2 vai 3 hyväksyjää?")).toEqual([
      { n: 1, text: "24/7-päivystys vai arkisin?" },
      { n: 2, text: "2 vai 3 hyväksyjää?" },
    ]);
  });
});
