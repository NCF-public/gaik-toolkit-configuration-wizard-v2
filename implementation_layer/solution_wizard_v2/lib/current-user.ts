// Shared helper to get the signed-in user.
// Works in both dev mode (cookie) and Supabase mode, with the same logic
// as the middleware and login action. Use this in server components; do not
// repeat the DEV_AUTH branching on every page.

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DEV_AUTH, DEV_COOKIE, isAllowedUser } from "@/lib/auth";
import { verifyDevSession } from "@/lib/dev-session";

export type CurrentUser = { email: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (DEV_AUTH) {
    const cookieStore = await cookies();
    const email = await verifyDevSession(cookieStore.get(DEV_COOKIE)?.value);
    return email ? { email } : null;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  // A Supabase account alone is not enough: only listed, confirmed accounts (lib/auth).
  const user = data.user;
  return user?.email && isAllowedUser(user) ? { email: user.email } : null;
}
