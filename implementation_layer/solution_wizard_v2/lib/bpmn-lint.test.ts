import { describe, expect, it } from "vitest";
import { lintBpmnXml } from "@/lib/bpmn-lint";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const BAD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false" />
</bpmn:definitions>`;

function generatedWizardXml(): string {
  const swSrc = resolve(__dirname, "../../solution_wizard/src");
  const implSrc = resolve(__dirname, "../../src");
  const script = `
from solution_wizard.v2_adapter import v2_to_v1_dict
from solution_wizard.bpmn_generator import generate_bpmn
from solution_wizard.blueprint import Blueprint
v2 = {"name":"Demo","description":"","goal":"","steps":[
 {"id":"a","name":"Upload","type":"io"},
 {"id":"b","name":"Extract","type":"ai","component":"DataExtractor"},
]}
print(generate_bpmn(Blueprint.model_validate(v2_to_v1_dict(v2, session_id="t"))))
`;
  return execFileSync("python3", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: [swSrc, implSrc, process.env.PYTHONPATH ?? ""].join(":"),
    },
  });
}

describe("lintBpmnXml (#47)", () => {
  it("blocks incomplete process with errors", async () => {
    const result = await lintBpmnXml(BAD_XML);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.rule.includes("start-event"))).toBe(true);
  });

  it("accepts wizard-generated BPMN (recommended rules)", async () => {
    const xml = generatedWizardXml();
    const result = await lintBpmnXml(xml);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("lints a customer reference BPMN without crashing", async () => {
    // Customer BPMN lives under gitignored docs/6.7_demo/ — skip in CI/clean clones.
    const ref = resolve(
      __dirname,
      "../docs/6.7_demo/extracted/Use_Case_Audio-to-Structured.bpmn",
    );
    if (!existsSync(ref)) {
      return;
    }
    const xml = readFileSync(ref, "utf8");
    const result = await lintBpmnXml(xml);
    expect(Array.isArray(result.issues)).toBe(true);
    expect(typeof result.ok).toBe("boolean");
  });
});
