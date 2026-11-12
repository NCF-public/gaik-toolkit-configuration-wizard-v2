/**
 * "Who is the user": before the first message the chat offers two chips, not
 * technical and technical. A chip puts one plain sentence at the start of the
 * message field, so it reaches the agent as the user's own words in their
 * first message, where they can edit it. Nothing is stored on the server.
 */

export const BACKGROUNDS = ["nonTechnical", "technical"] as const;
export type Background = (typeof BACKGROUNDS)[number];

/** The chip a viewer last chose; a per-browser convenience. */
export const BACKGROUND_KEY = "gaik-wizard.chat-background";

export function isBackground(value: unknown): value is Background {
  return typeof value === "string" && (BACKGROUNDS as readonly string[]).includes(value);
}

/** The chosen background whose sentence the message starts with, if any. */
export function backgroundIn(input: string, sentences: Record<Background, string>): Background | null {
  for (const b of BACKGROUNDS) {
    if (sentences[b].trim() && input.startsWith(sentences[b].trimEnd())) return b;
  }
  return null;
}

/**
 * The message field after a chip is pressed: its sentence goes first, in place
 * of the other chip's; pressing the chip that is already on takes its sentence
 * out again. What the user wrote after it stays.
 */
export function toggleBackground(
  input: string,
  chosen: Background,
  sentences: Record<Background, string>,
): string {
  const current = backgroundIn(input, sentences);
  const rest = current ? input.slice(sentences[current].trimEnd().length).replace(/^ /, "") : input;
  if (current === chosen) return rest;
  return `${sentences[chosen]}${rest}`;
}

/**
 * The sentence of the chip a viewer chose in an earlier session, for the field
 * of a new one: still theirs to edit or remove. Null when none was chosen or
 * the browser's storage is blocked.
 */
export function savedBackgroundSentence(labels: {
  nonTechnicalText: string;
  technicalText: string;
}): string | null {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(BACKGROUND_KEY);
  } catch {
    // Storage blocked: nothing was remembered.
  }
  if (!isBackground(saved)) return null;
  return saved === "technical" ? labels.technicalText : labels.nonTechnicalText;
}
