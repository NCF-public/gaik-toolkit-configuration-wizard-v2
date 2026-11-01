import { DEV_AUTH } from "@/lib/auth";
import { wizardApiEnabled } from "@/lib/wizard-api-client";
import { resetMockSessions } from "@/lib/mock-sessions";
import { withLogging } from "@/lib/with-logging";

export const dynamic = "force-dynamic";

export const POST = withLogging("dev.reset-mocks", async () => {
  // These routes need no sign-in, so they exist only for the in-memory mock
  // store that E2E runs use; a stack with a real wizard_api has none of them.
  if (!DEV_AUTH || wizardApiEnabled()) {
    return new Response("Forbidden", { status: 403 });
  }
  resetMockSessions();
  return Response.json({ ok: true });
});
