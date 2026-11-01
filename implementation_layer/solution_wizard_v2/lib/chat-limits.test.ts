import { describe, expect, it } from "vitest";
import { MAX_CHAT_MESSAGE_CHARS, chatMessageTooLong } from "./chat-limits";

describe("chat message limit", () => {
  it("accepts a message up to the limit", () => {
    expect(chatMessageTooLong("x".repeat(MAX_CHAT_MESSAGE_CHARS))).toBe(false);
  });

  it("refuses a longer one", () => {
    expect(chatMessageTooLong("x".repeat(MAX_CHAT_MESSAGE_CHARS + 1))).toBe(true);
  });
});
