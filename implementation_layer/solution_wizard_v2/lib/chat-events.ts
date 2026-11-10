/**
 * Sends a message through the chat from elsewhere on the page (an answer
 * typed into the requirement checklist): `detail` is the message text. It
 * goes through the same chat turn as a typed message, so the agent records
 * it with its own tools and the page has no second path to the backend.
 */
export const CHAT_SEND_EVENT = "gaik-wizard:chat-send";

/**
 * A message from CHAT_SEND_EVENT that never reached the agent: the wizard
 * stayed busy with another turn, or the request failed before it started.
 * `detail` is the message text, so its sender can offer it again.
 */
export const CHAT_SEND_FAILED_EVENT = "gaik-wizard:chat-send-failed";

/**
 * A message from CHAT_SEND_EVENT the agent has started on: `detail` is the
 * message text. Until then it is only on its way (the wizard may be busy with
 * another turn), so its sender does not call it sent before this.
 */
export const CHAT_SEND_STARTED_EVENT = "gaik-wizard:chat-send-started";

/** A message from CHAT_SEND_EVENT waiting for the chat panel to send it. */
export type QueuedMessage = { id: number; text: string };
