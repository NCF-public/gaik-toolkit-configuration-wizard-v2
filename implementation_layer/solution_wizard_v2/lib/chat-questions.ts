import { fillTemplate, quoteOneLine } from "./chat-template";

/** A question the agent asked, and the number its answer goes back under. */
export type Question = { n: number; text: string };

/** Inline markdown reduced to its text: emphasis, code and links. */
function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A question's text without a number of its own in front. The agent sometimes
 * numbers inside the item as well ("- 1. Where…?", "1. **1.** Where…?"), and
 * the form puts the question's number before the text, so it read "1. 1. …".
 */
function withoutOwnNumber(text: string): string {
  return text.replace(/^\d{1,2}[.)]\s+(?=\S)/, "");
}

/**
 * Whether a list item asks something: a "?" in its own words. One inside
 * inline code or a web address (a query string) does not count; the mark
 * that ends a sentence after an address does.
 */
function asksSomething(markdown: string): boolean {
  return markdown
    .replace(/(`+).*?\1(?!`)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(?:https?:\/\/|www\.)[^\s<>]*[^\s<>?.,!;:'")\]]/gi, " ")
    .includes("?");
}

/**
 * The questions in an assistant message: the list items (bulleted or
 * numbered) that ask something. The agent asks a round of requirement
 * questions as such a list, and an answer field per question makes it plain
 * which answer goes with which question. Nothing inside a fenced code block
 * is a question. A question keeps the agent's own number when every question
 * found has one and no two share it; otherwise they are numbered from 1.
 */
export function questionsIn(markdown: string): Question[] {
  const items: { number: number | null; text: string }[] = [];
  let current: { number: number | null; text: string } | null = null;
  let fence: string | null = null;
  const close = () => {
    if (current !== null) items.push(current);
    current = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const mark = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fence !== null) {
      // The block ends at a fence of the same kind, at least as long.
      if (mark && mark[2][0] === fence[0] && mark[2].length >= fence.length) fence = null;
      continue;
    }
    if (mark) {
      // An indented block belongs to the item above it; any other ends it.
      if (mark[1].length < 2) close();
      fence = mark[2];
      continue;
    }
    const item = line.match(/^\s{0,3}(?:[-*+]|(\d{1,2})[.)])\s+(.*)$/);
    if (item) {
      close();
      current = { number: item[1] ? Number(item[1]) : null, text: item[2] };
    } else if (current !== null && /^\s{2,}\S/.test(line)) {
      // A wrapped line of the same item.
      current.text += ` ${line.trim()}`;
    } else {
      close();
    }
  }
  close();
  const asked = items.filter((item) => asksSomething(item.text));
  const numbers = asked.map((item) => item.number);
  const agentNumbered =
    numbers.every((n) => n !== null) && new Set(numbers).size === numbers.length;
  return asked.map((item, i) => ({
    n: agentNumbered ? (item.number as number) : i + 1,
    text: withoutOwnNumber(plainText(item.text)),
  }));
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
 * An answer as it was typed: its line breaks stay (a list of systems, say),
 * with the later lines indented under the first so the whole answer stays
 * with its number. Blank lines and space at the ends of lines are dropped.
 */
function answerText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n   ");
}

/**
 * The chat message for answers given one by one. Each question goes back as
 * a quote on one line with its number, so the agent's own text (partly from
 * uploaded material) reaches it as data; the answers are the user's words.
 */
export function answersMessage(questions: Question[], answers: string[], template: AnswerTemplate): string {
  const lines = questions.map((question, i) =>
    fillTemplate(template.line, {
      n: String(question.n),
      question: quoteOneLine(question.text, 160),
      answer: answerText(answers[i] ?? "") || template.skip,
    }),
  );
  return [template.intro, ...lines].join("\n");
}
