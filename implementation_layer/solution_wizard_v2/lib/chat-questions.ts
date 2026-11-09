import { fillTemplate, quoteOneLine } from "./chat-template";

/** Inline markdown reduced to its text: emphasis, code and links. */
function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The questions in an assistant message: the list items (bulleted or
 * numbered) that ask something. The agent asks a round of requirement
 * questions as such a list, and an answer field per question makes it plain
 * which answer goes with which question.
 */
export function questionsIn(markdown: string): string[] {
  const items: string[] = [];
  let current: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const item = line.match(/^\s{0,3}(?:[-*+]|\d{1,2}[.)])\s+(.*)$/);
    if (item) {
      if (current !== null) items.push(current);
      current = item[1];
    } else if (current !== null && /^\s{2,}\S/.test(line)) {
      // A wrapped line of the same item.
      current += ` ${line.trim()}`;
    } else {
      if (current !== null) items.push(current);
      current = null;
    }
  }
  if (current !== null) items.push(current);
  return items.map(plainText).filter((text) => text.includes("?"));
}

export type AnswerTemplate = {
  /** The first line of the message. */
  intro: string;
  /** One line per question: "{n}", "{question}" (quoted) and "{answer}". */
  line: string;
  /** The answer sent for a question left empty. */
  skip: string;
};

/**
 * The chat message for answers given one by one. Each question goes back as
 * a quote on one line with its number, so the agent's own text (partly from
 * uploaded material) reaches it as data; the answers are the user's words.
 */
export function answersMessage(questions: string[], answers: string[], template: AnswerTemplate): string {
  const lines = questions.map((question, i) =>
    fillTemplate(template.line, {
      n: String(i + 1),
      question: quoteOneLine(question, 160),
      answer: (answers[i] ?? "").replace(/\s+/g, " ").trim() || template.skip,
    }),
  );
  return [template.intro, ...lines].join("\n");
}
