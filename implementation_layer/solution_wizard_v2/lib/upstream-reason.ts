/**
 * Why wizard_api refused a call, in one short line a user can read.
 *
 * wizard_api answers FastAPI's `{ "detail": "..." }` or, for the gates and the
 * run checks, `{ "detail": { "error": "...", "message": "..." } }`. The PoC
 * routes used to drop that body and say only "generation failed", although the
 * api had said why ("approve Gate 2 before generating the PoC package"). The
 * reason is shortened and flattened to one line; anything that is not text is
 * ignored.
 */
export const REASON_MAX_CHARS = 300;

export function reasonFromDetail(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  let text: unknown = detail;
  if (typeof detail === "object" && detail !== null) {
    const d = detail as { message?: unknown; error?: unknown };
    text = d.message ?? d.error;
  }
  if (typeof text !== "string") return null;
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > REASON_MAX_CHARS ? `${oneLine.slice(0, REASON_MAX_CHARS - 1)}…` : oneLine;
}

/** The reason in a failed upstream response, or null when it has none. */
export async function upstreamReason(res: Response): Promise<string | null> {
  try {
    return reasonFromDetail(await res.json());
  } catch {
    return null;
  }
}
