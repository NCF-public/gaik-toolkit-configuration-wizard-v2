import type { WizardSession } from "@/lib/mock-sessions";
import type { Dict } from "@/lib/i18n";
import { recordRequirementAnswer } from "@/lib/sessions";

// Seam between the chat SSE endpoint and the assistant. The real V1 agent (#29)
// drops in here: replace the mock body with an agent call that returns the
// reply text (the route streams it token by token over SSE).
//
// For now it is a phase-aware mock. During gathering (steps 1–3) it records the
// user's message as the answer to the current Section-9 checklist question and
// returns the next question (or a wrap-up when all are gathered).
export async function resolveChatReply(
  id: string,
  session: WizardSession,
  userMessage: string,
  t: Dict,
): Promise<string> {
  const checklist = t.gate1Checklist;
  const answers = session.requirements?.answers ?? [];
  const gathering = session.step <= 3 && answers.length < checklist.length;

  if (gathering) {
    await recordRequirementAnswer(id, userMessage);
    const nextCount = answers.length + 1;
    return nextCount >= checklist.length
      ? t.chatGatheringDone
      : `${t.chatAck} ${checklist[nextCount]}`;
  }

  const phase = t.phases[session.step - 1];
  return `${t.chatMockReplyPre}"${phase}"${t.chatMockReplyPost}`;
}

/** Split a reply into stream tokens (word + trailing space). */
export function toStreamTokens(reply: string): string[] {
  return reply.match(/\S+\s*/g) ?? [reply];
}
