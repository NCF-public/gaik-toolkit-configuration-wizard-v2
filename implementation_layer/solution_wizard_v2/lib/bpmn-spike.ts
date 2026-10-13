/** V2 BPMN workspace — dynamic generation from session blueprint. */

/** Matches mock-sessions BPMN_VISUAL_STEP (onboarding phase 8). */
export const BPMN_VISUAL_STEP = 8;

/** Sprint 2 (#34): V2 BPMN — Modeler, JSON sync, dynamic generation. */
export const BPMN_V2_STARTED = true;

/** Mock sessions that show BPMN from phase 8 onward. */
export const BPMN_SPIKE_SESSION_IDS = new Set(["ses_chatbot", "ses_laskut"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Seed mock sessions + persisted API sessions (UUID). */
export function hasBpmnSpike(sessionId: string): boolean {
  return BPMN_SPIKE_SESSION_IDS.has(sessionId) || UUID_RE.test(sessionId);
}

/** BPMN from onboarding phase 8 (visual workflow) onward. */
export function shouldShowBpmnSpike(sessionId: string, wizardStep: number): boolean {
  return hasBpmnSpike(sessionId) && wizardStep >= BPMN_VISUAL_STEP;
}
