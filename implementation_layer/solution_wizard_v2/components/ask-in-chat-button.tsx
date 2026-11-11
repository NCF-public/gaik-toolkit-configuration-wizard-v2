"use client";

import { askInChat, type ChatReference } from "@/lib/chat-events";
import { Icon } from "./icons";

/**
 * A small button beside one item on the page that opens the chat with the item
 * as a reference, so a change to exactly that item goes to the agent. With a
 * mouse it shows when the row it sits in is hovered or holds the focus; on a
 * touch screen it is always there.
 */
export function AskInChatButton({
  reference,
  label,
  title,
}: {
  reference: ChatReference;
  /** Accessible name, naming the item ("Muuta chatissa: Oletus 2"). */
  label: string;
  /** Tooltip ("Muuta chatissa"). */
  title: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={() => askInChat(reference)}
      className="icon-btn -my-1 h-7 w-7 transition-[opacity,background-color,color] duration-150 pointer-fine:opacity-0 pointer-fine:group-hover/item:opacity-100 pointer-fine:group-focus-within/item:opacity-100"
    >
      <Icon name="messageSquareText" size={15} />
    </button>
  );
}
