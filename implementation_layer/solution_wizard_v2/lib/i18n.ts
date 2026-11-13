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

export const LOGIN_ERROR_CODES = ["credentials", "unavailable", "signup"] as const;
export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];
export const LOGIN_MESSAGE_CODES = ["signed-up"] as const;
export type LoginMessageCode = (typeof LOGIN_MESSAGE_CODES)[number];

export type Dict = {
  appName: string;
  signOut: string;

  // ==== lane:shell ====
  /**
   * What the user does now and where, one sentence per step (1–13). "{flow}",
   * "{json}" and "{poc}" are filled with the workspace tab names.
   */
  nowSteps: string[];
  /** Gate 3 once a test run has succeeded; nowSteps has the line before one. */
  nowGate3Run: string;
  /** The last step once Gate 4 is approved, and the same before any test run has succeeded. */
  nowDone: string;
  nowDoneNoRun: string;
  /** A gate before the last that is already approved: {n}. */
  nowGateApproved: string;
  /** Each gate's business topic, Gate 1–4. */
  gateTopics: string[];
  /**
   * Each gate's decision, in the same words wherever it is asked: its row in
   * the timeline, the approve button under the workspace and the one under the
   * wizard's reply in the chat.
   */
  gateDecisions: string[];
  /** The approve button on a phone, where the gate's own label does not fit. */
  gateApproveShort: string;
  /** What approving leads to: the approve button's description and hover hint. */
  gateApproveNotes: string[];
  /** What the user checks when approving each gate, two or three points. */
  gateChecks: string[][];
  gateChecksTitle: string;
  /** The chip of a chat reference to a gate: {n} and {topic}. */
  gateChip: string;
  gateRequestChanges: string;
  /** The line a change request at a pending gate starts with: {n} and {topic}. */
  gateRequestPrefix: string;
  /** The small button under an approved stage in the timeline. */
  gateChange: string;
  /** Its accessible name: {topic}. */
  gateChangeLabel: string;
  /** The line a change to an approved stage starts with: {n} and {topic}. */
  gateChangePrefix: string;
  /** "Change" on an approved stage asks before it reopens the gate: {n}. */
  gateReopen: {
    question: string;
    confirm: string;
    cancel: string;
    working: string;
    busy: string;
    failed: string;
  };
  /** Above the workspace while a reopened gate waits: {n} and {topic}. */
  gateReopenedByUser: string;
  gateReopenedByWizard: string;
  /** The server reopened it: a chat turn changed what the gate had approved. */
  gateReopenedByChange: string;
  /** Opens the reject form beside the decision bar. */
  gateReject: string;
  gateRejectReason: string;
  gateRejectPlaceholder: string;
  gateRejectHow: string;
  gateRejectSubmit: string;
  gateRejectCancel: string;
  /** The chat message a rejection becomes: {n}, {topic} and {reason}. */
  gateRejectMessage: string;
  /** Shown in the decision bar while the gate stands rejected. */
  gateRejected: string;
  /** Shown when the reason never reached the wizard (it stayed busy). */
  gateRejectFailed: string;
  gateRejectNotSaved: string;
  gateRejectResend: string;
  /** Icon button beside a Gate 1 item; its accessible name adds the item: {item}. */
  askInChat: string;
  askInChatItem: string;
  /** Chip and message prefix for one assumption: {n} and {text}. */
  asmChip: string;
  asmPrefix: string;
  /** Message prefix for one business-context item: {field} and {text}. */
  bcPrefix: string;
  // ==== end lane:shell ====

  // ==== lane:tabs ====
  /** Screen-reader word on the tab of the session's current phase. */
  wsTabNow: string;
  /** Screen-reader word on the PoC tab before Gate 2 is approved. */
  wsTabLocked: string;
  planEdit: string;
  planDone: string;
  /** Beside "Edit" once Gate 2 is approved. */
  planEditAfterGate2: string;
  /** The icon button on each step card that opens the chat about that step. */
  planAskInChat: string;
  /** Chip label of a step reference in the chat: {n} and {name}. */
  planStepRefLabel: string;
  /** First line of the chat message about a step: {n}, {id} and {name} (quoted on one line). */
  planStepRefPrefix: string;
  planDetails: string;
  pocLocked: string;
  pocPackageDetails: string;
  pocRegenConfirm: string;
  pocRegenReplace: string;
  pocCancel: string;
  pocResultEmpty: string;
  pocResultYes: string;
  pocResultNo: string;
  /** A 0-1 confidence as a percentage: {n}. */
  pocResultPercent: string;
  pocResultNeedsReview: string;
  pocResultShow: string;
  pocResultHide: string;
  /** The download button of one output file: {name}. */
  pocResultDownloadFile: string;
  // ==== end lane:tabs ====

  // ==== lane:editors ====
  /** Workflow tab and Blueprint form. */
  bpmnFitView: string;
  bpmnPaletteAddTask: string;
  bpmnPaletteConnect: string;
  bpmnPadRename: string;
  bpmnPadDelete: string;
  bpmnUnsaved: string;
  /** "{names}": the tasks no flow from the start reaches. */
  bpmnUnconnected: string;
  bpmnUnnamed: string;
  /** "{n}": the step's number in the process. */
  bpmnStepTitle: string;
  editorRetry: string;
  flowViewLabel: string;
  flowViewDiagram: string;
  flowViewList: string;
  /** "{name}": the step's name. */
  stepChatAsk: string;
  stepChatButton: string;
  /** "{n}", "{name}": the chip above the chat's input. */
  stepChatLabel: string;
  /** "{n}", "{id}", "{name}": the line the message to the wizard starts with. */
  stepChatPrefix: string;
  /** The Blueprint form's heading; the save status sits beside it. */
  formHeading: string;
  formUnsavedStepName: string;
  formUnsavedName: string;
  formStepDeleted: string;
  formUndo: string;
  formTechDetails: string;
  formKeepMine: string;
  formTakeNewer: string;
  /** Beside "Done" when the form stays open on a draft it could not save. */
  formDoneUnsaved: string;
  // ==== end lane:editors ====

  // ==== workflow flow view ====
  /** The Workflow tab's simple flow (components/workflow-flow-view). */
  flowViewBpmn: string;
  flowCanvasLabel: string;
  flowAskWizard: string;
  flowAddStepAfter: string;
  flowAddReviewAfter: string;
  flowNewStepName: string;
  /** On the arrow that leaves a review with two outcomes. */
  flowOutcomeApproved: string;
  /** "{n}": the step an approval goes on to. Read out with the review, not shown. */
  flowOutcomeNext: string;
  flowOutcomeDone: string;
  flowSaveNote: string;
  flowOutcomeEnds: string;
  /** "{n}": the step a rejection returns to. */
  flowOutcomeReturns: string;
  /** On the canvas when editing is off: why, and what to do instead. */
  flowLocked: string;
  flowChangedElsewhere: string;
  // ==== end workflow flow view ====

  // ==== lane:chat ====
  /** Answer one requirement point in the chat, from the checklist. */
  gatheringAsk: string;
  /** The reference chip for a point: {n} and {question}. */
  gatheringAskChip: string;
  /** The line the answer starts with: {n} and {question} (quoted on one line). */
  gatheringAskPrefix: string;
  // ==== end lane:chat ====

  // login
  loginSubtitle: string;
  /** On the sign-in page: the wizard is an AI assistant (AI Act art. 50(1)). */
  loginAiNotice: string;
  devHintPre: string;
  devHintPost: string;
  email: string;
  password: string;
  login: string;

  // session list
  privacyLink: string;
  pocInputReminder: string;
  exportSessionOpen: string;
  searchSessions: string;
  searchSessionsPlaceholder: string;
  /** "{q}" is the search. */
  noSearchResults: string;
  clearSearch: string;
  dayToday: string;
  dayYesterday: string;
  dayThisWeek: string;
  dayEarlier: string;
  /** A short guide on the session list: the four checkpoints a session goes through,
   *  each title on its own line above its text. */
  guideTitle: string;
  guideSteps: { title: string; text: string }[];
  deleteSessionOpen: string;
  deleteSessionTitle: string;
  deleteSessionBody: string;
  deleteSessionConfirmLabel: string;
  deleteSessionConfirm: string;
  deleteSessionCancel: string;
  deleteSessionMismatch: string;
  deleteSessionBusy: string;
  deleteSessionProtected: string;
  deleteSessionFailed: string;
  sessionsTitle: string;
  newSessionPlaceholder: string;
  startNew: string;
  done: string;
  step: string;
  /** The name a session gets when it is started without one. */
  untitledSession: string;
  updated: string;

  // wizard
  chat: string;
  chatPlaceholder: string;
  chatGreeting: string;
  /** Always shown under the chat title: the replies come from an AI (AI Act art. 50(1)). */
  chatAiNotice: string;
  /** Read out by screen readers before each assistant message. */
  chatAssistantLabel: string;
  chatInputPlaceholder: string;
  chatSend: string;
  chatMockReplyPre: string;
  chatMockReplyPost: string;
  workspace: string;
  activeBlueprint: string;
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
  wsStepList: string;
  wsBpmnSave: string;
  wsBpmnSaving: string;
  wsBpmnSaveError: string;
  wsBpmnSaved: string;
  wsBpmnLintBlocked: string;
  wsBpmnLintWarnings: string;
  wsBpmnZoomIn: string;
  wsBpmnZoomOut: string;
  wsBpmnToolbar: string;
  wsBpmnPropertiesName: string;
  wsBpmnPropertiesType: string;
  wsBpmnPropertiesClose: string;
  /** Readable names for the BPMN element types the editor shows. */
  wsBpmnTypeNames: Record<string, string>;
  /** After a diagram save: the PoC package was built from the earlier blueprint. */
  wsSavedPocNote: string;
  wsJsonSaving: string;
  wsJsonSaveError: string;
  wsJsonSaved: string;
  wsJsonInvalid: string;
  wsJsonChangedElsewhere: string;
  wsFormName: string;
  wsFormDescription: string;
  wsFormSteps: string;
  wsFormStepType: string;
  wsFormStepComponent: string;
  wsFormStepComponentNone: string;
  wsFormStepDescription: string;
  wsFormAddStep: string;
  wsFormRemoveStep: string;
  wsFormDragStep: string;
  wsFormDevJson: string;
  wsFormEmptySteps: string;
  wsFormTypeHint: string;
  wsFormComponentHint: string;
  wsFormExpandStep: string;
  wsFormCollapseStep: string;
  wsFormStepSettings: string;
  wsFormSettingAdd: string;
  wsFormSettingRemove: string;
  wsFormSettingKeyPlaceholder: string;
  wsFormSettingValuePlaceholder: string;
  wsFormSettingsEmpty: string;
  planComponentLabel: string;
  planSettingsLabel: string;
  planHiddenSettingsOne: string;
  planHiddenSettingsMany: string;
  planEmptySteps: string;
  /** The output fields the wizard agreed, read-only on the Blueprint tab. */
  planSchema: {
    title: string;
    /** Beside the title: {n} fields. */
    countOne: string;
    countMany: string;
    required: string;
    /** A field's type as a word. */
    types: Record<"text" | "enum" | "date" | "number" | "boolean", string>;
    /** In front of an enum field's values. */
    allowed: string;
  };
  pocRun: string;
  pocRunHint: string;
  pocRunning: string;
  pocRerun: string;
  pocRunSandbox: string;
  pocRunning2: string;
  pocPhasePending: string;
  pocPhaseRunning: string;
  pocPhaseSucceeded: string;
  pocPhaseFailed: string;
  pocPhaseTimeout: string;
  pocRunError: string;
  pocRunInterrupted: string;
  pocRunBusy: string;
  pocRunAgain: string;
  pocRefineHint: string;
  pocLogNoBackend: string;
  pocIdle: string;
  /** The run step, while the first test run is about to start by itself. */
  pocAutoRun: string;
  /** The run step, when the package is ready but has no test material. */
  pocAutoRunNeedsInput: string;
  /** The run step, while a run the tab started waits for room in the sandbox. */
  pocAutoRunBusy: string;
  pocAutoRunHeld: string;
  /** Under the result's title: the test material it is of ({files}). */
  pocResultFrom: string;
  /** Where the result's values come from, when the PoC traced them. */
  pocSources: {
    /** {verified} of {total} citations were found in the source. */
    summary: string;
    show: string;
    hide: string;
    label: string;
    page: string;
    more: string;
    verdicts: { verified: string; check: string; reworded: string; unchecked: string };
  };
  pocGeneratedTitle: string;
  pocNotReadyTitle: string;
  pocDownload: string;
  pocNotGenerated: string;
  /** While the PoC tab is still asking whether a package exists. */
  pocLoading: string;
  /** Step titles of the PoC tab: package, test run, take into use. */
  pocStepPackage: string;
  pocStepRun: string;
  pocStepUse: string;
  pocSetupFilesOne: string;
  pocSetupFilesMany: string;
  pocSetupShow: string;
  pocSetupHide: string;
  pocPackageReady: string;
  pocPackageHasErrors: string;
  /** "{n} tiedostoa": the generated files, behind a disclosure. */
  pocFilesToggle: string;
  /** "Ajo käynnissä · {time}" while a sandbox run is going. */
  pocRunElapsed: string;
  pocRunSandboxHint: string;
  /** A step that opens only once the package exists. */
  pocNeedsPackage: string;
  pocUseReady: string;
  pocDownloadHint: string;
  /** "{n} riviä": length of the run log behind its disclosure. */
  pocLogLines: string;
  pocSuccess: string;
  pocFailed: string;
  pocLogStart: string;
  pocLogDeps: string;
  pocLogStep: string;
  pocLogStepOk: string;
  pocLogValidate: string;
  pocLogDone: string;
  pocLogGenerating: string;
  pocLogWrote: string;
  pocLogFailed: string;
  /**
   * An error whose cause stays in the server log. `{trace}` is the request's
   * trace id, which finds that log line; the message itself carries no detail.
   */
  errorGeneric: string;
  /** The api or the sandbox did not answer at all; `{trace}` as above. */
  errorUnreachable: string;
  /** The deployment has no usable sandbox; which piece is missing is in the log. */
  errorSandboxUnavailable: string;
  pocLogAgentPackage: string;
  pocInputsTitle: string;
  pocInputsEmpty: string;
  pocInputUpload: string;
  pocInputUploading: string;
  pocInputRemove: string;
  pocInputExample: string;
  pocInputExampleHint: string;
  pocInputFailed: string;
  pocDeployable: string;
  pocDeployableHint: string;
  pocOpenCases: string;
  pocOpenCasesHint: string;
  pocCheckRunning: string;
  pocCheckFailed: string;
  pocCheckUnfinished: string;
  pocCheckAgain: string;
  pocResultTitle: string;
  pocResultNone: string;
  pocResultChecksOk: string;
  pocResultChecksBad: string;
  pocResultOpenCases: string;
  pocResultRecord: string;
  pocResultDocument: string;
  pocResultTranscript: string;
  pocResultFiles: string;
  pocResultSkipped: string;
  pocResultLog: string;
  previous: string;
  nextPhase: string;
  advancing: string;
  approving: string;
  goingBack: string;
  gate1ChecklistTitle: string;
  gate1Answered: string;
  bcNotKnown: string;
  gateApprovedWake: string;
  noticeAgentBusy: string;
  noticeGateNotReady: string;
  noticeGateMoved: string;
  /** "End session" could not release the wizard. */
  noticeEndFailed: string;
  bcTitle: string;
  bcCurrentProcess: string;
  bcExpectedValue: string;
  bcKnowledgeProcesses: string;
  bcPainPoints: string;
  bcUsers: string;
  bcReviewers: string;
  bcDomain: string;
  gate1MissingContext: string;
  gate1Missing: string;
  asmTitle: string;
  asmConfirmedCount: string;
  asmIntro: string;
  asmImpact: string;
  asmUnconfirmed: string;
  asmConfirmed: string;
  gatheringCollecting: string;
  gatheringPrompt: string;
  solutionDoneTitle: string;
  solutionDone: string;
  solutionDoneDownload: string;
  solutionDoneNoRun: string;
  /** Beside the download: the case view, where the solution is tried on own material. */
  solutionDoneTry: string;
  /** Releases the wizard held for the session; the session itself stays. */
  endSession: string;
  endingSession: string;
  endSessionHint: string;
  phasesTitle: string;
  saved: string;
  gateWaiting: string;
  skipToContent: string;
  sessionNameLabel: string;
  chatInputLabel: string;
  hideChat: string;
  /** Answer fields under a round of questions in the chat. */
  chatQuestions: {
    open: string;
    send: string;
    close: string;
    placeholder: string;
    skipHint: string;
    failed: string;
    intro: string;
    line: string;
    skip: string;
  };
  showChat: string;
  /** Accessible name of the handle that resizes the chat. */
  chatResize: string;
  /** "Vaihe {n}/{total}": the step, where the timeline is not shown. */
  phaseOf: string;
  /** One line under each workspace tab name: what the tab shows. */
  wsTabHints: { flow: string; json: string; poc: string };
  /** Under the workspace tabs: the blueprint, diagram and package are AI output (AI Act art. 50). */
  wsAiMark: string;
  phaseProgressNav: string;
  streamFailed: string;
  chatThinking: string;
  chatActivity: {
    write: string;
    writeFile: string;
    read: string;
    readFile: string;
    run: string;
    search: string;
    work: string;
    elapsed: string;
    steps: string;
    /** Plain words for the files the agent writes, by base name; others keep their name. */
    files: Record<string, string>;
    diagram: string;
    /** A diagram's accessible name with its steps in order: {steps}. */
    diagramSteps: string;
    diagramDrawing: string;
    diagramExpand: string;
    diagramClose: string;
    /** The chat panel's own words. The page hands the chat this group, so they live here. */
    panel: {
      hint: string;
      referenceRemove: string;
      background: string;
      nonTechnical: string;
      nonTechnicalText: string;
      technical: string;
      technicalText: string;
      /** The empty chat while it is the page (lib/session-start): the question,
       *  what the wizard does with the answer, what to write, and examples. */
      start: {
        title: string;
        lede: string;
        placeholder: string;
        examples: string;
        exampleList: { title: string; prompt: string }[];
      };
      /** A gate approved in the panel, as an event line in the chat: {n}. */
      gateApproved: string;
      /** The language button the wizard offers; the same in both dictionaries. */
      languageOffer: Record<"fi" | "en", { label: string; message: string }>;
    };
  };
  chatBusy: string;
  chatErrors: {
    tooLong: string;
    capacity: string;
    agentBusy: string;
    rateLimited: string;
    turnLimit: string;
  };

  phases: string[];
  gates: { locked: string; pending: string; approved: string; rejected: string };

  // login page notices, chosen by code (app/login/notices.ts)
  loginErrors: Record<LoginErrorCode, string>;
  loginMessages: Record<LoginMessageCode, string>;
};

const fi: Dict = {
  appName: "GAIK Solution Wizard",
  signOut: "Kirjaudu ulos",

  // ==== lane:shell ====
  nowSteps: [
    "Kuvaa chatissa nykyinen prosessi, käytettävä aineisto ja tulos, jonka haluat.",
    "Vastaa wizardin kysymyksiin chatissa. Kohdan, jota et tiedä, voit ohittaa.",
    "Tarkista chatissa wizardin kokoama määrittely ja alla poimittavat kentät. Kerro, jos jotain puuttuu.",
    "Tarkista kerätyt vaatimukset ja avoimet oletukset.",
    "Wizard ehdottaa chatissa poimittavat kentät. Vahvista ne tai kerro, mitä lisätään, poistetaan tai nimetään toisin.",
    "Wizard valitsee kullekin vaiheelle komponentin ja perustelee valinnan chatissa. Kysy, jos jokin mietityttää.",
    "Wizard kokoaa ratkaisun rakenteen ja kysyy chatissa rooleista ja poikkeuksista. Rakennetta voi muokata myös {json}-välilehdellä.",
    "Tarkista {flow}-välilehdellä vaiheet, roolit ja poikkeuspolut. Pyydä muutokset chatissa.",
    "Tarkista työnkulku ja blueprint.",
    "Testiajo käynnistyy {poc}-välilehdellä, kun paketti on valmis. Voit lisätä oman testiaineiston ja ajaa testin uudelleen.",
    "Tarkista testiajon tulos {poc}-välilehdellä. Kerro chatissa, jos jotain pitää muuttaa.",
    "Wizard päivittää dokumentaation ja kertoo chatissa, mitä paketissa on.",
    "Lataa käyttöönottopaketti {poc}-välilehdeltä ja tarkista sen dokumentaatio.",
  ],
  nowGate3Run: "Testi onnistui. Tarkista tulos {poc}-välilehdellä.",
  nowDone: "Kaikki gatet on hyväksytty. Lataa käyttöönottopaketti tai kokeile ratkaisua omilla tapauksillasi.",
  nowDoneNoRun: "Kaikki gatet on hyväksytty. Aja vielä testi {poc}-välilehdellä, niin käyttöönottopaketin voi ladata.",
  nowGateApproved: "Gate {n} on jo hyväksytty. Jatka seuraavaan vaiheeseen.",
  gateTopics: ["Vaatimukset", "Ratkaisun rakenne", "Testiajo", "Luovutus"],
  gateDecisions: [
    "Hyväksy vaatimukset",
    "Hyväksy ratkaisun rakenne",
    "Hyväksy testiajo",
    "Hyväksy luovutus",
  ],
  gateApproveShort: "Hyväksy",
  gateApproveNotes: [
    "Hyväksynnän jälkeen wizard suunnittelee ratkaisun näiden vaatimusten pohjalta.",
    "Hyväksynnän jälkeen wizard rakentaa tästä rakenteesta PoC-paketin.",
    "Hyväksynnän jälkeen wizard viimeistelee dokumentaation ja käyttöönottopaketin.",
    "Hyväksyntä päättää työn, ja käyttöönottopaketin voi ladata.",
  ],
  gateChecks: [
    [
      "Liiketoimintakonteksti: nykyprosessi ja odotettu arvo",
      "Kerätyt vaatimukset ja määrittely",
      "Avoimet oletukset",
    ],
    [
      "Komponentit vaiheittain",
      "Blueprint: vaiheet, syötteet ja tulokset",
      "Työnkulkukaavio ja roolit",
    ],
    [
      "PoC-paketti",
      "Onnistunut testiajo esimerkkiaineistolla",
      "Tuloksen kentät vastaavat odotettua",
    ],
    ["Dokumentaatio", "Käyttöönottopaketti"],
  ],
  gateChecksTitle: "Hyväksynnässä tarkistat:",
  gateChip: "Gate {n} · {topic}",
  gateRequestChanges: "Pyydä muutoksia",
  gateRequestPrefix: "Muutospyyntö ennen Gate {n}:n ({topic}) hyväksyntää:",
  gateChange: "Muuta",
  gateChangeLabel: "Muuta hyväksyttyä vaihetta: {topic}",
  gateChangePrefix: "Haluan muuttaa hyväksyttyä vaihetta Gate {n} ({topic}):",
  gateReopen: {
    question:
      "Avataanko Gate {n} uudelleen? Hyväksyt sen muutoksen jälkeen uudelleen, samoin sitä seuraavat gatet.",
    confirm: "Avaa uudelleen",
    cancel: "Peruuta",
    working: "Avataan…",
    busy: "Wizard vastaa vielä. Odota vastausta ja yritä sitten uudelleen.",
    failed: "Gatea ei voitu avata. Yritä uudelleen.",
  },
  gateReopenedByUser:
    "Gate {n} ({topic}) on avattu uudelleen muutosta varten. Kerro chatissa, mitä muutetaan, ja hyväksy gate, kun muutos on tehty. Hyväksyt sen jälkeen uudelleen myös sitä seuraavat gatet.",
  gateReopenedByWizard:
    "Wizard avasi Gate {n}:n ({topic}) uudelleen pyytämääsi muutosta varten. Tarkista muutos ja hyväksy gate. Hyväksyt sen jälkeen uudelleen myös sitä seuraavat gatet.",
  gateReopenedByChange:
    "Gate {n} ({topic}) avattiin uudelleen, koska sen hyväksymä sisältö muuttui chatissa pyytämäsi muutoksen myötä. Tarkista muutos ja hyväksy gate. Hyväksyt sen jälkeen uudelleen myös sitä seuraavat gatet.",
  gateReject: "Hylkää…",
  gateRejectReason: "Miksi hylkäät? (pakollinen)",
  gateRejectPlaceholder: "Esim. ratkaisu ei sovi prosessiin, koska tarkastus tehdään jo ennen tallennusta.",
  gateRejectHow: "Gate merkitään hylätyksi, ja perustelu lähtee wizardille chattiin.",
  gateRejectSubmit: "Hylkää gate",
  gateRejectCancel: "Peruuta",
  gateRejectMessage: "Hylkään Gate {n}:n ({topic}): {reason}",
  gateRejected: "Hylkäsit tämän gaten. Wizard vastaa perusteluusi chatissa. Hyväksy, kun korjaukset on tehty.",
  gateRejectFailed: "Perustelu ei lähtenyt wizardille.",
  gateRejectNotSaved: "Hylkäys ei tallentunut. Yritä uudelleen.",
  gateRejectResend: "Lähetä uudelleen",
  askInChat: "Muuta chatissa",
  askInChatItem: "Muuta chatissa: {item}",
  asmChip: "Oletus {n}",
  asmPrefix: "Koskee oletusta {n}, lainattuna: \"{text}\"",
  bcPrefix: "Koskee liiketoimintakontekstin kohtaa {field}, lainattuna: \"{text}\"",
  // ==== end lane:shell ====

  // ==== lane:tabs ====
  wsTabNow: "Nyt",
  wsTabLocked: "lukittu",
  planEdit: "Muokkaa",
  planDone: "Valmis",
  planEditAfterGate2: "Muutos vaatii uuden paketin ja testiajon",
  planAskInChat: "Muuta chatissa",
  planStepRefLabel: "Vaihe {n} · {name}",
  planStepRefPrefix: 'Koskee prosessin vaihetta {n} (id {id}), lainattuna: "{name}"',
  planDetails: "Komponentti ja asetukset",
  pocLocked: "Testaus avautuu, kun Gate 2 on hyväksytty.",
  pocPackageDetails: "Paketin tiedot",
  pocRegenConfirm: "Uusi paketti korvaa nykyisen.",
  pocRegenReplace: "Korvaa paketti",
  pocCancel: "Peruuta",
  pocResultEmpty: "Tulos näkyy tässä testiajon jälkeen.",
  pocResultYes: "Kyllä",
  pocResultNo: "Ei",
  pocResultPercent: "{n} %",
  pocResultNeedsReview: "Tarkistettava",
  pocResultShow: "Näytä",
  pocResultHide: "Piilota",
  pocResultDownloadFile: "Lataa {name}",
  // ==== end lane:tabs ====

  // ==== lane:editors ====
  bpmnFitView: "Sovita näkymään",
  bpmnPaletteAddTask: "Lisää tehtävä: pudota se nuolen päälle, niin se liitetään prosessiin",
  bpmnPaletteConnect: "Yhdistä vaiheet: vedä vaiheesta toiseen",
  bpmnPadRename: "Nimeä uudelleen",
  bpmnPadDelete: "Poista",
  bpmnUnsaved: "Muutoksia ei ole tallennettu",
  bpmnUnconnected: "Yhdistä nuolella prosessiin ennen tallennusta: {names}",
  bpmnUnnamed: "Anna tehtävälle nimi ennen tallennusta.",
  bpmnStepTitle: "Vaihe {n}",
  editorRetry: "Yritä uudelleen",
  flowViewLabel: "Näkymä",
  flowViewDiagram: "Kaavio",
  flowViewList: "Lista",
  stepChatAsk: "Pyydä wizardia muuttamaan vaihetta {name}",
  stepChatButton: "Muuta chatissa",
  stepChatLabel: "Vaihe {n} · {name}",
  stepChatPrefix: 'Koskee prosessin vaihetta {n} (id {id}), lainattuna: "{name}"',
  formHeading: "Ratkaisun rakenne",
  formUnsavedStepName: "Ei tallennettu: anna vaiheelle nimi",
  formUnsavedName: "Ei tallennettu: anna blueprintille nimi",
  formStepDeleted: "Vaihe poistettu",
  formUndo: "Kumoa",
  formTechDetails: "Tekniset tiedot",
  formKeepMine: "Tallenna omat muutokseni",
  formTakeNewer: "Ota uudempi versio",
  formDoneUnsaved: "Lomake pysyy auki, koska muutoksia ei ole voitu tallentaa.",
  // ==== end lane:editors ====

  // ==== workflow flow view ====
  flowViewBpmn: "Avaa BPMN-kaaviona",
  flowCanvasLabel: "Työnkulku kaaviona: vaiheet järjestyksessä",
  flowAskWizard: "Pyydä wizardia muuttamaan tätä vaihetta",
  flowAddStepAfter: "Lisää vaihe tämän jälkeen",
  flowAddReviewAfter: "Lisää ihmisen tarkistus tämän jälkeen",
  flowNewStepName: "Uusi vaihe",
  flowOutcomeApproved: "Hyväksyy",
  flowOutcomeNext: "Hyväksyy: jatkuu vaiheeseen {n}",
  flowSaveNote: "Blueprint päivitetty Työnkulku-välilehden kaaviosta",
  flowOutcomeDone: "Hyväksyy: valmis",
  flowOutcomeEnds: "Hylkää: käsittely päättyy",
  flowOutcomeReturns: "Hylkää: palaa vaiheeseen {n}",
  flowLocked: "Vain luku: muutos vaatii uuden paketin ja testiajon. Valitse vaihe ja pyydä muutosta wizardilta.",
  flowChangedElsewhere: "Blueprint muuttui muualla, joten muutostasi ei tallennettu. Kaaviossa on nyt uusi versio.",
  // ==== end workflow flow view ====

  // ==== lane:chat ====
  gatheringAsk: "Vastaa chatissa",
  gatheringAskChip: "Kohta {n} · {question}",
  gatheringAskPrefix: "Vastaus tarkistuslistan kohtaan {n}, lainattuna: \"{question}\"",
  // ==== end lane:chat ====

  loginSubtitle: "Kirjaudu jatkaaksesi",
  loginAiNotice:
    "Wizard on tekoälyavustaja: sen vastaukset ja tuottamat luonnokset ovat tekoälyn tuottamia.",
  devHintPre: "Dev-tila päällä. Kirjaudu tunnuksilla",
  devHintPost: "(esitäytetty alle).",
  email: "Sähköposti",
  password: "Salasana",
  login: "Kirjaudu",

  privacyLink: "Tietosuojaseloste",
  pocInputReminder:
    "Käytä synteettistä tai anonymisoitua aineistoa. Älä lataa henkilötietoja, ellei se ole tarpeen.",
  exportSessionOpen: "Lataa session tiedot ZIP-tiedostona",
  searchSessions: "Hae sessioita",
  searchSessionsPlaceholder: "Hae nimellä",
  noSearchResults: "Ei sessioita haulla \"{q}\".",
  clearSearch: "Näytä kaikki",
  dayToday: "Tänään",
  dayYesterday: "Eilen",
  dayThisWeek: "Viimeiset 7 päivää",
  dayEarlier: "Aiemmin",
  guideTitle: "Näin wizard toimii",
  guideSteps: [
    {
      title: "Vaatimukset",
      text: "Kerro chatissa, mitä haluat ratkaista. Wizard kysyy tarkennukset muutamalla kierroksella, ja hyväksyt kootut vaatimukset (Gate 1).",
    },
    {
      title: "Ratkaisun rakenne",
      text: "Wizard ehdottaa ratkaisun työnkulkuna ja suunnitelmana. Muokkaa tarvittaessa ja hyväksy (Gate 2).",
    },
    {
      title: "Testiajo",
      text: "Wizard tekee PoC-paketin ja ajaa sen esimerkkiaineistolla. Voit kokeilla ratkaisua myös omilla tapauksillasi (Gate 3).",
    },
    {
      title: "Luovutus",
      text: "Lataa testattu paketti käyttöönottoa varten (Gate 4).",
    },
  ],
  deleteSessionOpen: "Poista",
  deleteSessionTitle: "Poista sessio pysyvästi",
  deleteSessionBody:
    "Sessio, sen keskustelu, blueprintit, ladatut tiedostot ja ajojen tulokset poistetaan. Tätä ei voi perua.",
  deleteSessionConfirmLabel: "Vahvista kirjoittamalla session nimi",
  deleteSessionConfirm: "Poista pysyvästi",
  deleteSessionCancel: "Peruuta",
  deleteSessionMismatch: "Nimi ei täsmää.",
  deleteSessionBusy: "Wizard vastaa vielä. Yritä hetken päästä uudelleen.",
  deleteSessionProtected: "Tätä sessiota ei voi poistaa, koska ylläpito säilyttää sen.",
  deleteSessionFailed: "Poisto ei onnistunut. Yritä uudelleen.",
  sessionsTitle: "Wizard-sessiot",
  newSessionPlaceholder: "Esim. Asiakaspalvelun chatbot",
  startNew: "Aloita uusi sessio",
  done: "Valmis",
  step: "Vaihe",
  untitledSession: "Nimetön sessio",
  updated: "Päivitetty",

  chat: "Keskustelu",
  chatPlaceholder:
    "Chat-paneeli (placeholder). Tähän tulevat vaatimuskeruu ja gate-hyväksynnät.",
  chatGreeting:
    "Hei! Olen tekoälyavustaja. Kerro liiketoimintaongelmasta, niin autan muotoilemaan siitä GenAI-käyttötapauksen.",
  chatAiNotice: "Vastaukset tuottaa tekoäly. Tarkista ne ennen käyttöä.",
  chatAssistantLabel: "Tekoälyavustaja",
  chatInputPlaceholder: "Kirjoita viesti…",
  chatSend: "Lähetä",
  chatMockReplyPre: "Kiitos viestistä. Kirjasin sen vaiheeseen ",
  chatMockReplyPost:
    ". (Mock-vastaus — varsinainen agentti kytketään myöhemmin.)",
  workspace: "Työtila",
  activeBlueprint: "Aktiivinen blueprint",
  phaseUpper: "VAIHE",
  workspacePlaceholder:
    "BPMN-canvas / JSON-blueprint / PoC / dokumentaatio (placeholder). Tämän vaiheen sisältö renderöityy tähän.",
  wsTabFlow: "Työnkulku",
  wsTabJson: "Blueprint",
  wsTabPoc: "PoC",
  wsBlueprintGoal: "Tavoite",
  wsStepAi: "Tekoäly",
  wsStepHuman: "Ihmisen tarkistus",
  wsStepIo: "Syöte tai tulos",
  wsBpmnLoading: "Ladataan kaaviota…",
  wsBpmnError: "Kaaviota ei saatu ladattua.",
  wsStepList: "Prosessin vaiheet",
  wsBpmnSave: "Tallenna muutokset",
  wsBpmnSaving: "Tallennetaan…",
  wsBpmnSaveError: "Tallennus epäonnistui",
  wsBpmnSaved: "Tallennettu",
  wsBpmnLintBlocked: "Ei tallennettu: kaaviossa on virheitä",
  wsBpmnLintWarnings: "Huomioita kaaviosta",
  wsBpmnZoomIn: "Lähennä",
  wsBpmnZoomOut: "Loitonna",
  wsBpmnToolbar: "Näkymä ja zoomaus",
  wsBpmnPropertiesName: "Nimi",
  wsBpmnPropertiesType: "Tyyppi",
  wsBpmnPropertiesClose: "Sulje",
  wsBpmnTypeNames: {
    "bpmn:Task": "Tehtävä",
    "bpmn:UserTask": "Ihmisen tehtävä",
    "bpmn:ServiceTask": "Järjestelmän tehtävä",
    "bpmn:ScriptTask": "Automaattinen tehtävä",
    "bpmn:SendTask": "Lähetystehtävä",
    "bpmn:ManualTask": "Käsin tehtävä työ",
    "bpmn:CallActivity": "Aliprosessi",
    "bpmn:ExclusiveGateway": "Valinta",
    "bpmn:ParallelGateway": "Rinnakkaiset haarat",
    "bpmn:StartEvent": "Alku",
    "bpmn:EndEvent": "Loppu",
    "bpmn:IntermediateThrowEvent": "Välitapahtuma",
    "bpmn:DataObjectReference": "Dataobjekti",
    "bpmn:DataStoreReference": "Tietovarasto",
    "bpmn:SequenceFlow": "Siirtymä",
    "bpmn:Lane": "Rooli",
    "bpmn:Participant": "Prosessi",
  },
  wsSavedPocNote:
    "Blueprint päivitettiin, mutta PoC-paketti ei päivity itsestään: generoi se uudelleen PoC-välilehdellä, jotta muutos tulee pakettiin.",
  wsJsonSaving: "Tallennetaan…",
  wsJsonSaveError: "Tallennus epäonnistui",
  wsJsonSaved: "Tallennettu",
  wsJsonInvalid: "Ei tallennettu: JSON ei ole kelvollinen",
  wsJsonChangedElsewhere: "Blueprint muuttui muualla, kun muutoksesi olivat vielä tallentamatta.",
  wsFormName: "Nimi",
  wsFormDescription: "Kuvaus",
  wsFormSteps: "Prosessin vaiheet",
  wsFormStepType: "Tyyppi",
  wsFormStepComponent: "Komponentti",
  wsFormStepComponentNone: "Ei komponenttia",
  wsFormStepDescription: "Kuvaus",
  wsFormAddStep: "Lisää vaihe",
  wsFormRemoveStep: "Poista vaihe",
  wsFormDragStep: "Siirrä vaihetta: vedä tai käytä nuolinäppäimiä",
  wsFormDevJson: "Kehittäjänäkymä (JSON)",
  wsFormEmptySteps: "Ei vaiheita vielä. Lisää ensimmäinen vaihe.",
  wsFormTypeHint:
    "Syöte tai tulos: mitä ratkaisu saa tai antaa. Tekoäly: tekoälyn tekemä vaihe. Ihmisen tarkistus: ihminen tarkistaa tai hyväksyy.",
  wsFormComponentHint:
    "GAIK-komponentti joka toteuttaa vaiheen (valinnainen).",
  wsFormExpandStep: "Näytä vaiheen tiedot",
  wsFormCollapseStep: "Piilota vaiheen tiedot",
  wsFormStepSettings: "Asetukset",
  wsFormSettingAdd: "Lisää asetus",
  wsFormSettingRemove: "Poista asetus",
  wsFormSettingKeyPlaceholder: "avain (esim. model)",
  wsFormSettingValuePlaceholder: "arvo (esim. gpt-4o)",
  wsFormSettingsEmpty: "Ei asetuksia. Lisää esim. malli tai parametri.",
  planComponentLabel: "Komponentti",
  planSettingsLabel: "Asetukset",
  planHiddenSettingsOne: "1 tekninen asetus piilotettu",
  planHiddenSettingsMany: "{n} teknistä asetusta piilotettu",
  planEmptySteps: "Ei vielä vaiheita. Lisää ne Muokkaa-painikkeella tai pyydä wizardia chatissa.",
  planSchema: {
    title: "Tulosskeema",
    countOne: "1 kenttä",
    countMany: "{n} kenttää",
    required: "Pakollinen",
    types: { text: "Teksti", enum: "Valinta", date: "Päivämäärä", number: "Luku", boolean: "Kyllä/ei" },
    allowed: "Arvot:",
  },
  pocRun: "Generoi PoC-paketti",
  pocRunHint: "Kokoaa blueprintistä ajettavan paketin: koodin, asetukset ja ohjeet.",
  pocRunning: "Generoidaan…",
  pocRerun: "Generoi uudelleen",
  pocRunSandbox: "Aja testi",
  pocRunning2: "Ajetaan…",
  pocPhasePending: "Odottaa käynnistystä",
  pocPhaseRunning: "Käynnissä",
  pocPhaseSucceeded: "Ajo onnistui",
  pocPhaseFailed: "Ajo epäonnistui",
  pocPhaseTimeout: "Ajo keskeytettiin 10 minuutin rajaan",
  pocRunError: "Ajoa ei voitu käynnistää",
  pocRunInterrupted: "Ajon seuranta keskeytyi",
  pocRunBusy: "Sandbox on varattu: käynnissä on jo niin monta ajoa kuin sallitaan. Yritä uudelleen hetken päästä.",
  pocRunAgain: "Aja uudelleen",
  pocRefineHint: "Jos tulos ei kelpaa, kerro chatissa, mitä muutetaan. Wizard korjaa paketin, ja voit ajaa testin uudelleen.",
  pocLogNoBackend: "PoC-pakettia ei voi generoida: wizard_api ei ole käytettävissä.",
  pocIdle: "Ei ajettu vielä. Testiajo kestää yleensä noin minuutin.",
  pocAutoRun: "Testiajo käynnistyy itsestään, kun paketti on tarkistettu. Se kestää yleensä noin minuutin.",
  pocAutoRunNeedsInput: "Lisää testiaineisto, niin testiajo käynnistyy itsestään.",
  pocAutoRunHeld: "Testiajo käynnistyy, kun wizard on päivittänyt paketin. Voit myös ajaa sen nyt.",
  pocAutoRunBusy: "Sandbox on varattu. Testiajo käynnistyy itsestään, kun tilaa vapautuu.",
  pocResultFrom: "Aineisto: {files}",
  pocSources: {
    summary: "Lähteet: {verified}/{total} vahvistettu",
    show: "Näytä lähteet",
    hide: "Piilota lähteet",
    label: "Arvon lähde aineistossa",
    page: "s. {n}",
    more: "Näytä {n} lisää",
    verdicts: {
      verified: "Löytyy aineistosta sanasta sanaan",
      check: "Tarkista: arvoa ei löydy lainauksesta",
      reworded: "Aineistossa eri sanoin",
      unchecked: "Ei tarkistettu",
    },
  },
  pocGeneratedTitle: "Generoitu PoC-paketti",
  pocNotReadyTitle: "PoC-paketti ei ole valmis — puuttuu:",
  pocDownload: "Lataa työversio",
  pocNotGenerated:
    "PoC-pakettia ei ole vielä generoitu. Se syntyy kun wizard etenee Gate 3:een asti.",
  pocLoading: "Haetaan PoC-pakettia…",
  pocStepPackage: "Paketti",
  pocStepRun: "Testiajo",
  pocStepUse: "Kokeile ja ota käyttöön",
  pocSetupFilesOne: "1 aineistotiedosto",
  pocSetupFilesMany: "{n} aineistotiedostoa",
  pocSetupShow: "Paketti ja aineisto",
  pocSetupHide: "Piilota",
  pocPackageReady: "Valmis ajettavaksi",
  pocPackageHasErrors: "Paketissa on virheitä",
  pocFilesToggle: "Paketin tiedostot ({n})",
  pocRunElapsed: "Ajo käynnissä · {time}",
  pocRunSandboxHint: "Generoi paketti ensin.",
  pocNeedsPackage: "Avautuu, kun paketti on generoitu.",
  pocUseReady: "Testiajo onnistui: kokeile ratkaisua omilla tapauksilla tai lataa paketti käyttöönottoon.",
  pocDownloadHint: "Paketti esimerkkisyötteineen omalle koneelle ajettavaksi.",
  pocLogLines: "{n} riviä",
  pocSuccess: "Onnistui",
  pocFailed: "Epäonnistui",
  pocLogStart: "Käynnistetään eristetty PoC-ympäristö…",
  pocLogDeps: "Asennetaan riippuvuudet…",
  pocLogStep: "Suoritetaan vaihe:",
  pocLogStepOk: "valmis",
  pocLogValidate: "Validoidaan tulokset…",
  pocLogDone: "PoC valmis.",
  pocLogGenerating: "Generoidaan PoC-paketti hyväksytystä blueprintistä…",
  pocLogWrote: "Kirjoitettu",
  pocLogFailed: "PoC-paketin generointi epäonnistui.",
  errorGeneric: "Jotain meni pieleen palvelimella. Viite: {trace}",
  errorUnreachable: "Palvelin ei vastannut. Yritä hetken kuluttua uudelleen. Viite: {trace}",
  errorSandboxUnavailable: "Sandbox ei ole nyt käytettävissä. Viite: {trace}",
  pocLogAgentPackage:
    "Agentti on jo tuottanut PoC-paketin tässä keskustelussa — säilytetään se sellaisenaan.",
  pocInputsTitle: "Testiaineisto",
  pocInputsEmpty: "Ei tiedostoja. Lisää esimerkkitiedosto, jota ratkaisu käsittelee.",
  pocInputUpload: "Lisää tiedosto",
  pocInputUploading: "Lisätään…",
  pocInputRemove: "Poista",
  pocInputExample: "Wizardin esimerkki",
  pocInputExampleHint:
    "Wizard teki tämän esimerkkitiedoston itse. Testiajo käynnistyy itsestään vasta omalla aineistollasi.",
  pocInputFailed: "Tiedoston lisäys epäonnistui",
  pocDeployable: "Lataa käyttöönottopaketti",
  pocOpenCases: "Kokeile omilla tapauksilla",
  pocOpenCasesHint: "Avaa ratkaisun käyttönäkymän: roolit BPMN:stä, tapaus ajetaan sandboxissa omalla syötteellä.",
  pocDeployableHint: "Käyttöönottopaketti avautuu, kun testiajo on onnistunut.",
  pocCheckRunning: "Tarkistetaan pakettia…",
  pocCheckFailed: "Tarkistus löysi virheitä, jotka kaatavat ajon:",
  pocCheckUnfinished: "Tarkistus ei valmistunut",
  pocCheckAgain: "Tarkista uudelleen",
  pocResultTitle: "Ajon tulos",
  pocResultNone: "Ajo onnistui, mutta se ei kirjoittanut tulostiedostoja output/-kansioon.",
  pocResultChecksOk: "Lähdetarkistus läpi",
  pocResultChecksBad: "Lähdetarkistus: mahdollisia keksittyjä arvoja",
  pocResultOpenCases: "Avaa tapausnäkymä",
  pocResultRecord: "Tietue",
  pocResultDocument: "Dokumentti",
  pocResultTranscript: "Litterointi",
  pocResultFiles: "Tulostiedostot",
  pocResultSkipped: "{name} ({size}) on liian suuri ladattavaksi tästä.",
  pocResultLog: "Ajon loki",
  previous: "Edellinen",
  nextPhase: "Seuraava vaihe",
  advancing: "Siirrytään…",
  approving: "Hyväksytään…",
  goingBack: "Palataan…",
  gate1ChecklistTitle: "Kerätyt vaatimukset",
  gate1Answered: "kohtaa vastattu",
  bcNotKnown: "Ei vielä tiedossa",
  gateApprovedWake: "Gate {n} hyväksytty paneelista, jatka.",
  noticeAgentBusy: "Wizard työskentelee vielä tässä vaiheessa. Odota sen vastausta chatissa ja yritä sitten uudelleen.",
  noticeGateNotReady: "Tätä gatea ei voi vielä hyväksyä: wizard ei ole tuottanut sitä, mitä gate tarkistaa. Jatka chatissa, kunnes wizard esittää tuloksen.",
  noticeGateMoved: "Sessio oli jo edennyt toisessa ikkunassa, joten päätöstäsi ei tallennettu. Tässä on session nykyinen tila.",
  noticeEndFailed: "Sessiota ei voitu lopettaa. Yritä hetken kuluttua uudelleen.",
  bcTitle: "Liiketoimintakonteksti",
  bcCurrentProcess: "Nykyprosessi",
  bcExpectedValue: "Odotettu arvo",
  bcKnowledgeProcesses: "Tietoprosessit",
  bcPainPoints: "Kipupisteet",
  bcUsers: "Käyttäjät",
  bcReviewers: "Tarkastajat",
  bcDomain: "Toimiala",
  gate1MissingContext:
    "Vaatimukset ovat kesken — wizard ei ole vielä kerännyt kaikkea. Jatka keskustelua chatissa ennen hyväksyntää.",
  gate1Missing: "Puuttuu",
  asmTitle: "Avoimet oletukset",
  asmConfirmedCount: "kuitattu",
  asmIntro:
    "Wizard kirjasi nämä, koska tietoa puuttui. Tarkista ne ennen hyväksyntää.",
  asmImpact: "Vaikutus",
  asmUnconfirmed: "Vahvistamaton",
  asmConfirmed: "Vahvistettu",
  gatheringCollecting: "Kerätään vaatimuksia",
  gatheringPrompt:
    "Kerro chatissa, mitä haluat ratkaista. Wizard kysyy tarkentavat kysymykset ja täyttää vastauksistasi alla olevan listan. Kun lista on valmis, siirryt Gate 1 -tarkistukseen.",
  solutionDoneTitle: "Ratkaisu on valmis",
  solutionDone:
    "Kaikki neljä gatea on hyväksytty. Käyttöönottopaketti sisältää PoC:n ilman syöteaineistoa ja ajon tuloksia.",
  solutionDoneDownload: "Lataa käyttöönottopaketti",
  solutionDoneNoRun: "Paketti avautuu PoC-välilehdellä, kun sandbox-ajo on onnistunut.",
  solutionDoneTry: "Kokeile omilla tapauksilla",
  endSession: "Lopeta sessio",
  endingSession: "Lopetetaan…",
  endSessionHint:
    "Vapauttaa tälle sessiolle varatun wizardin muiden käyttöön. Keskustelu ja tiedostot säilyvät, ja voit jatkaa sessiota myöhemmin.",
  phasesTitle: "Vaiheet",
  saved: "Tallennettu",
  gateWaiting: "Gate odottaa hyväksyntää",
  skipToContent: "Siirry pääsisältöön",
  sessionNameLabel: "Session nimi",
  chatInputLabel: "Viesti wizardille",
  hideChat: "Piilota keskustelu",
  chatQuestions: {
    open: "Vastaa kysymyksiin yksitellen ({count})",
    send: "Lähetä vastaukset",
    close: "Sulje",
    placeholder: "Vastaus, tai jätä tyhjäksi",
    skipHint: "Tyhjät lähtevät ohitettuina.",
    failed: "Vastauksiasi ei lähetetty, ja ne ovat tallessa tässä.",
    intro: "Vastaukseni kysymyksiisi (kysymykset lainattuina):",
    line: "{n}. \"{question}\": {answer}",
    skip: "ohita",
  },
  showChat: "Näytä keskustelu",
  chatResize: "Muuta keskustelun leveyttä",
  phaseOf: "Vaihe {n}/{total}",
  wsTabHints: {
    flow: "Ratkaisun prosessi kaaviona",
    json: "Ratkaisun vaiheet ja niiden asetukset",
    poc: "Testaa ratkaisu esimerkkiaineistolla",
  },
  wsAiMark: "Ratkaisun, kaavion ja paketin on tuottanut tekoäly. Tarkista ne ennen käyttöä.",
  phaseProgressNav: "Wizard-vaiheet",
  streamFailed: "Vastauksen striimaus epäonnistui.",
  chatThinking: "Wizard miettii…",
  chatActivity: {
    write: "Kirjoitetaan tiedostoa",
    writeFile: "Kirjoitetaan {file}",
    read: "Luetaan tiedostoa",
    readFile: "Luetaan {file}",
    run: "Ajetaan tarkistusta",
    search: "Haetaan tietoa",
    work: "Työstetään vastausta",
    elapsed: "{s} s",
    steps: "Mitä wizard teki ({n})",
    files: {
      "use_case.blueprint.json": "ratkaisun suunnitelma",
      "blueprint.json": "ratkaisun suunnitelma",
      "output_schema.py": "poimittavat kentät",
      "output_schema_requirements.json": "poimittavat kentät",
      "extraction_requirements.md": "poiminnan ohjeet",
      "workflow.bpmn": "työnkulkukaavio",
      "workflow.mmd": "työnkulkukaavio",
      "run_poc.py": "testiohjelma",
      "config.yaml": "testin asetukset",
    },
    diagram: "Kaavio",
    diagramSteps: "Kaavio, vaiheet järjestyksessä: {steps}",
    diagramDrawing: "Piirretään kaaviota…",
    diagramExpand: "Suurenna",
    diagramClose: "Sulje",
    panel: {
      hint: "Pyydä muutoksia tässä tai muokkaa itse välilehdillä.",
      referenceRemove: "Poista viittaus",
      background: "Taustasi",
      nonTechnical: "En ole tekninen",
      nonTechnicalText: "Taustani: en ole tekninen. Kysy arkikielellä ja ehdota oletukset teknisiin kohtiin. ",
      technical: "Olen tekninen",
      technicalText: "Taustani: olen tekninen. Voit käyttää teknisiä termejä ja kysyä teknisistä valinnoista suoraan. ",
      start: {
        title: "Mitä haluat ratkaista?",
        lede: "Wizard kysyy tarkentavat kysymykset ja kokoaa vaatimukset hyväksyttäväksesi.",
        placeholder:
          "Kuvaa, miten työ tehdään nyt, mitä aineistoa siinä käytetään ja millaisen tuloksen haluat…",
        examples: "Tai aloita esimerkistä",
        exampleList: [
          {
            title: "Ääniviestistä tiketiksi",
            prompt:
              "Kenttäasentajat jättävät vikailmoituksensa ääniviesteinä. Haluamme niistä rakenteiset huoltotiketit.",
          },
          {
            title: "Laskun kentät",
            prompt: "Haluamme poimia toimittajien PDF-laskuista keskeiset kentät.",
          },
          {
            title: "Kysymykset ohjeista",
            prompt: "Haluamme avustajan, joka vastaa kysymyksiin sisäisten ohjeidemme pohjalta.",
          },
          {
            title: "Raportti useasta lähteestä",
            prompt:
              "Haluamme koota moniosaisen raportin dokumenteista, litteroinneista ja datatiedostoista.",
          },
        ],
      },
      gateApproved: "Gate {n} hyväksytty",
      languageOffer: {
        fi: { label: "Vaihda suomeksi", message: "Jatka suomeksi." },
        en: { label: "Switch to English", message: "Continue in English." },
      },
    },
  },
  chatBusy:
    "Wizard vastaa vielä edelliseen viestiin — hetki, ja lähetä uudelleen.",
  chatErrors: {
    tooLong: "Viesti on liian pitkä. Lyhennä viestiä tai lataa aineisto PoC-välilehdellä.",
    capacity: "Wizard palvelee juuri nyt muita istuntoja. Yritä hetken kuluttua uudelleen.",
    agentBusy:
      "Sinulla on jo niin monta wizard-istuntoa työn alla kuin sallitaan. Odota, että jokin niistä vastaa, ja yritä sitten uudelleen.",
    rateLimited: "Lähetät viestejä nopeammin kuin wizard sallii. Odota hetki ja lähetä uudelleen.",
    turnLimit:
      "Wizard pysähtyi, koska yhden viestin askelraja tuli täyteen. Kirjoita esim. ”jatka”, niin se jatkaa.",
  },

  phases: [
    "Aloitus",
    "Vaatimusten keruu",
    "Spesifikaatio",
    "Gate 1: vaatimukset",
    "Skeeman suunnittelu",
    "Komponenttivalinta",
    "Blueprint-kokoaminen",
    "Visuaalinen työnkulku (BPMN)",
    "Gate 2: ratkaisun rakenne",
    "PoC",
    "Gate 3: testiajo",
    "Dokumentaatio",
    "Gate 4: luovutus",
  ],
  gates: {
    locked: "Lukittu",
    pending: "Odottaa hyväksyntää",
    approved: "Hyväksytty",
    rejected: "Hylätty",
  },
  loginErrors: {
    credentials: "Väärä tunnus tai salasana.",
    unavailable: "Kirjautuminen ei ole nyt käytettävissä.",
    signup: "Rekisteröinti epäonnistui.",
  },
  loginMessages: {
    "signed-up":
      "Rekisteröinti onnistui. Tarkista sähköpostisi vahvistuslinkki, jos sähköpostivahvistus on päällä.",
  },
};

const en: Dict = {
  appName: "GAIK Solution Wizard",
  signOut: "Sign out",

  // ==== lane:shell ====
  nowSteps: [
    "Describe in the chat how the work is done today, the material it uses and the result you want.",
    "Answer the wizard's questions in the chat. You can skip anything you don't know.",
    "Check the specification the wizard sums up in the chat and the fields to extract below. Say if anything is missing.",
    "Check the gathered requirements and the open assumptions.",
    "The wizard proposes the fields to extract in the chat. Confirm them or say what to add, remove or rename.",
    "The wizard picks a component for each step and explains the choice in the chat. Ask if anything puzzles you.",
    "The wizard assembles the solution design and asks in the chat about roles and exceptions. You can also edit it on the {json} tab.",
    "Check the steps, roles and exception paths on the {flow} tab. Ask for changes in the chat.",
    "Check the workflow and the blueprint.",
    "The test run starts on the {poc} tab once the package is ready. You can add your own test material and run it again.",
    "Check the test run's result on the {poc} tab. Say in the chat if something should change.",
    "The wizard updates the documentation and tells you in the chat what the package holds.",
    "Download the deployment package from the {poc} tab and check its documentation.",
  ],
  nowGate3Run: "The test succeeded. Check the result on the {poc} tab.",
  nowDone: "Every gate is approved. Download the deployment package, or try the solution on your own cases.",
  nowDoneNoRun: "Every gate is approved. Run a test on the {poc} tab, and the deployment package can be downloaded.",
  nowGateApproved: "Gate {n} is already approved. Move on to the next step.",
  gateTopics: ["Requirements", "Solution design", "Test run", "Handover"],
  gateDecisions: [
    "Approve the requirements",
    "Approve the solution design",
    "Approve the test run",
    "Approve the handover",
  ],
  gateApproveShort: "Approve",
  gateApproveNotes: [
    "After approval the wizard designs the solution from these requirements.",
    "After approval the wizard builds the PoC package from this design.",
    "After approval the wizard finishes the documentation and the deployment package.",
    "Approving completes the work, and the deployment package can be downloaded.",
  ],
  gateChecks: [
    [
      "Business context: current process and expected value",
      "Gathered requirements and the specification",
      "Open assumptions",
    ],
    [
      "Components step by step",
      "Blueprint: steps, inputs and outputs",
      "Workflow diagram and roles",
    ],
    [
      "The PoC package",
      "A successful test run on sample material",
      "The result's fields match what you expect",
    ],
    ["Documentation", "Deployment package"],
  ],
  gateChecksTitle: "At approval you check:",
  gateChip: "Gate {n} · {topic}",
  gateRequestChanges: "Request changes",
  gateRequestPrefix: "Change request before approving Gate {n} ({topic}):",
  gateChange: "Change",
  gateChangeLabel: "Change the approved stage: {topic}",
  gateChangePrefix: "I want to change the approved stage Gate {n} ({topic}):",
  gateReopen: {
    question:
      "Reopen Gate {n}? You approve it again after the change, and the gates after it too.",
    confirm: "Reopen",
    cancel: "Cancel",
    working: "Reopening…",
    busy: "The wizard is still replying. Wait for its reply, then try again.",
    failed: "The gate could not be reopened. Try again.",
  },
  gateReopenedByUser:
    "Gate {n} ({topic}) is reopened for a change. Say in the chat what to change, and approve the gate once the change is made. After that you approve the gates after it again too.",
  gateReopenedByWizard:
    "The wizard reopened Gate {n} ({topic}) for the change you asked for. Check the change and approve the gate. After that you approve the gates after it again too.",
  gateReopenedByChange:
    "Gate {n} ({topic}) was reopened, because the change you asked for in the chat changed what it had approved. Check the change and approve the gate. After that you approve the gates after it again too.",
  gateReject: "Reject…",
  gateRejectReason: "Why are you rejecting it? (required)",
  gateRejectPlaceholder: "E.g. the design does not fit the process, because the check already happens before saving.",
  gateRejectHow: "The gate is marked rejected, and your reason goes to the wizard in the chat.",
  gateRejectSubmit: "Reject gate",
  gateRejectCancel: "Cancel",
  gateRejectMessage: "I reject Gate {n} ({topic}): {reason}",
  gateRejected: "You rejected this gate. The wizard answers your reason in the chat. Approve once the fixes are in.",
  gateRejectFailed: "The reason did not reach the wizard.",
  gateRejectNotSaved: "The rejection was not saved. Try again.",
  gateRejectResend: "Send again",
  askInChat: "Change in the chat",
  askInChatItem: "Change in the chat: {item}",
  asmChip: "Assumption {n}",
  asmPrefix: "About assumption {n}, quoted: \"{text}\"",
  bcPrefix: "About the business context item {field}, quoted: \"{text}\"",
  // ==== end lane:shell ====

  // ==== lane:tabs ====
  wsTabNow: "Now",
  wsTabLocked: "locked",
  planEdit: "Edit",
  planDone: "Done",
  planEditAfterGate2: "A change needs a new package and test run",
  planAskInChat: "Change in chat",
  planStepRefLabel: "Step {n} · {name}",
  planStepRefPrefix: 'About process step {n} (id {id}), quoted: "{name}"',
  planDetails: "Component and settings",
  pocLocked: "Testing opens once Gate 2 is approved.",
  pocPackageDetails: "Package details",
  pocRegenConfirm: "A new package replaces the current one.",
  pocRegenReplace: "Replace package",
  pocCancel: "Cancel",
  pocResultEmpty: "The result shows here after the test run.",
  pocResultYes: "Yes",
  pocResultNo: "No",
  pocResultPercent: "{n}%",
  pocResultNeedsReview: "Needs review",
  pocResultShow: "Show",
  pocResultHide: "Hide",
  pocResultDownloadFile: "Download {name}",
  // ==== end lane:tabs ====

  // ==== lane:editors ====
  bpmnFitView: "Fit to view",
  bpmnPaletteAddTask: "Add a task: drop it on an arrow to put it into the process",
  bpmnPaletteConnect: "Connect steps: drag from one step to another",
  bpmnPadRename: "Rename",
  bpmnPadDelete: "Delete",
  bpmnUnsaved: "Unsaved changes",
  bpmnUnconnected: "Connect to the process with an arrow before saving: {names}",
  bpmnUnnamed: "Name the task before saving.",
  bpmnStepTitle: "Step {n}",
  editorRetry: "Try again",
  flowViewLabel: "View",
  flowViewDiagram: "Diagram",
  flowViewList: "List",
  stepChatAsk: "Ask the wizard to change step {name}",
  stepChatButton: "Change in chat",
  stepChatLabel: "Step {n} · {name}",
  stepChatPrefix: 'About process step {n} (id {id}), quoted: "{name}"',
  formHeading: "Solution structure",
  formUnsavedStepName: "Not saved: give the step a name",
  formUnsavedName: "Not saved: give the blueprint a name",
  formStepDeleted: "Step deleted",
  formUndo: "Undo",
  formTechDetails: "Technical details",
  formKeepMine: "Save my changes",
  formTakeNewer: "Take the newer version",
  formDoneUnsaved: "The form stays open because its changes could not be saved.",
  // ==== end lane:editors ====

  // ==== workflow flow view ====
  flowViewBpmn: "Open as BPMN",
  flowCanvasLabel: "The workflow as a diagram: the steps in order",
  flowAskWizard: "Ask the wizard to change this step",
  flowAddStepAfter: "Add a step after this",
  flowAddReviewAfter: "Add a human review after this",
  flowNewStepName: "New step",
  flowOutcomeApproved: "Approves",
  flowOutcomeNext: "Approves: on to step {n}",
  flowSaveNote: "Blueprint updated from the Workflow tab's diagram",
  flowOutcomeDone: "Approves: done",
  flowOutcomeEnds: "Rejects: the process ends",
  flowOutcomeReturns: "Rejects: back to step {n}",
  flowLocked: "Read-only: a change needs a new package and test run. Pick a step and ask the wizard to change it.",
  flowChangedElsewhere: "The blueprint changed elsewhere, so your change was not saved. The diagram now shows the new version.",
  // ==== end workflow flow view ====

  // ==== lane:chat ====
  gatheringAsk: "Answer in the chat",
  gatheringAskChip: "Point {n} · {question}",
  gatheringAskPrefix: "Answer to checklist point {n}, quoted: \"{question}\"",
  // ==== end lane:chat ====

  loginSubtitle: "Sign in to continue",
  loginAiNotice:
    "The wizard is an AI assistant: its replies and the drafts it produces are generated by AI.",
  devHintPre: "Dev mode on. Sign in with",
  devHintPost: "(prefilled below).",
  email: "Email",
  password: "Password",
  login: "Sign in",

  privacyLink: "Privacy notice",
  pocInputReminder:
    "Use synthetic or anonymised material. Do not upload personal data unless it is needed.",
  exportSessionOpen: "Download the session's data as a ZIP file",
  searchSessions: "Search sessions",
  searchSessionsPlaceholder: "Search by name",
  noSearchResults: "No sessions match \"{q}\".",
  clearSearch: "Show all",
  dayToday: "Today",
  dayYesterday: "Yesterday",
  dayThisWeek: "Last 7 days",
  dayEarlier: "Earlier",
  guideTitle: "How the wizard works",
  guideSteps: [
    {
      title: "Requirements",
      text: "Tell the wizard in the chat what you want to solve. It asks follow-up questions in a few rounds, and you approve the gathered requirements (Gate 1).",
    },
    {
      title: "Solution structure",
      text: "The wizard proposes the solution as a workflow and a plan. Edit it if needed and approve it (Gate 2).",
    },
    {
      title: "Test run",
      text: "The wizard builds a PoC package and runs it on sample data. You can also try the solution on your own cases (Gate 3).",
    },
    {
      title: "Hand-over",
      text: "Download the tested package for deployment (Gate 4).",
    },
  ],
  deleteSessionOpen: "Delete",
  deleteSessionTitle: "Delete session permanently",
  deleteSessionBody:
    "The session, its conversation, blueprints, uploaded files and run results are deleted. This cannot be undone.",
  deleteSessionConfirmLabel: "Type the session name to confirm",
  deleteSessionConfirm: "Delete permanently",
  deleteSessionCancel: "Cancel",
  deleteSessionMismatch: "The name does not match.",
  deleteSessionBusy: "The wizard is still responding. Try again in a moment.",
  deleteSessionProtected: "This session cannot be deleted because an operator is keeping it.",
  deleteSessionFailed: "The session could not be deleted. Try again.",
  sessionsTitle: "Wizard sessions",
  newSessionPlaceholder: "E.g. Customer service chatbot",
  startNew: "Start a new session",
  done: "Done",
  step: "Step",
  untitledSession: "Untitled session",
  updated: "Updated",

  chat: "Chat",
  chatPlaceholder:
    "Chat panel (placeholder). Requirements gathering and gate approvals go here.",
  chatGreeting:
    "Hi! I'm an AI assistant. Describe your business problem and I'll help shape it into a GenAI use case.",
  chatAiNotice: "Replies are generated by AI. Check them before use.",
  chatAssistantLabel: "AI assistant",
  chatInputPlaceholder: "Type a message…",
  chatSend: "Send",
  chatMockReplyPre: "Thanks for your message. I've logged it under step ",
  chatMockReplyPost:
    ". (Mock reply — the real agent will be wired in later.)",
  workspace: "Workspace",
  activeBlueprint: "Active blueprint",
  phaseUpper: "STEP",
  workspacePlaceholder:
    "BPMN canvas / JSON blueprint / PoC / documentation (placeholder). This step's content renders here.",
  wsTabFlow: "Workflow",
  wsTabJson: "Blueprint",
  wsTabPoc: "PoC",
  wsBlueprintGoal: "Goal",
  wsStepAi: "AI step",
  wsStepHuman: "Human review",
  wsStepIo: "Input or output",
  wsBpmnLoading: "Loading the diagram…",
  wsBpmnError: "The diagram could not be loaded.",
  wsStepList: "Process steps",
  wsBpmnSave: "Save changes",
  wsBpmnSaving: "Saving…",
  wsBpmnSaveError: "Save failed",
  wsBpmnSaved: "Saved",
  wsBpmnLintBlocked: "Not saved: the diagram has errors",
  wsBpmnLintWarnings: "Notes on the diagram",
  wsBpmnZoomIn: "Zoom in",
  wsBpmnZoomOut: "Zoom out",
  wsBpmnToolbar: "View and zoom",
  wsBpmnPropertiesName: "Name",
  wsBpmnPropertiesType: "Type",
  wsBpmnPropertiesClose: "Close",
  wsBpmnTypeNames: {
    "bpmn:Task": "Task",
    "bpmn:UserTask": "Task for a person",
    "bpmn:ServiceTask": "System task",
    "bpmn:ScriptTask": "Automatic task",
    "bpmn:SendTask": "Send task",
    "bpmn:ManualTask": "Manual task",
    "bpmn:CallActivity": "Subprocess",
    "bpmn:ExclusiveGateway": "Decision",
    "bpmn:ParallelGateway": "Parallel branches",
    "bpmn:StartEvent": "Start",
    "bpmn:EndEvent": "End",
    "bpmn:IntermediateThrowEvent": "Intermediate event",
    "bpmn:DataObjectReference": "Data object",
    "bpmn:DataStoreReference": "Data store",
    "bpmn:SequenceFlow": "Flow",
    "bpmn:Lane": "Role",
    "bpmn:Participant": "Process",
  },
  wsSavedPocNote:
    "The blueprint was updated, but the PoC package does not update by itself: generate it again on the PoC tab to include the change.",
  wsJsonSaving: "Saving…",
  wsJsonSaveError: "Save failed",
  wsJsonSaved: "Saved",
  wsJsonInvalid: "Not saved: the JSON is not valid",
  wsJsonChangedElsewhere: "The blueprint changed elsewhere while your changes were not saved yet.",
  wsFormName: "Name",
  wsFormDescription: "Description",
  wsFormSteps: "Process steps",
  wsFormStepType: "Type",
  wsFormStepComponent: "Component",
  wsFormStepComponentNone: "No component",
  wsFormStepDescription: "Description",
  wsFormAddStep: "Add step",
  wsFormRemoveStep: "Remove step",
  wsFormDragStep: "Move the step: drag it or use the arrow keys",
  wsFormDevJson: "Developer view (JSON)",
  wsFormEmptySteps: "No steps yet. Add the first step.",
  wsFormTypeHint:
    "Input or output: what the solution takes in or gives back. AI step: done by AI. Human review: a person checks or approves.",
  wsFormComponentHint: "GAIK component that implements the step (optional).",
  wsFormExpandStep: "Show step details",
  wsFormCollapseStep: "Hide step details",
  wsFormStepSettings: "Settings",
  wsFormSettingAdd: "Add setting",
  wsFormSettingRemove: "Remove setting",
  wsFormSettingKeyPlaceholder: "key (e.g. model)",
  wsFormSettingValuePlaceholder: "value (e.g. gpt-4o)",
  wsFormSettingsEmpty: "No settings yet. Add e.g. a model or parameter.",
  planComponentLabel: "Component",
  planSettingsLabel: "Settings",
  planHiddenSettingsOne: "1 technical setting hidden",
  planHiddenSettingsMany: "{n} technical settings hidden",
  planEmptySteps: "No steps yet. Add them with Edit, or ask the wizard in the chat.",
  planSchema: {
    title: "Output schema",
    countOne: "1 field",
    countMany: "{n} fields",
    required: "Required",
    types: { text: "Text", enum: "Choice", date: "Date", number: "Number", boolean: "Yes/no" },
    allowed: "Values:",
  },
  pocRun: "Generate PoC package",
  pocRunHint: "Builds a runnable package from the blueprint: code, settings and instructions.",
  pocRunning: "Generating…",
  pocRerun: "Generate again",
  pocRunSandbox: "Run the test",
  pocRunning2: "Running…",
  pocPhasePending: "Waiting to start",
  pocPhaseRunning: "Running",
  pocPhaseSucceeded: "Run succeeded",
  pocPhaseFailed: "Run failed",
  pocPhaseTimeout: "Run stopped at the 10-minute limit",
  pocRunError: "The run could not be started",
  pocRunInterrupted: "Following the run was interrupted",
  pocRunBusy: "The sandbox is busy: as many runs are going as it allows. Try again in a moment.",
  pocRunAgain: "Run again",
  pocRefineHint: "If the result is not right, say in the chat what should change. The wizard fixes the package and you can run the test again.",
  pocLogNoBackend: "The PoC package cannot be generated: wizard_api is unavailable.",
  pocIdle: "Not run yet. A test run usually takes about a minute.",
  pocAutoRun: "The test run starts by itself once the package has been checked. It usually takes about a minute.",
  pocAutoRunNeedsInput: "Add test material, and the test run starts by itself.",
  pocAutoRunHeld: "The test run starts once the wizard has updated the package. You can also run it now.",
  pocAutoRunBusy: "The sandbox is busy. The test run starts by itself once there is room.",
  pocResultFrom: "Material: {files}",
  pocSources: {
    summary: "Sources: {verified}/{total} verified",
    show: "Show sources",
    hide: "Hide sources",
    label: "Where the value is in the material",
    page: "p. {n}",
    more: "Show {n} more",
    verdicts: {
      verified: "In the material word for word",
      check: "Check: the value is not in the quoted text",
      reworded: "Found in the material, worded differently",
      unchecked: "Not checked",
    },
  },
  pocGeneratedTitle: "Generated PoC package",
  pocNotReadyTitle: "The PoC package is not ready — missing:",
  pocDownload: "Download working copy",
  pocNotGenerated:
    "The PoC package has not been generated yet. It appears once the wizard reaches Gate 3.",
  pocLoading: "Loading the PoC package…",
  pocStepPackage: "Package",
  pocStepRun: "Test run",
  pocStepUse: "Try it and take it into use",
  pocSetupFilesOne: "1 input file",
  pocSetupFilesMany: "{n} input files",
  pocSetupShow: "Package and material",
  pocSetupHide: "Hide",
  pocPackageReady: "Ready to run",
  pocPackageHasErrors: "The package has errors",
  pocFilesToggle: "Package files ({n})",
  pocRunElapsed: "Running · {time}",
  pocRunSandboxHint: "Generate the package first.",
  pocNeedsPackage: "Opens once the package is generated.",
  pocUseReady: "The test run succeeded: try the solution on your own cases or download the package for deployment.",
  pocDownloadHint: "The package with its sample input, to run on your own machine.",
  pocLogLines: "{n} lines",
  pocSuccess: "Success",
  pocFailed: "Failed",
  pocLogStart: "Starting isolated PoC environment…",
  pocLogDeps: "Installing dependencies…",
  pocLogStep: "Running step:",
  pocLogStepOk: "done",
  pocLogValidate: "Validating results…",
  pocLogDone: "PoC complete.",
  pocLogGenerating: "Generating the PoC package from the approved blueprint…",
  pocLogWrote: "Wrote",
  pocLogFailed: "PoC package generation failed.",
  errorGeneric: "Something went wrong on the server. Reference: {trace}",
  errorUnreachable: "The server did not answer. Try again in a moment. Reference: {trace}",
  errorSandboxUnavailable: "The sandbox is not available right now. Reference: {trace}",
  pocLogAgentPackage:
    "The agent already produced a PoC package in this conversation — keeping it as is.",
  pocInputsTitle: "Test data",
  pocInputsEmpty: "No files. Add a sample file the solution processes.",
  pocInputUpload: "Add file",
  pocInputUploading: "Adding…",
  pocInputRemove: "Remove",
  pocInputExample: "Wizard's example",
  pocInputExampleHint:
    "The wizard made this example file itself. The test run starts by itself only on your own material.",
  pocInputFailed: "The file could not be added",
  pocDeployable: "Download package for deployment",
  pocOpenCases: "Try it on your own cases",
  pocOpenCasesHint: "Opens the solution in use: roles from the BPMN, each case run in the sandbox on its own input.",
  pocDeployableHint: "The deployment package opens once a test run has succeeded.",
  pocCheckRunning: "Checking the package…",
  pocCheckFailed: "The check found problems that would fail the run:",
  pocCheckUnfinished: "The check did not finish",
  pocCheckAgain: "Check again",
  pocResultTitle: "Run result",
  pocResultNone: "The run succeeded but wrote no output files to output/.",
  pocResultChecksOk: "Grounding check passed",
  pocResultChecksBad: "Grounding check: possible invented values",
  pocResultOpenCases: "Open the case view",
  pocResultRecord: "Record",
  pocResultDocument: "Document",
  pocResultTranscript: "Transcript",
  pocResultFiles: "Output files",
  pocResultSkipped: "{name} ({size}) is too large to download here.",
  pocResultLog: "Run log",
  previous: "Previous",
  nextPhase: "Next step",
  advancing: "Moving on…",
  approving: "Approving…",
  goingBack: "Going back…",
  gate1ChecklistTitle: "Gathered requirements",
  gate1Answered: "points answered",
  bcNotKnown: "Not known yet",
  gateApprovedWake: "Gate {n} approved in the panel, continue.",
  noticeAgentBusy: "The wizard is still working on this step. Wait for its reply in the chat, then try again.",
  noticeGateNotReady: "This gate cannot be approved yet: the wizard has not produced what the gate reviews. Continue in the chat until the wizard presents the result.",
  noticeGateMoved: "The session had already moved on in another window, so your decision was not saved. This is where the session stands now.",
  noticeEndFailed: "The session could not be ended. Try again in a moment.",
  bcTitle: "Business context",
  bcCurrentProcess: "Current process",
  bcExpectedValue: "Expected value",
  bcKnowledgeProcesses: "Knowledge processes",
  bcPainPoints: "Pain points",
  bcUsers: "Users",
  bcReviewers: "Reviewers",
  bcDomain: "Domain",
  gate1MissingContext:
    "Requirements are incomplete — the wizard hasn't gathered everything yet. Continue the conversation in the chat before approving.",
  gate1Missing: "Missing",
  asmTitle: "Open assumptions",
  asmConfirmedCount: "confirmed",
  asmIntro:
    "The wizard recorded these because information was missing. Review them before approving.",
  asmImpact: "Impact",
  asmUnconfirmed: "Unconfirmed",
  asmConfirmed: "Confirmed",
  gatheringCollecting: "Collecting requirements",
  gatheringPrompt:
    "Tell the wizard in the chat what you want to solve. It asks follow-up questions and fills in the list below from your answers. When the list is complete, you move on to the Gate 1 review.",
  solutionDoneTitle: "The solution is done",
  solutionDone:
    "All four gates are approved. The deployable package holds the PoC without the input data and run results.",
  solutionDoneDownload: "Download the deployable package",
  solutionDoneNoRun: "The package opens on the PoC tab once a sandbox run has succeeded.",
  solutionDoneTry: "Try it on your own cases",
  endSession: "End session",
  endingSession: "Ending…",
  endSessionHint:
    "Releases the wizard held for this session, so others can use it. The conversation and files are kept, and you can continue the session later.",
  phasesTitle: "Steps",
  saved: "Saved",
  gateWaiting: "Gate awaiting approval",
  skipToContent: "Skip to main content",
  sessionNameLabel: "Session name",
  chatInputLabel: "Message to the wizard",
  hideChat: "Hide chat",
  chatQuestions: {
    open: "Answer the questions one by one ({count})",
    send: "Send answers",
    close: "Close",
    placeholder: "Answer, or leave empty",
    skipHint: "Empty ones are sent as skipped.",
    failed: "Your answers were not sent, and they are kept here.",
    intro: "My answers to your questions (questions quoted):",
    line: "{n}. \"{question}\": {answer}",
    skip: "skip",
  },
  showChat: "Show chat",
  chatResize: "Resize the chat",
  phaseOf: "Step {n}/{total}",
  wsTabHints: {
    flow: "The solution's process as a diagram",
    json: "The solution's steps and their settings",
    poc: "Test the solution on sample data",
  },
  wsAiMark: "The solution, the diagram and the package are generated by AI. Check them before use.",
  phaseProgressNav: "Wizard steps",
  streamFailed: "Failed to stream the response.",
  chatThinking: "The wizard is thinking…",
  chatActivity: {
    write: "Writing a file",
    writeFile: "Writing {file}",
    read: "Reading a file",
    readFile: "Reading {file}",
    run: "Running a check",
    search: "Looking something up",
    work: "Working on the answer",
    elapsed: "{s} s",
    steps: "What the wizard did ({n})",
    files: {
      "use_case.blueprint.json": "the solution plan",
      "blueprint.json": "the solution plan",
      "output_schema.py": "the fields to extract",
      "output_schema_requirements.json": "the fields to extract",
      "extraction_requirements.md": "the extraction instructions",
      "workflow.bpmn": "the workflow diagram",
      "workflow.mmd": "the workflow diagram",
      "run_poc.py": "the test program",
      "config.yaml": "the test settings",
    },
    diagram: "Diagram",
    diagramSteps: "Diagram, steps in order: {steps}",
    diagramDrawing: "Drawing the diagram…",
    diagramExpand: "Enlarge",
    diagramClose: "Close",
    panel: {
      hint: "Ask for changes here, or make them yourself on the tabs.",
      referenceRemove: "Remove reference",
      background: "Your background",
      nonTechnical: "I'm not technical",
      nonTechnicalText: "My background: not technical. Ask in plain language and suggest defaults for the technical parts. ",
      technical: "I'm technical",
      technicalText: "My background: technical. Feel free to use technical terms and ask me about technical choices directly. ",
      start: {
        title: "What do you want to solve?",
        lede: "The wizard asks follow-up questions and gathers the requirements for you to approve.",
        placeholder:
          "Describe how the work is done today, the material it uses and the result you want…",
        examples: "Or start from an example",
        exampleList: [
          {
            title: "Voice to tickets",
            prompt:
              "Field technicians report faults as voice messages. We want to turn them into structured maintenance tickets.",
          },
          {
            title: "Invoice fields",
            prompt: "We want to extract the key fields from our suppliers' PDF invoices.",
          },
          {
            title: "Policy Q&A",
            prompt: "We want an assistant that answers questions from our internal policy documents.",
          },
          {
            title: "Multi-source report",
            prompt:
              "We want to put together a multi-section report from documents, transcripts and data files.",
          },
        ],
      },
      gateApproved: "Gate {n} approved",
      languageOffer: {
        fi: { label: "Vaihda suomeksi", message: "Jatka suomeksi." },
        en: { label: "Switch to English", message: "Continue in English." },
      },
    },
  },
  chatBusy:
    "The wizard is still finishing the previous reply — please wait a moment and resend.",
  chatErrors: {
    tooLong: "The message is too long. Shorten it or upload the material on the PoC tab.",
    capacity: "The wizard is busy with other sessions right now. Please try again in a minute.",
    agentBusy:
      "You already have as many wizard sessions working as allowed. Wait for one of them to reply, then try again.",
    rateLimited: "You are sending messages faster than the wizard allows. Wait a moment and resend.",
    turnLimit:
      "The wizard stopped after the most steps one message may take. Send “continue” to let it go on.",
  },

  phases: [
    "Session start",
    "Requirements gathering",
    "Specification",
    "Gate 1: requirements",
    "Schema design",
    "Component selection",
    "Blueprint assembly",
    "Visual workflow (BPMN)",
    "Gate 2: solution design",
    "PoC",
    "Gate 3: test run",
    "Documentation",
    "Gate 4: handover",
  ],
  gates: {
    locked: "Locked",
    pending: "Awaiting approval",
    approved: "Approved",
    rejected: "Rejected",
  },
  loginErrors: {
    credentials: "Wrong email or password.",
    unavailable: "Signing in is not available right now.",
    signup: "Sign-up failed.",
  },
  loginMessages: {
    "signed-up":
      "Signed up. Check your email for a confirmation link if email confirmation is on.",
  },
};

const DICTS: Record<Locale, Dict> = { fi, en };

/** The dictionary of `locale`, for code that runs outside a request (no cookie to read). */
export function dictionary(locale: Locale = DEFAULT_LOCALE): Dict {
  return DICTS[locale];
}

export async function getLocale(): Promise<Locale> {
  const c = await cookies();
  const v = c.get(LOCALE_COOKIE)?.value;
  return v === "en" || v === "fi" ? v : DEFAULT_LOCALE;
}

export async function getI18n(): Promise<{ locale: Locale; t: Dict }> {
  const locale = await getLocale();
  return { locale, t: DICTS[locale] };
}
