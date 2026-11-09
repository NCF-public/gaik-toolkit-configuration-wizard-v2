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
  sessionsIntro: string;
  newSessionPlaceholder: string;
  startNew: string;
  previousSessions: string;
  noSessions: string;
  done: string;
  step: string;
  /** "blueprint v{n}": the session's active blueprint version. */
  blueprintVersion: string;
  /** The name a session gets when it is started without one. */
  untitledSession: string;
  updated: string;

  // wizard
  backToSessions: string;
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
  versions: string;
  phaseUpper: string;
  workspacePlaceholder: string;
  wsTabFlow: string;
  wsTabJson: string;
  wsTabPlan: string;
  wsTabPoc: string;
  wsBlueprintGoal: string;
  wsStepAi: string;
  wsStepHuman: string;
  wsStepIo: string;
  wsBpmnLoading: string;
  wsBpmnError: string;
  wsStepList: string;
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
  wsBpmnPropertiesClose: string;
  /** Readable names for the BPMN element types the editor shows. */
  wsBpmnTypeNames: Record<string, string>;
  /** After a diagram save: the PoC package was built from the earlier blueprint. */
  wsSavedPocNote: string;
  wsJsonSave: string;
  wsJsonSaving: string;
  wsJsonSaveError: string;
  wsJsonSaved: string;
  wsJsonInvalid: string;
  wsJsonChangedElsewhere: string;
  wsJsonHint: string;
  wsFormName: string;
  wsFormDescription: string;
  wsFormSteps: string;
  wsFormStepType: string;
  wsFormStepComponent: string;
  wsFormStepComponentNone: string;
  wsFormStepDescription: string;
  wsFormAddStep: string;
  wsFormRemoveStep: string;
  wsFormMoveUp: string;
  wsFormMoveDown: string;
  wsFormDevJson: string;
  wsFormInvalid: string;
  wsFormEmptySteps: string;
  wsFormNameHint: string;
  wsFormTypeHint: string;
  wsFormComponentHint: string;
  wsFormExpandStep: string;
  wsFormCollapseStep: string;
  wsFormStepSettings: string;
  wsFormSettingAdd: string;
  wsFormSettingRemove: string;
  wsFormSettingKeyPlaceholder: string;
  wsFormSettingValuePlaceholder: string;
  wsFormSettingsHint: string;
  wsFormSettingsEmpty: string;
  planIntro: string;
  planInputsTitle: string;
  planStepsTitle: string;
  planOutputsTitle: string;
  planHumanChecksTitle: string;
  planComponentLabel: string;
  planSettingsLabel: string;
  planNoSettingsLabel: string;
  planRoleAi: string;
  planRoleHuman: string;
  planRoleIo: string;
  planEmptySteps: string;
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
  pocPackageReady: string;
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
  pocInputFailed: string;
  pocDeployable: string;
  pocDeployableHint: string;
  pocOpenCases: string;
  pocOpenCasesHint: string;
  pocCheckRunning: string;
  pocCheckOk: string;
  pocCheckFailed: string;
  pocResultTitle: string;
  pocResultNone: string;
  pocResultChecksOk: string;
  pocResultChecksBad: string;
  pocResultOpenCases: string;
  pocResultRecord: string;
  pocResultDocument: string;
  pocResultTranscript: string;
  pocResultFiles: string;
  pocResultDownloads: string;
  pocResultSkipped: string;
  pocResultLog: string;
  gateNotice: string;
  previous: string;
  nextPhase: string;
  approveGate: string;
  advancing: string;
  approving: string;
  goingBack: string;
  /** Why "Previous" is disabled on the step after a passed checkpoint. */
  previousLockedHint: string;
  rejectGate: string;
  requestChanges: string;
  changesRequested: string;
  gateRejectedAck: string;
  gate1Rejected: string;
  gate1FeedbackSummary: string;
  gate1FeedbackLabel: string;
  gate1FeedbackPlaceholder: string;
  gate1Title: string;
  gate1Intro: string;
  gate1ChecklistTitle: string;
  gate1Answered: string;
  gate1Approve: string;
  gateApprovedWake: string;
  noticeAgentBusy: string;
  noticeGateNotReady: string;
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
  gatheringAdvanceHint: string;
  ready: string;
  nextPhaseHint: string;
  solutionDone: string;
  solutionDoneDownload: string;
  solutionDoneNoRun: string;
  phasesTitle: string;
  saved: string;
  gateWaiting: string;
  skipToContent: string;
  sessionNameLabel: string;
  chatInputLabel: string;
  hideChat: string;
  showChat: string;
  /** Accessible name of the handle that resizes the chat. */
  chatResize: string;
  /** "Vaihe {n}/{total}": the step, where the timeline is not shown. */
  phaseOf: string;
  /** The requirements checklist before the wizard has asked anything. */
  gatheringEmpty: string;
  /** One line under each workspace tab name: what the tab shows. */
  wsTabHints: { flow: string; json: string; plan: string; poc: string };
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
  exportSessionOpen: "Lataa tiedot",
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
  sessionsIntro:
    "Aloita uusi käyttötapaus tai jatka aiempaa siitä vaiheesta mihin jäit.",
  newSessionPlaceholder: "Uuden session nimi (esim. Asiakaspalvelun chatbot)",
  startNew: "Aloita uusi",
  previousSessions: "Aiemmat sessiot",
  noSessions: "Ei vielä sessioita. Aloita uusi yltä.",
  done: "Valmis",
  step: "Vaihe",
  blueprintVersion: "blueprint v{n}",
  untitledSession: "Nimetön sessio",
  updated: "Päivitetty",

  backToSessions: "Sessiot",
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
  versions: "versiota",
  phaseUpper: "VAIHE",
  workspacePlaceholder:
    "BPMN-canvas / JSON-blueprint / PoC / dokumentaatio (placeholder). Tämän vaiheen sisältö renderöityy tähän.",
  wsTabFlow: "Työnkulku",
  wsTabJson: "Blueprint",
  wsTabPlan: "Suunnitelma",
  wsTabPoc: "PoC",
  wsBlueprintGoal: "Tavoite",
  wsStepAi: "Tekoäly",
  wsStepHuman: "Ihmisen tarkistus",
  wsStepIo: "Syöte tai tulos",
  wsBpmnLoading: "Ladataan BPMN-kaaviota…",
  wsBpmnError: "BPMN-kaavion lataus epäonnistui.",
  wsStepList: "Vaiheet listana",
  wsBpmnV2Started: "V2 aloitettu",
  wsBpmnReadOnly: "Vain katselu",
  wsBpmnEditable: "Muokattava",
  wsBpmnSave: "Tallenna",
  wsBpmnSaving: "Tallennetaan…",
  wsBpmnSaveError: "Tallennus epäonnistui",
  wsBpmnSaved: "Tallennettu",
  wsBpmnLintBlocked: "BPMN-validointi esti tallennuksen",
  wsBpmnLintWarnings: "BPMN-varoitukset",
  wsBpmnDialogTitle: "Visuaalinen työnkulku (BPMN)",
  wsBpmnInlineHint:
    "Muokkaa kaaviota vasemman reunan työkaluilla; elementtiä klikkaamalla näet sen tiedot. Tallennus päivittää blueprintin.",
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
  wsBpmnPropertiesClose: "Sulje",
  wsBpmnTypeNames: {
    "bpmn:Task": "Tehtävä",
    "bpmn:UserTask": "Ihmisen tehtävä",
    "bpmn:ServiceTask": "Järjestelmän tehtävä",
    "bpmn:ScriptTask": "Automaattinen tehtävä",
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
  wsJsonSave: "Tallenna blueprint",
  wsJsonSaving: "Tallennetaan…",
  wsJsonSaveError: "Tallennus epäonnistui",
  wsJsonSaved: "Tallennettu",
  wsJsonInvalid: "Virheellinen blueprint-JSON",
  wsJsonChangedElsewhere:
    "Blueprint päivittyi muokkauksesi aikana. Tallentaminen korvaa uudemman version muokkauksillasi.",
  wsJsonHint:
    "Muokkaa blueprintiä lomakkeella. Tallenna päivittää sessionin ja generoi BPMN-kaavion uudelleen Työnkulku-välilehdellä. Kehittäjänäkymä (JSON) on tarpeen mukaan avattavissa alla.",
  wsFormName: "Nimi",
  wsFormDescription: "Kuvaus",
  wsFormSteps: "Työnkulun vaiheet",
  wsFormStepType: "Tyyppi",
  wsFormStepComponent: "Komponentti",
  wsFormStepComponentNone: "Ei komponenttia",
  wsFormStepDescription: "Kuvaus",
  wsFormAddStep: "Lisää vaihe",
  wsFormRemoveStep: "Poista vaihe",
  wsFormMoveUp: "Siirrä ylös",
  wsFormMoveDown: "Siirrä alas",
  wsFormDevJson: "Kehittäjänäkymä (JSON)",
  wsFormInvalid: "Täytä nimi ja jokaisen vaiheen nimi.",
  wsFormEmptySteps: "Ei vaiheita vielä. Lisää ensimmäinen vaihe.",
  wsFormNameHint: "Sama nimi näkyy ja on muokattavissa myös BPMN-kaaviossa.",
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
  wsFormSettingsHint:
    "Komponentin konfiguraatio (SME-4) — ei vain komponentin nimi vaan sen asetukset.",
  wsFormSettingsEmpty: "Ei asetuksia. Lisää esim. malli tai parametri.",
  planIntro:
    "Luettava suunnitelma liiketoimintakielellä (SME-5) — sama sisältö kuin blueprintissa ja BPMN-kaaviossa, mutta ilman JSONia tai kaaviosymboleita.",
  planInputsTitle: "Syötteet",
  planStepsTitle: "Vaiheet",
  planOutputsTitle: "Tulosteet",
  planHumanChecksTitle: "Ihmisen tarkistukset",
  planComponentLabel: "Komponentti",
  planSettingsLabel: "Asetukset",
  planNoSettingsLabel: "Ei asetuksia",
  planRoleAi: "Tekoäly",
  planRoleHuman: "Ihminen",
  planRoleIo: "Syöte/tuloste",
  planEmptySteps: "Ei vielä vaiheita. Lisää blueprint Blueprint-välilehdellä.",
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
  pocGeneratedTitle: "Generoitu PoC-paketti",
  pocNotReadyTitle: "PoC-paketti ei ole valmis — puuttuu:",
  pocDownload: "Lataa työversio",
  pocNotGenerated:
    "PoC-pakettia ei ole vielä generoitu. Se syntyy kun wizard etenee Gate 3:een asti.",
  pocLoading: "Haetaan PoC-pakettia…",
  pocStepPackage: "Paketti",
  pocStepRun: "Testiajo",
  pocStepUse: "Kokeile ja ota käyttöön",
  pocPackageReady: "Valmis ajettavaksi",
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
  pocInputFailed: "Tiedoston lisäys epäonnistui",
  pocDeployable: "Lataa käyttöönottopaketti",
  pocOpenCases: "Kokeile omilla tapauksilla",
  pocOpenCasesHint: "Avaa ratkaisun käyttönäkymän: roolit BPMN:stä, tapaus ajetaan sandboxissa omalla syötteellä.",
  pocDeployableHint: "Käyttöönottopaketti avautuu, kun testiajo on onnistunut.",
  pocCheckRunning: "Tarkistetaan pakettia…",
  pocCheckOk: "Paketti tarkistettu",
  pocCheckFailed: "Tarkistus löysi virheitä, jotka kaatavat ajon:",
  pocResultTitle: "Ajon tulos",
  pocResultNone: "Ajo onnistui, mutta se ei kirjoittanut tulostiedostoja output/-kansioon.",
  pocResultChecksOk: "Lähdetarkistus läpi",
  pocResultChecksBad: "Lähdetarkistus: mahdollisia keksittyjä arvoja",
  pocResultOpenCases: "Avaa tapausnäkymä",
  pocResultRecord: "Tietue",
  pocResultDocument: "Dokumentti",
  pocResultTranscript: "Litterointi",
  pocResultFiles: "Tulostiedostot",
  pocResultDownloads: "Lataa ajon tuottamat tiedostot",
  pocResultSkipped: "{name} ({size}) on liian suuri ladattavaksi tästä.",
  pocResultLog: "Ajon loki",
  gateNotice:
    "Tämä on gate-vaihe. Hyväksy jatkaaksesi seuraavaan vaiheeseen.",
  previous: "Edellinen",
  nextPhase: "Seuraava vaihe",
  approveGate: "Hyväksy gate",
  advancing: "Siirrytään…",
  approving: "Hyväksytään…",
  goingBack: "Palataan…",
  previousLockedHint:
    "Hyväksyttyyn tarkastuspisteeseen ei palata. Pyydä muutokset chatissa.",
  rejectGate: "Hylkää",
  requestChanges: "Pyydä muutoksia",
  changesRequested:
    "Muutospyyntö kirjattu. Tarkennetaan vaatimuksia palautteen perusteella — gate pysyy avoimena.",
  gateRejectedAck:
    "Gate hylätty ja perustelu kirjattu. Kerro mitä pitää muuttaa, niin korjataan.",
  gate1Rejected:
    "Tämä gate on hylätty. Perustelu on chatissa — jatka keskustelua tai hyväksy vaatimukset uudelleen kun ne on korjattu.",
  gate1FeedbackSummary: "Pyydä muutoksia tai hylkää",
  gate1FeedbackLabel: "Mitä pitää muuttaa? (pakollinen)",
  gate1FeedbackPlaceholder:
    "Esim. syötemuoto on väärä — dokumentit tulevat skannattuina PDF-tiedostoina, ei Word-muodossa.",
  gate1Title: "Vaatimusten tarkistus",
  gate1Intro:
    "Tarkista että vaiheissa 1–3 kerätyt vaatimukset ovat riittävät. Hyväksyntä lukitsee vaatimukset ja käynnistää arkkitehtuurin suunnittelun.",
  gate1ChecklistTitle: "Kerätyt vaatimukset",
  gate1Answered: "kohtaa vastattu",
  gate1Approve: "Hyväksy vaatimukset ja jatka",
  gateApprovedWake: "Gate {n} hyväksytty paneelista, jatka.",
  noticeAgentBusy: "Wizard työskentelee vielä tässä vaiheessa. Odota sen vastausta chatissa ja yritä sitten uudelleen.",
  noticeGateNotReady: "Tätä gatea ei voi vielä hyväksyä: wizard ei ole tuottanut sitä, mitä gate tarkistaa. Jatka chatissa, kunnes wizard esittää tuloksen.",
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
  gatheringAdvanceHint:
    "Vastaa ensin wizardin kysymyksiin chatissa — se etenee automaattisesti kun vaatimukset ovat kasassa.",
  ready: "Valmis",
  nextPhaseHint: "Siirtyy seuraavaan vaiheeseen. Blueprint ei muutu.",
  solutionDone:
    "Gate 4 on hyväksytty ja ratkaisu on valmis. Käyttöönottopaketti sisältää PoC:n ilman syöteaineistoa ja ajon tuloksia.",
  solutionDoneDownload: "Lataa käyttöönottopaketti",
  solutionDoneNoRun: "Paketti avautuu PoC-välilehdellä, kun sandbox-ajo on onnistunut.",
  phasesTitle: "Vaiheet",
  saved: "Tallennettu",
  gateWaiting: "Gate odottaa hyväksyntää",
  skipToContent: "Siirry pääsisältöön",
  sessionNameLabel: "Sessionin nimi",
  chatInputLabel: "Viesti wizardille",
  hideChat: "Piilota keskustelu",
  showChat: "Näytä keskustelu",
  chatResize: "Muuta keskustelun leveyttä",
  phaseOf: "Vaihe {n}/{total}",
  gatheringEmpty: "Lista täyttyy, kun vastaat wizardin kysymyksiin chatissa.",
  wsTabHints: {
    flow: "Ratkaisun prosessi kaaviona",
    json: "Ratkaisun rakenne muokattavana lomakkeena",
    plan: "Sama ratkaisu tekstinä: syötteet, vaiheet ja tarkistukset",
    poc: "Testaa ratkaisu esimerkkiaineistolla",
  },
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
  },
  chatBusy:
    "Wizard vastaa vielä edelliseen viestiin — hetki, ja lähetä uudelleen.",
  chatErrors: {
    tooLong: "Viesti on liian pitkä. Lyhennä sitä tai lisää pitkä teksti tiedostona.",
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
  exportSessionOpen: "Download data",
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
  sessionsIntro:
    "Start a new use case or continue an earlier one from where you left off.",
  newSessionPlaceholder: "New session name (e.g. Customer service chatbot)",
  startNew: "Start new",
  previousSessions: "Previous sessions",
  noSessions: "No sessions yet. Start a new one above.",
  done: "Done",
  step: "Step",
  blueprintVersion: "blueprint v{n}",
  untitledSession: "Untitled session",
  updated: "Updated",

  backToSessions: "Sessions",
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
  versions: "versions",
  phaseUpper: "STEP",
  workspacePlaceholder:
    "BPMN canvas / JSON blueprint / PoC / documentation (placeholder). This step's content renders here.",
  wsTabFlow: "Workflow",
  wsTabJson: "Blueprint",
  wsTabPlan: "Plan",
  wsTabPoc: "PoC",
  wsBlueprintGoal: "Goal",
  wsStepAi: "AI step",
  wsStepHuman: "Human review",
  wsStepIo: "Input or output",
  wsBpmnLoading: "Loading BPMN diagram…",
  wsBpmnError: "Failed to load BPMN diagram.",
  wsStepList: "Steps as a list",
  wsBpmnV2Started: "V2 started",
  wsBpmnReadOnly: "View only",
  wsBpmnEditable: "Editable",
  wsBpmnSave: "Save",
  wsBpmnSaving: "Saving…",
  wsBpmnSaveError: "Save failed",
  wsBpmnSaved: "Saved",
  wsBpmnLintBlocked: "BPMN validation blocked save (bpmnlint)",
  wsBpmnLintWarnings: "BPMN warnings",
  wsBpmnDialogTitle: "Visual workflow (BPMN)",
  wsBpmnInlineHint:
    "Edit the diagram with the tools on the left; click an element to see its details. Saving updates the blueprint.",
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
  wsBpmnPropertiesClose: "Close",
  wsBpmnTypeNames: {
    "bpmn:Task": "Task",
    "bpmn:UserTask": "Task for a person",
    "bpmn:ServiceTask": "System task",
    "bpmn:ScriptTask": "Automatic task",
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
  wsJsonSave: "Save blueprint",
  wsJsonSaving: "Saving…",
  wsJsonSaveError: "Save failed",
  wsJsonSaved: "Saved",
  wsJsonInvalid: "Invalid blueprint JSON",
  wsJsonChangedElsewhere:
    "The blueprint was updated while you were editing. Saving replaces the newer version with your edits.",
  wsJsonHint:
    "Edit the blueprint with the form. Save updates the session and regenerates the BPMN diagram on the Workflow tab. The developer JSON view is available below if needed.",
  wsFormName: "Name",
  wsFormDescription: "Description",
  wsFormSteps: "Workflow steps",
  wsFormStepType: "Type",
  wsFormStepComponent: "Component",
  wsFormStepComponentNone: "No component",
  wsFormStepDescription: "Description",
  wsFormAddStep: "Add step",
  wsFormRemoveStep: "Remove step",
  wsFormMoveUp: "Move up",
  wsFormMoveDown: "Move down",
  wsFormDevJson: "Developer view (JSON)",
  wsFormInvalid: "Fill in the name and every step's name.",
  wsFormEmptySteps: "No steps yet. Add the first step.",
  wsFormNameHint: "This name also appears and is editable in the BPMN diagram.",
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
  wsFormSettingsHint:
    "Component configuration (SME-4) — not just the component name but its settings.",
  wsFormSettingsEmpty: "No settings yet. Add e.g. a model or parameter.",
  planIntro:
    "A readable plan in business language (SME-5) — the same content as the blueprint and BPMN diagram, without JSON or diagram notation.",
  planInputsTitle: "Inputs",
  planStepsTitle: "Steps",
  planOutputsTitle: "Outputs",
  planHumanChecksTitle: "Human checks",
  planComponentLabel: "Component",
  planSettingsLabel: "Settings",
  planNoSettingsLabel: "No settings",
  planRoleAi: "AI",
  planRoleHuman: "Human",
  planRoleIo: "Input/output",
  planEmptySteps: "No steps yet. Add a blueprint on the Blueprint tab.",
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
  pocGeneratedTitle: "Generated PoC package",
  pocNotReadyTitle: "The PoC package is not ready — missing:",
  pocDownload: "Download working copy",
  pocNotGenerated:
    "The PoC package has not been generated yet. It appears once the wizard reaches Gate 3.",
  pocLoading: "Loading the PoC package…",
  pocStepPackage: "Package",
  pocStepRun: "Test run",
  pocStepUse: "Try it and take it into use",
  pocPackageReady: "Ready to run",
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
  pocInputFailed: "The file could not be added",
  pocDeployable: "Download package for deployment",
  pocOpenCases: "Try it on your own cases",
  pocOpenCasesHint: "Opens the solution in use: roles from the BPMN, each case run in the sandbox on its own input.",
  pocDeployableHint: "The deployment package opens once a test run has succeeded.",
  pocCheckRunning: "Checking the package…",
  pocCheckOk: "Package checked",
  pocCheckFailed: "The check found problems that would fail the run:",
  pocResultTitle: "Run result",
  pocResultNone: "The run succeeded but wrote no output files to output/.",
  pocResultChecksOk: "Grounding check passed",
  pocResultChecksBad: "Grounding check: possible invented values",
  pocResultOpenCases: "Open the case view",
  pocResultRecord: "Record",
  pocResultDocument: "Document",
  pocResultTranscript: "Transcript",
  pocResultFiles: "Output files",
  pocResultDownloads: "Download the files the run produced",
  pocResultSkipped: "{name} ({size}) is too large to download here.",
  pocResultLog: "Run log",
  gateNotice: "This is a gate step. Approve to continue to the next step.",
  previous: "Previous",
  nextPhase: "Next step",
  approveGate: "Approve gate",
  advancing: "Moving on…",
  approving: "Approving…",
  goingBack: "Going back…",
  previousLockedHint:
    "An approved checkpoint is not reopened. Ask for changes in the chat.",
  rejectGate: "Reject",
  requestChanges: "Request changes",
  changesRequested:
    "Changes requested. The requirements will be revised from your feedback — the gate stays open.",
  gateRejectedAck:
    "Gate rejected and the reason recorded. Tell me what needs to change and I will fix it.",
  gate1Rejected:
    "This gate was rejected. The reason is in the chat — keep the conversation going, or approve the requirements again once they are fixed.",
  gate1FeedbackSummary: "Request changes or reject",
  gate1FeedbackLabel: "What needs to change? (required)",
  gate1FeedbackPlaceholder:
    "e.g. the input format is wrong — the documents arrive as scanned PDFs, not Word files.",
  gate1Title: "Requirements review",
  gate1Intro:
    "Check that the requirements gathered in steps 1–3 are sufficient. Approving locks the requirements and starts the architecture design.",
  gate1ChecklistTitle: "Gathered requirements",
  gate1Answered: "points answered",
  gate1Approve: "Approve requirements and continue",
  gateApprovedWake: "Gate {n} approved in the panel, continue.",
  noticeAgentBusy: "The wizard is still working on this step. Wait for its reply in the chat, then try again.",
  noticeGateNotReady: "This gate cannot be approved yet: the wizard has not produced what the gate reviews. Continue in the chat until the wizard presents the result.",
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
  gatheringAdvanceHint:
    "Please answer the wizard's questions in the chat first — it advances automatically once the requirements are complete.",
  ready: "Done",
  nextPhaseHint: "Moves to the next step. The blueprint does not change.",
  solutionDone:
    "Gate 4 is approved and the solution is done. The deployable package holds the PoC without the input data and run results.",
  solutionDoneDownload: "Download the deployable package",
  solutionDoneNoRun: "The package opens on the PoC tab once a sandbox run has succeeded.",
  phasesTitle: "Steps",
  saved: "Saved",
  gateWaiting: "Gate awaiting approval",
  skipToContent: "Skip to main content",
  sessionNameLabel: "Session name",
  chatInputLabel: "Message to the wizard",
  hideChat: "Hide chat",
  showChat: "Show chat",
  chatResize: "Resize the chat",
  phaseOf: "Step {n}/{total}",
  gatheringEmpty: "The list fills in as you answer the wizard's questions in the chat.",
  wsTabHints: {
    flow: "The solution's process as a diagram",
    json: "The solution's structure as an editable form",
    plan: "The same solution as text: inputs, steps and checks",
    poc: "Test the solution on sample data",
  },
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
  },
  chatBusy:
    "The wizard is still finishing the previous reply — please wait a moment and resend.",
  chatErrors: {
    tooLong: "The message is too long. Shorten it or add the long text as a file.",
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
