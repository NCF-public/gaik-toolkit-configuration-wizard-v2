/**
 * Server-side bpmnlint wrapper (Node only — do not import from client components).
 * Spawns scripts/lint-bpmn.mjs so bpmnlint's NodeResolver works under Next.js.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

export type BpmnLintIssue = {
  rule: string;
  id: string;
  message: string;
  category: "error" | "warn" | "info";
};

export type BpmnLintResult = {
  ok: boolean;
  errors: BpmnLintIssue[];
  warnings: BpmnLintIssue[];
  issues: BpmnLintIssue[];
};

export async function lintBpmnXml(xml: string): Promise<BpmnLintResult> {
  const script = path.join(process.cwd(), "scripts", "lint-bpmn.mjs");
  const result = spawnSync(process.execPath, [script], {
    input: xml,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    cwd: process.cwd(),
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `bpmn lint process exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as BpmnLintResult;
  return {
    ok: Boolean(parsed.ok),
    errors: parsed.errors ?? [],
    warnings: parsed.warnings ?? [],
    issues: parsed.issues ?? [],
  };
}
