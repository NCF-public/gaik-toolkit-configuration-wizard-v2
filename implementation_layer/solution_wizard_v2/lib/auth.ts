// Lightweight dev login without Supabase.
// Enabled when NEXT_PUBLIC_DEV_AUTH=true (.env.local). Off in production,
// where Supabase auth is used normally.

export const DEV_AUTH = process.env.NEXT_PUBLIC_DEV_AUTH === "true";
export const DEV_COOKIE = "gaik_dev_session";

/** Built-in accounts for a local checkout (`next dev`) and its tests only. */
const LOCAL_DEV_USERS: Record<string, string> = {
  "dev@gaik.local": "gaik",
  "dev2@gaik.local": "gaik2",
};

/** `email:password,email:password` → map; malformed entries are skipped. */
export function parseDevUsers(raw: string): Record<string, string> {
  const users: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const at = entry.indexOf(":");
    if (at <= 0) continue;
    const email = entry.slice(0, at).trim();
    const password = entry.slice(at + 1).trim();
    if (email && password) users[email] = password;
  }
  return users;
}

/**
 * The dev accounts. A deployed instance (Rahti, compose) sets them in
 * WIZARD_DEV_USERS from its own secret: the built-in ones are in this public
 * repository, so a production build without the variable has no dev account
 * at all rather than falling back to them.
 */
export function devUsers(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const configured = env.WIZARD_DEV_USERS?.trim();
  if (configured) return parseDevUsers(configured);
  return env.NODE_ENV === "production" ? {} : LOCAL_DEV_USERS;
}

export const DEV_USERS: Record<string, string> = devUsers();

export function validateDevCredentials(email: string, password: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEV_USERS, email) && DEV_USERS[email] === password;
}

export function isDevUserEmail(email: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEV_USERS, email);
}
