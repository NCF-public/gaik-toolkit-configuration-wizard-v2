import { NextRequest } from "next/server";
import type { Blueprint } from "@/lib/mock-sessions";
import { parseBlueprintJson } from "@/lib/blueprint-parse";
import { requireOwnedSession } from "@/lib/session-access";
import { patchSessionBlueprint } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owned = await requireOwnedSession(id);
  if (!owned) {
    return new Response("Session not found", { status: 404 });
  }

  let body: { content?: unknown; note?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed =
    typeof body.content === "string"
      ? parseBlueprintJson(body.content)
      : parseBlueprintJson(JSON.stringify(body.content ?? {}));
  if (!parsed) {
    return new Response("Invalid blueprint", { status: 400 });
  }

  const updated = await patchSessionBlueprint(
    id,
    parsed,
    typeof body.note === "string" ? body.note : "Blueprint päivitetty JSON-editorista",
  );
  if (!updated) {
    return new Response("Blueprint save failed", { status: 500 });
  }

  return Response.json({ blueprint: updated.blueprint });
}
