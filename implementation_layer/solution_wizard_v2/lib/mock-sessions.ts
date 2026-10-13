// Mock session model that locks the UI. Fields mirror the planned data model:
// a wizard session (id, user_id, step, gate status, metadata, output dir) and
// blueprint versions with an active version per session.
//
// NOTE: not persistent storage. Data lives in dev-server memory and resets on
// restart. Real persistence is wired to the same model later.

// Wizard phase model. Gates: Gate 1 requirement completeness (after
// Specification), Gate 2 workflow validation (after Blueprint+BPMN),
// Gate 3 PoC validation, Gate 4 runtime validation.
export const PHASES = [
  "Session start",
  "Vaatimusten keruu",
  "Spesifikaatio",
  "Gate 1",
  "Skeeman suunnittelu",
  "Komponenttivalinta",
  "Blueprint-kokoaminen",
  "Visuaalinen työnkulku (BPMN)",
  "Gate 2",
  "PoC",
  "Gate 3",
  "Dokumentaatio",
  "Gate 4",
] as const;

export const PHASE_COUNT = PHASES.length; // 13

/** 1-based step when BPMN visual workflow is generated (onboarding phase 8). */
export const BPMN_VISUAL_STEP = 8;

export function isBpmnVisualPhase(step: number): boolean {
  return step >= BPMN_VISUAL_STEP;
}

// 1-based gate step numbers: Gate 1 = 4, Gate 2 = 9, Gate 3 = 11, Gate 4 = 13.
export const GATE_STEPS = [4, 9, 11, 13];

export function isGateStep(step: number): boolean {
  return GATE_STEPS.includes(step);
}

export type GateStatus = "locked" | "pending" | "approved" | "rejected";

export type BlueprintVersion = {
  version: number;
  createdAt: string;
  note: string;
};

// Blueprint content (mock): name, goal, and workflow steps. Rendered by the
// workspace panel.
export type BlueprintStepType = "io" | "ai" | "human_review";

export type BlueprintStep = {
  id: string;
  name: string;
  type: BlueprintStepType;
  component?: string;
  description?: string;
};

export type Blueprint = {
  name: string;
  description: string;
  goal: string;
  steps: BlueprintStep[];
  /** Optional artifact label overrides synced from BPMN data objects. */
  data_objects?: Record<string, string>;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type WizardSession = {
  id: string;
  userId: string; // owner
  title: string;
  step: number; // 1..13 nykyinen vaihe
  gateStatus: Record<number, GateStatus>; // gate-vaihe -> status
  status: "active" | "done";
  outputDir: string; // output dir convention
  createdAt: string;
  updatedAt: string;
  versions: BlueprintVersion[]; // versions
  activeVersion: number;
  messages: ChatMessage[]; // chat-historia (mock)
  blueprint: Blueprint; // active version content (mock)
};

// Derive gate statuses from the current step: passed = approved, current =
// pending, future = locked.
function buildGateStatus(step: number): Record<number, GateStatus> {
  const m: Record<number, GateStatus> = {};
  for (const g of GATE_STEPS) {
    m[g] = step > g ? "approved" : step === g ? "pending" : "locked";
  }
  return m;
}

function outputDirFor(id: string): string {
  return `output/sessions/${id}/`;
}

/**
 * Dummy blueprint for a brand-new session (MIC012 / Pertti).
 * Gives BPMN a few editable elements until schema design (#25) supplies real fields.
 */
export function defaultBlueprint(title: string): Blueprint {
  return {
    name: title,
    description:
      "Placeholder blueprint until schema design — replace with the agreed output fields.",
    goal: "Draft flow so BPMN and JSON are editable from the first session.",
    steps: [
      {
        id: "input",
        name: "Input",
        type: "io",
        description: "User or system input (placeholder)",
      },
      {
        id: "process",
        name: "Process",
        type: "ai",
        component: "LLM",
        description: "Core GenAI step (placeholder)",
      },
      {
        id: "review",
        name: "Human review",
        type: "human_review",
        description: "Optional check before output (placeholder)",
      },
      {
        id: "output",
        name: "Output",
        type: "io",
        description: "Returned result (placeholder)",
      },
    ],
  };
}

// --- Mock store (in memory) -------------------------------------------------

const now = () => new Date().toISOString();

function seedSession(
  id: string,
  userId: string,
  title: string,
  step: number,
  versionCount: number,
  createdDaysAgo: number,
  blueprint: Blueprint,
  messages: ChatMessage[] = [],
): WizardSession {
  const created = new Date(
    Date.now() - createdDaysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  const versions: BlueprintVersion[] = Array.from(
    { length: versionCount },
    (_, i) => ({
      version: i + 1,
      createdAt: created,
      note: i === 0 ? "Initial blueprint" : `Change #${i + 1}`,
    }),
  );
  return {
    id,
    userId,
    title,
    step,
    gateStatus: buildGateStatus(step),
    status: step >= PHASE_COUNT ? "done" : "active",
    outputDir: outputDirFor(id),
    createdAt: created,
    updatedAt: created,
    versions,
    activeVersion: versionCount,
    messages,
    blueprint,
  };
}

// Seed data: three sessions at different steps so the list and stepper show
// real content. Owner = dev account so it shows in dev mode.
const DEV_OWNER = "dev@gaik.local";

function buildSeedSessions(): WizardSession[] {
  return [
  seedSession(
    "ses_chatbot",
    DEV_OWNER,
    "Customer service chatbot",
    6,
    3,
    5,
    {
      name: "Customer service chatbot",
      description:
        "Answers customers' most common questions in the online store.",
      goal: "Reduce customer service load by automating common questions.",
      steps: [
        {
          id: "input",
          name: "Customer question",
          type: "io",
          description: "Chat input in the online store",
        },
        {
          id: "retrieve",
          name: "Retrieval (RAG)",
          type: "ai",
          component: "pgvector",
          description: "Fetch relevant help articles",
        },
        {
          id: "generate",
          name: "Response generation",
          type: "ai",
          component: "Azure OpenAI",
          description: "Compose an answer from the retrieved content",
        },
        {
          id: "review",
          name: "Human review",
          type: "human_review",
          description: "Uncertain cases are routed to a human",
        },
        {
          id: "respond",
          name: "Reply to the customer",
          type: "io",
          description: "Send the answer to the chat",
        },
      ],
    },
    [
    {
      id: "msg_seed1",
      role: "user",
      content:
        "We'd like a chatbot that answers customers' most common questions in the online store.",
      createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    },
    {
      id: "msg_seed2",
      role: "assistant",
      content:
        "Got it. I've noted customer service automation as the goal. What are the main question types the bot should answer?",
      createdAt: new Date(Date.now() - 5 * 86400000 + 60000).toISOString(),
    },
  ]),
  seedSession(
    "ses_laskut",
    DEV_OWNER,
    "Automatic invoice classification",
    11,
    7,
    12,
    {
      name: "Automatic invoice classification",
      description: "Classify incoming purchase invoices by cost center.",
      goal: "Speed up invoice handling with automatic pre-classification.",
      steps: [
        {
          id: "ingest",
          name: "Invoice intake",
          type: "io",
          description: "PDF/e-invoice in",
        },
        {
          id: "extract",
          name: "Data extraction",
          type: "ai",
          component: "docling",
          description: "Extract amounts, supplier, references",
        },
        {
          id: "classify",
          name: "Classification",
          type: "ai",
          component: "LLM",
          description: "Suggest cost center and account",
        },
        {
          id: "approve",
          name: "Approval",
          type: "human_review",
          description: "Accountant confirms the classification",
        },
        {
          id: "export",
          name: "Export to finance system",
          type: "io",
          description: "Transfer to the system",
        },
      ],
    },
  ),
  seedSession("ses_cv", DEV_OWNER, "Recruitment CV screening", 2, 1, 1, {
    name: "Recruitment CV screening",
    description: "Screen applications against the open role's criteria.",
    goal: "Save recruiter time with pre-screening.",
    steps: [
      { id: "input", name: "Applications", type: "io", description: "CVs in" },
      {
        id: "score",
        name: "Scoring",
        type: "ai",
        component: "LLM",
        description: "Compare against criteria",
      },
      {
        id: "review",
        name: "Recruiter review",
        type: "human_review",
        description: "A human makes the final choice",
      },
      { id: "output", name: "Shortlist", type: "io", description: "Selected candidates forward" },
    ],
  }),
  ];
}

type MockGlobal = typeof globalThis & { __wizardMockSessions?: WizardSession[] };

const mockGlobal = globalThis as MockGlobal;
if (!mockGlobal.__wizardMockSessions) {
  mockGlobal.__wizardMockSessions = buildSeedSessions();
}
const sessions = mockGlobal.__wizardMockSessions;

/** Dev/test: restore seeded sessions (e.g. between E2E runs). */
export function resetMockSessions(): void {
  const fresh = buildSeedSessions();
  sessions.length = 0;
  sessions.push(...fresh);
}

// --- Read operations --------------------------------------------------------

export function listSessions(userId: string): WizardSession[] {
  return sessions
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSession(id: string): WizardSession | undefined {
  return sessions.find((s) => s.id === id);
}

// --- Write operations (mutate the in-memory store) -------------------------

export function createSession(userId: string, title: string): WizardSession {
  const id = "ses_" + crypto.randomUUID().slice(0, 8);
  const ts = now();
  const s: WizardSession = {
    id,
    userId,
    title: title.trim() || "Nimetön sessio",
    step: 1,
    gateStatus: buildGateStatus(1),
    status: "active",
    outputDir: outputDirFor(id),
    createdAt: ts,
    updatedAt: ts,
    versions: [{ version: 1, createdAt: ts, note: "Alustava blueprint" }],
    activeVersion: 1,
    messages: [],
    blueprint: defaultBlueprint(title.trim() || "Nimetön sessio"),
  };
  sessions.push(s);
  return s;
}

// Append the user message + (mock) assistant reply to the chat history.
// The reply text is passed in so it can be localized via i18n.
export function postMessage(
  id: string,
  userContent: string,
  assistantContent: string,
): WizardSession | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  const mkId = () => "msg_" + crypto.randomUUID().slice(0, 8);
  s.messages.push({
    id: mkId(),
    role: "user",
    content: userContent,
    createdAt: now(),
  });
  s.messages.push({
    id: mkId(),
    role: "assistant",
    content: assistantContent,
    createdAt: now(),
  });
  s.updatedAt = now();
  return s;
}

// Advance to the next step. On a gate step, blocked until approved.
export function advanceSession(id: string): WizardSession | undefined {
  const s = getSession(id);
  if (!s || s.step >= PHASE_COUNT) return s;
  if (isGateStep(s.step) && s.gateStatus[s.step] !== "approved") return s;

  s.step += 1;
  s.gateStatus = { ...s.gateStatus, ...buildGateStatus(s.step) };
  // Each step produces a new blueprint version.
  const v = s.versions.length + 1;
  s.versions.push({ version: v, createdAt: now(), note: `Vaihe ${s.step}` });
  s.activeVersion = v;
  s.status = s.step >= PHASE_COUNT ? "done" : "active";
  s.updatedAt = now();
  return s;
}

// Go back one step (does not remove versions).
export function regressSession(id: string): WizardSession | undefined {
  const s = getSession(id);
  if (!s || s.step <= 1) return s;
  s.step -= 1;
  s.gateStatus = buildGateStatus(s.step);
  s.status = "active";
  s.updatedAt = now();
  return s;
}

// Approve the current gate and advance.
export function approveGate(id: string): WizardSession | undefined {
  const s = getSession(id);
  if (!s || !isGateStep(s.step)) return s;
  s.gateStatus = { ...s.gateStatus, [s.step]: "approved" };
  s.updatedAt = now();
  // Final gate approved -> session done, no further advance.
  if (s.step >= PHASE_COUNT) {
    s.status = "done";
    return s;
  }
  return advanceSession(id);
}

export function updateBlueprint(
  id: string,
  blueprint: Blueprint,
  note = "BPMN canvas sync",
): WizardSession | undefined {
  const s = getSession(id);
  if (!s) return undefined;
  s.blueprint = blueprint;
  const v = s.versions.length + 1;
  s.versions.push({ version: v, createdAt: now(), note });
  s.activeVersion = v;
  s.updatedAt = now();
  return s;
}
