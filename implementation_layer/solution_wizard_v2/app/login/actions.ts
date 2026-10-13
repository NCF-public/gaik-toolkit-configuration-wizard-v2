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

async function devSignIn(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (validateDevCredentials(email, password)) {
    const cookieStore = await cookies();
    cookieStore.set(DEV_COOKIE, email, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    revalidatePath("/", "layout");
    redirect("/");
  }

  redirect(
    "/login?error=" +
      encodeURIComponent(`Väärä dev-tunnus (${formatDevAccountsHint()})`),
  );
}

export async function login(formData: FormData) {
  if (DEV_AUTH) return devSignIn(formData);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    redirect("/login?error=" + encodeURIComponent(error.message));
  }

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
  if (DEV_AUTH) {
    const cookieStore = await cookies();
    cookieStore.delete(DEV_COOKIE);
    revalidatePath("/", "layout");
    redirect("/login");
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
