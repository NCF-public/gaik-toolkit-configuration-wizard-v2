import { DEV_AUTH } from "@/lib/auth";
import { resetMockSessions } from "@/lib/mock-sessions";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!DEV_AUTH) {
    return new Response("Forbidden", { status: 403 });
  }
  resetMockSessions();
  return Response.json({ ok: true });
}
