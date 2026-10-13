// Shared helper to get the signed-in user.
// Works in both dev mode (cookie) and Supabase mode, with the same logic
// as the middleware and login action. Use this in server components; do not
// repeat the DEV_AUTH branching on every page.

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DEV_AUTH, DEV_COOKIE, isDevUserEmail } from "@/lib/auth";

export type CurrentUser = { email: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (DEV_AUTH) {
    const cookieStore = await cookies();
    const email = cookieStore.get(DEV_COOKIE)?.value;
    if (!email || !isDevUserEmail(email)) return null;
    return { email };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.email ? { email: data.user.email } : null;
}
