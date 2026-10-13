import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { BPMN_SPIKE_ASSET, hasBpmnSpike } from "@/lib/bpmn-spike";
import { getSession } from "@/lib/mock-sessions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }
  if (!hasBpmnSpike(id)) {
    return new Response("BPMN not available for this session", { status: 404 });
  }

  const filePath = path.join(process.cwd(), "public", "bpmn", BPMN_SPIKE_ASSET);
  try {
    const xml = await readFile(filePath, "utf8");
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("BPMN asset missing", { status: 500 });
  }
}
