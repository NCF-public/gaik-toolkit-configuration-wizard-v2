// Upper bound for one chat message, in characters. The API refuses longer ones
// too (WIZARD_MAX_CHAT_MESSAGE_CHARS, default the same); checking here first
// keeps an oversized body from being forwarded at all. Every message is a
// model call billed by length, and a pasted document belongs in an upload.
export const MAX_CHAT_MESSAGE_CHARS = 20_000;

export function chatMessageTooLong(message: string): boolean {
  return message.length > MAX_CHAT_MESSAGE_CHARS;
}
