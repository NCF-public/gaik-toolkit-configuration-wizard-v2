// Cross-site request guard for state-changing API calls.
//
// Route handlers, unlike Server Actions, get no Origin check from Next, and a
// cross-site form or fetch with a simple content type still carries the
// session cookie (SameSite=Lax lets top-level POSTs from the same site through,
// and other apps on the same parent domain may count as the same site). A
// browser always sends Origin on such a request, so a write whose Origin is not
// this host is refused. Calls without Origin and Sec-Fetch-Site (scripts, test
// clients) are not browser requests and are left to the session check.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requestHost(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || headers.get("host");
}

export function isCrossSiteWrite(req: { method: string; headers: Headers }): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const origin = req.headers.get("origin");
  if (origin) {
    const host = requestHost(req.headers);
    try {
      return !host || new URL(origin).host !== host;
    } catch {
      return true; // "null" (sandboxed frames, file:) and other non-URLs
    }
  }
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  return false;
}
