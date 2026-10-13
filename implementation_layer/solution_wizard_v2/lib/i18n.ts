// Cookie-based i18n (fi/en), works in server rendering.
// The locale is stored in a cookie and read in server components via getI18n().
// Switching happens via a server action (app/locale-actions.ts) + LocaleSwitcher.

import { cookies } from "next/headers";

export const LOCALES = ["fi", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fi";
export const LOCALE_COOKIE = "gaik_locale";

// BCP-47 tag per locale for date formatting.
export const DATE_LOCALE: Record<Locale, string> = {
  fi: "fi-FI",
  en: "en-GB",
};

export type Dict = {
  appName: string;
  signOut: string;

  // login
  loginSubtitle: string;
  devHintPre: string;
  devHintPost: string;
  email: string;
  password: string;
  login: string;
  signup: string;

  // session list
  sessionsTitle: string;
  sessionsIntro: string;
  newSessionPlaceholder: string;
  startNew: string;
  previousSessions: string;
  noSessions: string;
  done: string;
  step: string;
  blueprintVersions: string;
  updated: string;

  // wizard
  backToSessions: string;
  chat: string;
  chatPlaceholder: string;
  chatGreeting: string;
  chatInputPlaceholder: string;
  chatSend: string;
  chatMockReplyPre: string;
  chatMockReplyPost: string;
  workspace: string;
  activeBlueprint: string;
  versions: string;
  phaseUpper: string;
  workspacePlaceholder: string;
  wsTabFlow: string;
  wsTabJson: string;
  wsTabPoc: string;
  wsBlueprintGoal: string;
  wsStepAi: string;
  wsStepHuman: string;
  wsStepIo: string;
  wsBpmnLoading: string;
  wsBpmnError: string;
  wsBpmnSpikeNote: string;
  wsBpmnV2Started: string;
  wsBpmnReadOnly: string;
  wsBpmnEditable: string;
  wsBpmnSave: string;
  wsBpmnSaving: string;
  wsBpmnSaveError: string;
  wsBpmnSaved: string;
  wsBpmnLintBlocked: string;
  wsBpmnLintWarnings: string;
  wsBpmnDialogTitle: string;
  wsBpmnInlineHint: string;
  wsBpmnZoomIn: string;
  wsBpmnZoomOut: string;
  wsBpmnOverview: string;
  wsBpmnReadable: string;
  wsBpmnToolbar: string;
  wsBpmnThemeLabel: string;
  wsBpmnThemeLight: string;
  wsBpmnThemeDark: string;
  wsBpmnThemeGaik: string;
  wsBpmnPropertiesTitle: string;
  wsBpmnPropertiesEmpty: string;
  wsBpmnPropertiesName: string;
  wsBpmnPropertiesType: string;
  wsBpmnPropertiesId: string;
  wsJsonSave: string;
  wsJsonSaving: string;
  wsJsonSaveError: string;
  wsJsonSaved: string;
  wsJsonInvalid: string;
  wsJsonHint: string;
  pocRun: string;
  pocRunning: string;
  pocRerun: string;
  pocIdle: string;
  pocSuccess: string;
  pocFailed: string;
  pocLogStart: string;
  pocLogDeps: string;
  pocLogStep: string;
  pocLogStepOk: string;
  pocLogValidate: string;
  pocLogDone: string;
  gateNotice: string;
  previous: string;
  nextPhase: string;
  approveGate: string;
  rejectGate: string;
  requestChanges: string;
  changesRequested: string;
  gate1Title: string;
  gate1Intro: string;
  gate1ChecklistTitle: string;
  gate1Answered: string;
  gate1Approve: string;
  gatheringCollecting: string;
  gatheringPrompt: string;
  gatheringAdvanceHint: string;
  ready: string;
  phasesTitle: string;
  saved: string;
  gateWaiting: string;
  skipToContent: string;
  sessionNameLabel: string;
  chatInputLabel: string;
  hideChat: string;
  showChat: string;
  phaseProgressNav: string;
  streamFailed: string;
  chatThinking: string;
  chatBusy: string;

  phases: string[];
  gates: { locked: string; pending: string; approved: string; rejected: string };
};

const fi: Dict = {
  appName: "GAIK Solution Wizard",
  signOut: "Kirjaudu ulos",

  loginSubtitle: "Kirjaudu jatkaaksesi",
  devHintPre: "Dev-tila päällä. Kirjaudu tunnuksilla",
  devHintPost: "(esitäytetty alle).",
  email: "Sähköposti",
  password: "Salasana",
  login: "Kirjaudu",
  signup: "Rekisteröidy",

  sessionsTitle: "Wizard-sessiot",
  sessionsIntro:
    "Aloita uusi käyttötapaus tai jatka aiempaa siitä vaiheesta mihin jäit.",
  newSessionPlaceholder: "Uuden session nimi (esim. Asiakaspalvelun chatbot)",
  startNew: "Aloita uusi",
  previousSessions: "Aiemmat sessiot",
  noSessions: "Ei vielä sessioita. Aloita uusi yltä.",
  done: "Valmis",
  step: "Vaihe",
  blueprintVersions: "blueprint-versiota",
  updated: "Päivitetty",

  backToSessions: "← Sessiot",
  chat: "Keskustelu",
  chatPlaceholder:
    "Chat-paneeli (placeholder). Tähän tulevat vaatimuskeruu ja gate-hyväksynnät.",
  chatGreeting:
    "Hei! Kerro liiketoimintaongelmasta, niin autan muotoilemaan siitä GenAI-käyttötapauksen.",
  chatInputPlaceholder: "Kirjoita viesti…",
  chatSend: "Lähetä",
  chatMockReplyPre: "Kiitos viestistä. Kirjasin sen vaiheeseen ",
  chatMockReplyPost:
    ". (Mock-vastaus — varsinainen agentti kytketään myöhemmin.)",
  workspace: "Työtila",
  activeBlueprint: "Aktiivinen blueprint",
  versions: "versiota",
  phaseUpper: "VAIHE",
  workspacePlaceholder:
    "BPMN-canvas / JSON-blueprint / PoC / dokumentaatio (placeholder). Tämän vaiheen sisältö renderöityy tähän.",
  wsTabFlow: "Työnkulku",
  wsTabJson: "Blueprint (JSON)",
  wsTabPoc: "PoC",
  wsBlueprintGoal: "Tavoite",
  wsStepAi: "AI-vaihe",
  wsStepHuman: "Ihmistarkistus",
  wsStepIo: "I/O",
  wsBpmnLoading: "Ladataan BPMN-kaaviota…",
  wsBpmnError: "BPMN-kaavion lataus epäonnistui.",
  wsBpmnSpikeNote:
    "V2 BPMN (#34): generoitu blueprint-JSONista (V1 bpmn_generator). Tallenna synkkaa canvas → JSON → BPMN.",
  wsBpmnV2Started: "V2 aloitettu",
  wsBpmnReadOnly: "Vain katselu",
  wsBpmnEditable: "Muokattava",
  wsBpmnSave: "Tallenna → JSON",
  wsBpmnSaving: "Tallennetaan…",
  wsBpmnSaveError: "Tallennus epäonnistui",
  wsBpmnSaved: "Tallennettu",
  wsBpmnLintBlocked: "BPMN-validointi esti tallennuksen (bpmnlint)",
  wsBpmnLintWarnings: "BPMN-varoitukset",
  wsBpmnDialogTitle: "Visuaalinen työnkulku (BPMN)",
  wsBpmnInlineHint:
    "Muokkaa kaaviota bpmn-js Modelerilla. Koko prosessi -näkymä mahtuu alueelle; voit scrollata sivua ja panna kaaviota hiirellä. Tallenna synkkaa JSONiin.",
  wsBpmnZoomIn: "Lähennä",
  wsBpmnZoomOut: "Loitonna",
  wsBpmnOverview: "Koko prosessi",
  wsBpmnReadable: "Luettava",
  wsBpmnToolbar: "Näkymä ja zoomaus",
  wsBpmnThemeLabel: "Kaavion teema",
  wsBpmnThemeLight: "Vaalea — häikäisylle",
  wsBpmnThemeDark: "Musta-valkoinen",
  wsBpmnThemeGaik: "GAIK v2",
  wsBpmnPropertiesTitle: "Ominaisuudet",
  wsBpmnPropertiesEmpty: "Valitse tehtävä tai dataobjekti kaaviosta.",
  wsBpmnPropertiesName: "Nimi",
  wsBpmnPropertiesType: "Tyyppi",
  wsBpmnPropertiesId: "Id",
  wsJsonSave: "Tallenna blueprint",
  wsJsonSaving: "Tallennetaan…",
  wsJsonSaveError: "Tallennus epäonnistui",
  wsJsonSaved: "Tallennettu",
  wsJsonInvalid: "Virheellinen blueprint-JSON",
  wsJsonHint:
    "Muokkaa blueprint-JSONia suoraan. Tallenna päivittää sessionin ja generoi BPMN-kaavion uudelleen Työnkulku-välilehdellä.",
  pocRun: "Aja PoC",
  pocRunning: "Ajetaan…",
  pocRerun: "Aja PoC uudelleen",
  pocIdle: "PoC:tä ei ole vielä ajettu. Aja se nähdäksesi lokit ja tuloksen.",
  pocSuccess: "Onnistui",
  pocFailed: "Epäonnistui",
  pocLogStart: "Käynnistetään eristetty PoC-ympäristö…",
  pocLogDeps: "Asennetaan riippuvuudet…",
  pocLogStep: "Suoritetaan vaihe:",
  pocLogStepOk: "valmis",
  pocLogValidate: "Validoidaan tulokset…",
  pocLogDone: "PoC valmis.",
  gateNotice:
    "Tämä on gate-vaihe. Hyväksy jatkaaksesi seuraavaan vaiheeseen.",
  previous: "← Edellinen",
  nextPhase: "Seuraava vaihe →",
  approveGate: "Hyväksy gate →",
  rejectGate: "Hylkää",
  requestChanges: "Pyydä muutoksia",
  changesRequested:
    "Muutospyyntö kirjattu. Palattiin speksivaiheeseen tarkennusta varten.",
  gate1Title: "Vaatimusten tarkistus",
  gate1Intro:
    "Tarkista että vaiheissa 1–3 kerätyt vaatimukset ovat riittävät. Hyväksyntä lukitsee vaatimukset ja käynnistää arkkitehtuurin suunnittelun.",
  gate1ChecklistTitle: "Kerätyt vaatimukset",
  gate1Answered: "kohtaa vastattu",
  gate1Approve: "Hyväksy vaatimukset & Jatka →",
  gatheringCollecting: "Kerätään vaatimuksia",
  gatheringPrompt:
    "Kuvaa liiketoimintaongelmasi chatissa. Wizard kerää tarvittavat vaatimukset ja muotoilee niistä ratkaisun — arkkitehtuuria ja kaavioita ei vielä tässä vaiheessa.",
  gatheringAdvanceHint:
    "Vastaa ensin wizardin kysymyksiin chatissa — se etenee automaattisesti kun vaatimukset ovat kasassa.",
  ready: "Valmis",
  phasesTitle: "Vaiheet",
  saved: "Tallennettu",
  gateWaiting: "Gate odottaa hyväksyntää",
  skipToContent: "Siirry pääsisältöön",
  sessionNameLabel: "Sessionin nimi",
  chatInputLabel: "Viesti wizardille",
  hideChat: "Piilota keskustelu",
  showChat: "Näytä keskustelu",
  phaseProgressNav: "Wizard-vaiheet",
  streamFailed: "Vastauksen striimaus epäonnistui.",
  chatThinking: "Wizard miettii…",
  chatBusy:
    "Wizard vastaa vielä edelliseen viestiin — hetki, ja lähetä uudelleen.",

  phases: [
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
  ],
  gates: {
    locked: "Lukittu",
    pending: "Odottaa hyväksyntää",
    approved: "Hyväksytty",
    rejected: "Hylätty",
  },
};

const en: Dict = {
  appName: "GAIK Solution Wizard",
  signOut: "Sign out",

  loginSubtitle: "Sign in to continue",
  devHintPre: "Dev mode on. Sign in with",
  devHintPost: "(prefilled below).",
  email: "Email",
  password: "Password",
  login: "Sign in",
  signup: "Sign up",

  sessionsTitle: "Wizard sessions",
  sessionsIntro:
    "Start a new use case or continue an earlier one from where you left off.",
  newSessionPlaceholder: "New session name (e.g. Customer service chatbot)",
  startNew: "Start new",
  previousSessions: "Previous sessions",
  noSessions: "No sessions yet. Start a new one above.",
  done: "Done",
  step: "Step",
  blueprintVersions: "blueprint versions",
  updated: "Updated",

  backToSessions: "← Sessions",
  chat: "Chat",
  chatPlaceholder:
    "Chat panel (placeholder). Requirements gathering and gate approvals go here.",
  chatGreeting:
    "Hi! Describe your business problem and I'll help shape it into a GenAI use case.",
  chatInputPlaceholder: "Type a message…",
  chatSend: "Send",
  chatMockReplyPre: "Thanks for your message. I've logged it under step ",
  chatMockReplyPost:
    ". (Mock reply — the real agent will be wired in later.)",
  workspace: "Workspace",
  activeBlueprint: "Active blueprint",
  versions: "versions",
  phaseUpper: "STEP",
  workspacePlaceholder:
    "BPMN canvas / JSON blueprint / PoC / documentation (placeholder). This step's content renders here.",
  wsTabFlow: "Workflow",
  wsTabJson: "Blueprint (JSON)",
  wsTabPoc: "PoC",
  wsBlueprintGoal: "Goal",
  wsStepAi: "AI step",
  wsStepHuman: "Human review",
  wsStepIo: "I/O",
  wsBpmnLoading: "Loading BPMN diagram…",
  wsBpmnError: "Failed to load BPMN diagram.",
  wsBpmnSpikeNote:
    "V2 BPMN (#34): generated from blueprint JSON (V1 bpmn_generator). Save syncs canvas → JSON → BPMN.",
  wsBpmnV2Started: "V2 started",
  wsBpmnReadOnly: "View only",
  wsBpmnEditable: "Editable",
  wsBpmnSave: "Save → JSON",
  wsBpmnSaving: "Saving…",
  wsBpmnSaveError: "Save failed",
  wsBpmnSaved: "Saved",
  wsBpmnLintBlocked: "BPMN validation blocked save (bpmnlint)",
  wsBpmnLintWarnings: "BPMN warnings",
  wsBpmnDialogTitle: "Visual workflow (BPMN)",
  wsBpmnInlineHint:
    "Edit with bpmn-js Modeler. Overview fits the diagram in the panel; scroll the page and pan inside the canvas. Save syncs to JSON.",
  wsBpmnZoomIn: "Zoom in",
  wsBpmnZoomOut: "Zoom out",
  wsBpmnOverview: "Overview",
  wsBpmnReadable: "Readable",
  wsBpmnToolbar: "View and zoom",
  wsBpmnThemeLabel: "Diagram theme",
  wsBpmnThemeLight: "Light — for glare",
  wsBpmnThemeDark: "Black & white",
  wsBpmnThemeGaik: "GAIK v2",
  wsBpmnPropertiesTitle: "Properties",
  wsBpmnPropertiesEmpty: "Select a task or data object on the canvas.",
  wsBpmnPropertiesName: "Name",
  wsBpmnPropertiesType: "Type",
  wsBpmnPropertiesId: "Id",
  wsJsonSave: "Save blueprint",
  wsJsonSaving: "Saving…",
  wsJsonSaveError: "Save failed",
  wsJsonSaved: "Saved",
  wsJsonInvalid: "Invalid blueprint JSON",
  wsJsonHint:
    "Edit the blueprint JSON directly. Save updates the session and regenerates the BPMN diagram on the Workflow tab.",
  pocRun: "Run PoC",
  pocRunning: "Running…",
  pocRerun: "Run PoC again",
  pocIdle: "PoC has not been run yet. Run it to see logs and the result.",
  pocSuccess: "Success",
  pocFailed: "Failed",
  pocLogStart: "Starting isolated PoC environment…",
  pocLogDeps: "Installing dependencies…",
  pocLogStep: "Running step:",
  pocLogStepOk: "done",
  pocLogValidate: "Validating results…",
  pocLogDone: "PoC complete.",
  gateNotice: "This is a gate step. Approve to continue to the next step.",
  previous: "← Previous",
  nextPhase: "Next step →",
  approveGate: "Approve gate →",
  rejectGate: "Reject",
  requestChanges: "Request changes",
  changesRequested:
    "Changes requested. Returned to the specification step for revision.",
  gate1Title: "Requirements review",
  gate1Intro:
    "Check that the requirements gathered in steps 1–3 are sufficient. Approving locks the requirements and starts the architecture design.",
  gate1ChecklistTitle: "Gathered requirements",
  gate1Answered: "points answered",
  gate1Approve: "Approve requirements & Continue →",
  gatheringCollecting: "Collecting requirements",
  gatheringPrompt:
    "Describe your business problem in the chat. The wizard collects the requirements it needs and shapes them into a solution — no architecture or diagrams yet at this stage.",
  gatheringAdvanceHint:
    "Please answer the wizard's questions in the chat first — it advances automatically once the requirements are complete.",
  ready: "Done",
  phasesTitle: "Steps",
  saved: "Saved",
  gateWaiting: "Gate awaiting approval",
  skipToContent: "Skip to main content",
  sessionNameLabel: "Session name",
  chatInputLabel: "Message to the wizard",
  hideChat: "Hide chat",
  showChat: "Show chat",
  phaseProgressNav: "Wizard steps",
  streamFailed: "Failed to stream the response.",
  chatThinking: "The wizard is thinking…",
  chatBusy:
    "The wizard is still finishing the previous reply — please wait a moment and resend.",

  phases: [
    "Session start",
    "Requirements gathering",
    "Specification",
    "Gate 1",
    "Schema design",
    "Component selection",
    "Blueprint assembly",
    "Visual workflow (BPMN)",
    "Gate 2",
    "PoC",
    "Gate 3",
    "Documentation",
    "Gate 4",
  ],
  gates: {
    locked: "Locked",
    pending: "Awaiting approval",
    approved: "Approved",
    rejected: "Rejected",
  },
};

const DICTS: Record<Locale, Dict> = { fi, en };

export async function getLocale(): Promise<Locale> {
  const c = await cookies();
  const v = c.get(LOCALE_COOKIE)?.value;
  return v === "en" || v === "fi" ? v : DEFAULT_LOCALE;
}

export async function getI18n(): Promise<{ locale: Locale; t: Dict }> {
  const locale = await getLocale();
  return { locale, t: DICTS[locale] };
}
