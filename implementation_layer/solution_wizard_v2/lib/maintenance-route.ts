// Maintenance mode for the routes the proxy does not see (the file uploads,
// proxy.ts's matcher). Only who is calling decides it, so a route asks this
// before it looks the session up: that lookup asks wizard_api, which may be
// the very thing down for the break, and the browser would then get a 404
// without the signal to reload into the maintenance page.

import { getCurrentUser } from "@/lib/current-user";
import { maintenanceGate, maintenanceSettings } from "@/lib/maintenance";

/** The maintenance answer for this request, or null to go on. */
export async function maintenanceRefusal(path: string): Promise<Response | null> {
  const settings = maintenanceSettings();
  // Off or only planned: no sign-in lookup at all.
  if (settings.state !== "on") return null;
  const user = await getCurrentUser();
  return maintenanceGate(path, user?.email ?? null, settings);
}
