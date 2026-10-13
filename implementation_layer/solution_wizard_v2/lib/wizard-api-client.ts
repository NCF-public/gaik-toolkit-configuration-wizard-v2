import { TRACE_HEADER, getIncomingTraceId, getTraceId } from "@/lib/request-context";

const DEFAULT_API_URL = "http://localhost:8100";

/**
 * traceId for the outgoing wizard_api call (S3-10): prefer the
 * AsyncLocalStorage context withLogging set up (route handlers), falling
 * back to reading the header straight off the incoming request (Server
 * Actions, which never run inside that ALS scope).
 */
async function outgoingTraceId(): Promise<string> {
  return getTraceId() ?? (await getIncomingTraceId());
}

/** Shared service secret wizard_api checks on every call (#132). */
export const SERVICE_TOKEN_HEADER = "X-Wizard-Service-Token";

/**
 * Headers every outgoing wizard_api call needs: the traceId (S3-10) plus the
 * service token (#132). Centralised so a new call site can't quietly omit the
 * token. When WIZARD_API_TOKEN is unset the header is simply absent, matching
 * the api's own "unconfigured = auth off" mode — that keeps local dev and the
 * docker stack working, and means this is inert until the deployment sets it.
 */
export async function outgoingHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    [TRACE_HEADER]: await outgoingTraceId(),
  };
  const token = process.env.WIZARD_API_TOKEN?.trim();
  if (token) headers[SERVICE_TOKEN_HEADER] = token;
  return headers;
}

export function getWizardApiUrl(): string | null {
  const url = process.env.WIZARD_API_URL?.trim();
  return url || null;
}

export function wizardApiEnabled(): boolean {
  return Boolean(getWizardApiUrl());
}

// --- Agent chat (#29 frontend half) -----------------------------------------
//
// The live V1 agent runs in wizard_api (#29, backend — owned by wizard_api).
// This is only the FRONTEND consumer: when the agent chat endpoint is live we
// proxy the user's message to it and stream the reply straight through. It is
// gated behind an explicit opt-in flag so that, until that backend endpoint
// exists, dev/mock stays the default and nothing 404-spams.
//
// Proposed SSE contract (to confirm with wizard_api): the endpoint answers with
// `text/event-stream` frames identical to the UI's own chat SSE —
//   data: {"delta": "<token>"}   (repeated)
//   data: {"done": true}         (terminal)
//   data: {"error": true}        (on failure)
// so the route can pipe the upstream body through unchanged.

/** True when chat should be served by the wizard_api agent instead of the mock. */
export function wizardAgentChatEnabled(): boolean {
  return wizardApiEnabled() && process.env.WIZARD_AGENT_CHAT === "true";
}

/**
 * Open the upstream agent chat stream. Returns the raw fetch Response so the
 * caller can pipe `response.body` through as SSE. Never throws for HTTP errors —
 * the caller inspects `response.ok` and falls back to the mock on failure.
 */
export async function openAgentChatStream(
  id: string,
  message: string,
  locale?: string,
): Promise<Response> {
  const base = getWizardApiUrl() ?? DEFAULT_API_URL;
  return fetch(`${base}/sessions/${encodeURIComponent(id)}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(await outgoingHeaders()),
    },
    // `locale` pins the agent's reply language to the UI locale (fi/en).
    body: JSON.stringify(locale ? { message, locale } : { message }),
    cache: "no-store",
  });
}

async function wizardFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getWizardApiUrl() ?? DEFAULT_API_URL;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await outgoingHeaders()),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`wizard_api ${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export type ApiBlueprintVersion = {
  version: number;
  note: string;
  created_at: string;
};

export type ApiSessionDetail = {
  id: string;
  user_id: string;
  title: string;
  step: number;
  status: string;
  gate_statuses: Record<string, string>;
  metadata: Record<string, unknown>;
  output_dir: string;
  active_version: number;
  versions: ApiBlueprintVersion[];
  blueprint: {
    name: string;
    description: string;
    goal: string;
    steps: Array<{
      id: string;
      name: string;
      type: string;
      component?: string;
      description?: string;
    }>;
  };
  business_context?: {
    current_process: string;
    pain_points: string[];
    intended_users: string[];
    reviewers: string[];
    expected_value: string[];
    knowledge_processes: string[];
    domain: string;
  } | null;
  assumptions?: Array<{
    id: string;
    text: string;
    status: string;
    impact: string;
  }>;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
  created_at: string;
  updated_at: string;
};

export type ApiSessionSummary = {
  id: string;
  user_id: string;
  step: number;
  gate_statuses: Record<string, string>;
  metadata: Record<string, unknown>;
  output_dir: string;
  active_version: number;
  created_at: string;
  updated_at: string;
};

export async function apiCreateSession(userId: string, title: string) {
  return wizardFetch<ApiSessionDetail>("/sessions", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, title }),
  });
}

export async function apiListSessions(userId: string) {
  const data = await wizardFetch<{ sessions: ApiSessionSummary[] }>(
    `/sessions?user_id=${encodeURIComponent(userId)}`,
  );
  return data.sessions;
}

export async function apiGetSession(id: string) {
  return wizardFetch<ApiSessionDetail>(`/sessions/${id}`);
}

export async function apiPatchSession(
  id: string,
  body: {
    step?: number;
    gate_statuses?: Record<string, string>;
    metadata?: Record<string, unknown>;
  },
) {
  return wizardFetch<ApiSessionDetail>(`/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function apiPostMessages(
  id: string,
  userContent: string,
  assistantContent: string,
) {
  return wizardFetch<ApiSessionDetail>(`/sessions/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      user_content: userContent,
      assistant_content: assistantContent,
    }),
  });
}

export async function apiPostVersion(
  id: string,
  note: string,
  content?: ApiSessionDetail["blueprint"],
) {
  return wizardFetch<ApiSessionDetail>(`/sessions/${id}/versions`, {
    method: "POST",
    body: JSON.stringify({ note, content }),
  });
}

export async function apiPatchBlueprint(
  id: string,
  content: ApiSessionDetail["blueprint"],
  note = "Blueprint päivitetty",
) {
  return wizardFetch<ApiSessionDetail>(`/sessions/${id}/blueprint`, {
    method: "PATCH",
    body: JSON.stringify({ content, note }),
  });
}

export async function apiGetSessionBpmn(id: string): Promise<string> {
  const base = getWizardApiUrl() ?? DEFAULT_API_URL;
  const res = await fetch(`${base}/sessions/${id}/bpmn`, {
    headers: await outgoingHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`wizard_api ${res.status} /sessions/${id}/bpmn: ${text}`);
  }
  return res.text();
}

export async function apiSyncSessionBpmn(id: string, xml: string) {
  return wizardFetch<ApiSessionDetail>(`/sessions/${id}/bpmn/sync`, {
    method: "POST",
    body: JSON.stringify({ xml }),
  });
}
