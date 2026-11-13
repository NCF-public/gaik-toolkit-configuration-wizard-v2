/**
 * The start of a session. While the wizard gathers requirements the session
 * happens in the chat, and with the live agent the workspace has nothing of
 * its own to show before the specification: it held one paragraph that sent
 * the reader to the chat beside it. There the chat is the page instead, and an
 * empty one opens with a question, the field and a few examples to start from.
 */
import { backgroundIn, type Background } from "@/lib/chat-background";

/** The steps before the specification: session start and requirements gathering. */
const LAST_CHAT_ONLY_STEP = 2;

/**
 * True while the chat is the page's main content. The mock store keeps a
 * checklist for these steps (`points`), which is a view of its own, so there
 * the chat stays docked beside it.
 */
export function chatLeads(step: number, points: readonly string[]): boolean {
  return step <= LAST_CHAT_ONLY_STEP && points.length === 0;
}

type Sentences = Record<Background, string>;

/** What the field holds after the background sentence, if it starts with one. */
function afterBackground(input: string, sentences: Sentences): string {
  const chosen = backgroundIn(input, sentences);
  return (chosen ? input.slice(sentences[chosen].trimEnd().length) : input).trim();
}

/** The example whose prompt the field holds as it was picked, if any. */
export function exampleIn(
  input: string,
  prompts: readonly string[],
  sentences: Sentences,
): number | null {
  const rest = afterBackground(input, sentences);
  if (!rest) return null;
  const at = prompts.findIndex((prompt) => prompt.trim() === rest);
  return at < 0 ? null : at;
}

/**
 * Examples are a way to start an empty field. Once the user has written words
 * of their own, an example would replace them, so none is offered.
 */
export function examplesOffered(
  input: string,
  prompts: readonly string[],
  sentences: Sentences,
): boolean {
  return afterBackground(input, sentences) === "" || exampleIn(input, prompts, sentences) !== null;
}

/**
 * The field after an example is pressed: its prompt goes after the background
 * sentence, in place of another example; pressing the one already there takes
 * it out again. Words the user wrote themselves are left as they are.
 */
export function toggleExample(
  input: string,
  prompt: string,
  prompts: readonly string[],
  sentences: Sentences,
): string {
  if (!examplesOffered(input, prompts, sentences)) return input;
  const chosen = backgroundIn(input, sentences);
  const lead = chosen ? sentences[chosen] : "";
  const current = exampleIn(input, prompts, sentences);
  const same = current !== null && prompts[current].trim() === prompt.trim();
  return same ? lead : `${lead}${prompt}`;
}
