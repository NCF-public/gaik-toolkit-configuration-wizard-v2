const DEFAULT_API_URL = "http://localhost:8100";

export function getWizardApiUrl(): string | null {
  const url = process.env.WIZARD_API_URL?.trim();
  return url || null;
}

export function wizardApiEnabled(): boolean {
  return Boolean(getWizardApiUrl());
}

async function wizardFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getWizardApiUrl() ?? DEFAULT_API_URL;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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
    integration_targets?: string[];
  };
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
  const res = await fetch(`${base}/sessions/${id}/bpmn`, { cache: "no-store" });
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
