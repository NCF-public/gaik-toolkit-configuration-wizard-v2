import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { DEV_AUTH, DEV_COOKIE, isDevUserEmail } from "@/lib/auth";
import { TRACE_HEADER } from "@/lib/trace-header";

// Edge runtime (middleware) can't use node:async_hooks, so traceId
// propagation here is just a header, not the AsyncLocalStorage context that
// route handlers get via withLogging (lib/with-logging.ts). crypto.randomUUID
// is a Web API, safe on Edge.
function withTraceId(request: NextRequest, response: NextResponse): NextResponse {
  const traceId = request.headers.get(TRACE_HEADER) ?? crypto.randomUUID();
  response.headers.set(TRACE_HEADER, traceId);
  return response;
}

function nextWithTraceId(request: NextRequest): NextResponse {
  const traceId = request.headers.get(TRACE_HEADER) ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TRACE_HEADER, traceId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(TRACE_HEADER, traceId);
  return response;
}

export async function middleware(request: NextRequest) {
  // Dev mode: simple cookie check, no Supabase.
  if (DEV_AUTH) {
    const email = request.cookies.get(DEV_COOKIE)?.value;
    const hasSession = Boolean(email && isDevUserEmail(email));
    const path = request.nextUrl.pathname;
    const isPublic =
      path.startsWith("/login") || path.startsWith("/api/dev/");
    if (!hasSession && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return withTraceId(request, NextResponse.redirect(url));
    }
    return nextWithTraceId(request);
  }

  // Production path: Supabase session refresh + route protection.
  // Only sets the *response* traceId header here, not a request header into
  // updateSession — that function has an explicit "don't add code between
  // getUser and returning the response" warning for cookie-refresh
  // correctness, and this path is dormant without NEXT_PUBLIC_SUPABASE_URL
  // (dev/demo always takes the DEV_AUTH branch above). Route handlers still
  // get a valid traceId either way — withLogging generates one when the
  // request header is missing.
  return withTraceId(request, await updateSession(request));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
