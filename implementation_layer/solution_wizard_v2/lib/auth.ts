// Lightweight dev login without Supabase.
// Enabled when NEXT_PUBLIC_DEV_AUTH=true (.env.local). Off in production,
// where Supabase auth is used normally.

export const DEV_AUTH = process.env.NEXT_PUBLIC_DEV_AUTH === "true";
export const DEV_COOKIE = "gaik_dev_session";

/** Dev-only accounts for local/demo (never enable in production). */
export const DEV_USERS: Record<string, string> = {
  "dev@gaik.local": "gaik",
  "dev2@gaik.local": "gaik2",
};

/** Primary account — form defaults and seeded mock sessions. */
export const DEV_USER = { email: "dev@gaik.local" };
export const DEV_CREDENTIALS = { email: DEV_USER.email, password: DEV_USERS[DEV_USER.email]! };

export function validateDevCredentials(email: string, password: string): boolean {
  return DEV_USERS[email] === password;
}

export function isDevUserEmail(email: string): boolean {
  return email in DEV_USERS;
}

export function formatDevAccountsHint(): string {
  return Object.entries(DEV_USERS)
    .map(([e, p]) => `${e} / ${p}`)
    .join(" · ");
}
