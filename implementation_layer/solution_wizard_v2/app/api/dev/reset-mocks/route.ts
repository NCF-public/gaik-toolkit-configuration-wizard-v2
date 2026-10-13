import { DEV_AUTH } from "@/lib/auth";
import { resetMockSessions } from "@/lib/mock-sessions";
import { withLogging } from "@/lib/with-logging";

export const dynamic = "force-dynamic";

export const POST = withLogging("dev.reset-mocks", async () => {
  if (!DEV_AUTH) {
    return new Response("Forbidden", { status: 403 });
  }
  resetMockSessions();
  return Response.json({ ok: true });
});
