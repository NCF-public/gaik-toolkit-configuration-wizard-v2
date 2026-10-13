"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  DEV_AUTH,
  DEV_COOKIE,
  formatDevAccountsHint,
  validateDevCredentials,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getIncomingTraceId } from "@/lib/request-context";

async function devSignIn(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const traceId = await getIncomingTraceId();

  if (validateDevCredentials(email, password)) {
    const cookieStore = await cookies();
    cookieStore.set(DEV_COOKIE, email, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    audit("auth.login", { actor: email, outcome: "success", traceId, mode: "dev" });
    revalidatePath("/", "layout");
    redirect("/");
  }

  // Never log the attempted password — only the email that was tried.
  audit("auth.login", { actor: email, outcome: "denied", traceId, mode: "dev" });
  redirect(
    "/login?error=" +
      encodeURIComponent(`Väärä dev-tunnus (${formatDevAccountsHint()})`),
  );
}

export async function login(formData: FormData) {
  if (DEV_AUTH) return devSignIn(formData);

  const email = formData.get("email") as string;
  const traceId = await getIncomingTraceId();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: formData.get("password") as string,
  });

  if (error) {
    audit("auth.login", { actor: email, outcome: "denied", traceId, mode: "supabase" });
    redirect("/login?error=" + encodeURIComponent(error.message));
  }

  audit("auth.login", { actor: email, outcome: "success", traceId, mode: "supabase" });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signup(formData: FormData) {
  if (DEV_AUTH) return devSignIn(formData);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    redirect("/login?error=" + encodeURIComponent(error.message));
  }

  redirect(
    "/login?message=" +
      encodeURIComponent(
        "Rekisteröinti onnistui. Tarkista sähköpostisi vahvistuslinkki, jos sähköpostivahvistus on päällä.",
      ),
  );
}

export async function signOut() {
  const traceId = await getIncomingTraceId();
  if (DEV_AUTH) {
    const cookieStore = await cookies();
    const email = cookieStore.get(DEV_COOKIE)?.value;
    cookieStore.delete(DEV_COOKIE);
    if (email) audit("auth.logout", { actor: email, outcome: "success", traceId, mode: "dev" });
    revalidatePath("/", "layout");
    redirect("/login");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  if (user?.email) {
    audit("auth.logout", { actor: user.email, outcome: "success", traceId, mode: "supabase" });
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
