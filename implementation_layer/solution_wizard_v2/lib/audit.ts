import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/request-context";

export type AuditOutcome = "success" | "denied" | "error";

/**
 * The agreed Sprint 3 audit event set (docs/2026-08-logging/, issue S3-10).
 * blueprint.ops / blueprint.version.restore are declared for forward
 * compatibility with the change-ops work (#66/#67) — not emitted yet, since
 * that functionality doesn't exist in this branch.
 */
export type AuditEvent =
  | "auth.login"
  | "auth.logout"
  | "auth.denied"
  | "session.create"
  | "blueprint.update"
  | "blueprint.ops"
  | "blueprint.version.restore"
  | "bpmn.sync"
  | "poc.generate";

export type AuditFields = {
  /** Who — the signed-in user's email. Never log passwords/tokens/cookies here. */
  actor?: string;
  /** What was acted on. */
  resource?: { type: string; id: string };
  /** Free-text action detail — keep it to identifiers/counts, not content. */
  action?: string;
  outcome: AuditOutcome;
  traceId?: string;
  [key: string]: unknown;
};

/**
 * Audit trail (S3-10 Vaihe 2) — who did what, when, with what outcome.
 * Tagged `type: "audit"` so it can be filtered out of operational logs.
 * Stdout JSON only this sprint; persistence/retention is Vaihe 3, out of
 * scope for #82.
 */
export function audit(event: AuditEvent, fields: AuditFields): void {
  const { traceId, ...rest } = fields;
  logger.info(
    { type: "audit", event, traceId: traceId ?? getTraceId(), ...rest },
    `audit.${event}`,
  );
}
