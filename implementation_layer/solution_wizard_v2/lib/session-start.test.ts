import { describe, expect, it } from "vitest";
import { chatLeads, exampleIn, examplesOffered, toggleExample } from "./session-start";

const sentences = {
  nonTechnical: "My background: not technical. ",
  technical: "My background: technical. ",
};
const prompts = ["We turn voice messages into tickets.", "We extract invoice fields."];

describe("chatLeads", () => {
  it("is on while the wizard gathers requirements and keeps no checklist", () => {
    expect(chatLeads(1, [])).toBe(true);
    expect(chatLeads(2, [])).toBe(true);
  });

  it("is off where the workspace has a view of its own", () => {
    // The specification's fields, Gate 1 and everything after it.
    expect(chatLeads(3, [])).toBe(false);
    expect(chatLeads(4, [])).toBe(false);
    // The mock store's checklist.
    expect(chatLeads(1, ["What is the input?"])).toBe(false);
  });
});

describe("examples in the message field", () => {
  it("puts an example into an empty field", () => {
    expect(toggleExample("", prompts[0], prompts, sentences)).toBe(prompts[0]);
  });

  it("keeps the background sentence in front of the example", () => {
    const withBackground = toggleExample(sentences.technical, prompts[1], prompts, sentences);
    expect(withBackground).toBe(`${sentences.technical}${prompts[1]}`);
    expect(exampleIn(withBackground, prompts, sentences)).toBe(1);
  });

  it("replaces one example with another, and takes a pressed one out again", () => {
    const first = toggleExample(sentences.nonTechnical, prompts[0], prompts, sentences);
    const second = toggleExample(first, prompts[1], prompts, sentences);
    expect(second).toBe(`${sentences.nonTechnical}${prompts[1]}`);
    expect(toggleExample(second, prompts[1], prompts, sentences)).toBe(sentences.nonTechnical);
    expect(toggleExample(prompts[0], prompts[0], prompts, sentences)).toBe("");
  });

  it("leaves the user's own words alone and offers no example over them", () => {
    const own = `${sentences.technical}We sort customer e-mails by hand.`;
    expect(examplesOffered(own, prompts, sentences)).toBe(false);
    expect(toggleExample(own, prompts[0], prompts, sentences)).toBe(own);
    expect(exampleIn(own, prompts, sentences)).toBeNull();
  });

  it("offers examples for an empty field, a background sentence alone and a picked example", () => {
    expect(examplesOffered("", prompts, sentences)).toBe(true);
    expect(examplesOffered(sentences.technical, prompts, sentences)).toBe(true);
    expect(examplesOffered(`${prompts[0]} `, prompts, sentences)).toBe(true);
    // An example the user went on to edit is their own text.
    expect(examplesOffered(`${prompts[0]} In Finnish.`, prompts, sentences)).toBe(false);
  });
});
