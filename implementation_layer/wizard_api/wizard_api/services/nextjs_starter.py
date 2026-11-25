"""Opt-in Next.js App Router starter assembled beside ``poc/`` at deployable export time.

The generated PoC package already ships ``poc/app.py`` with a small JSON API
(``GET /api/solution``, ``POST /api/run``, ``GET /api/status``,
``GET /api/runs/<id>/files/<name>``). When the user opts in on download
(``?include_frontend=true``), this module produces a self-contained ``frontend/``
folder that proxies those endpoints from Next.js Route Handlers (never exposing
``/api/source``) and includes an ``AGENT_PROMPT.md`` so a coding agent can adapt
the UI to the exact use case.

Local-first by design: ``poc/app.py`` has no sign-in and listens on loopback by
default; hosted deployment requires adding authentication, run ownership and
private artifact delivery.
"""
# ruff: noqa: E501

from __future__ import annotations

import json
import os
from typing import Any

from wizard_api.services import poc_service


def supports_nextjs_starter(poc_dir: str) -> bool:
    """True when the package has the test-page server and descriptor the starter calls."""
    return poc_service.regular_file(
        os.path.join(poc_dir, "app.py"), poc_dir
    ) and poc_service.regular_file(os.path.join(poc_dir, "ui", "solution.json"), poc_dir)


def _read_solution_descriptor(poc_dir: str) -> dict[str, Any]:
    path = os.path.join(poc_dir, "ui", "solution.json")
    if not poc_service.regular_file(path, poc_dir):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _package_json(slug: str) -> str:
    # npm takes URL-friendly names only: ASCII letters, digits and dashes.
    safe_slug = "".join(
        ch if (ch.isascii() and ch.isalnum()) or ch == "-" else "-" for ch in slug.lower()
    ).strip("-")
    name = f"{safe_slug or 'gaik-poc'}-frontend"
    data = {
        "name": name,
        "version": "0.1.0",
        "private": True,
        "scripts": {
            "dev": "next dev -H 127.0.0.1 --port 3001",
            "build": "next build",
            "start": "next start -H 127.0.0.1 --port 3001",
            "typecheck": "tsc --noEmit",
        },
        "dependencies": {
            "next": "^16.0.0",
            "react": "^19.0.0",
            "react-dom": "^19.0.0",
        },
        "devDependencies": {
            "@tailwindcss/postcss": "^4.0.0",
            "@types/node": "^22.0.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            "tailwindcss": "^4.0.0",
            "typescript": "^5.7.0",
        },
    }
    return json.dumps(data, indent=2) + "\n"


_TSCONFIG_JSON = """\
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
"""

_NEXT_CONFIG_TS = """\
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
"""

_POSTCSS_CONFIG = """\
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
"""

_ENV_EXAMPLE = """\
# Base URL of the local Python PoC server (started with `python app.py` in ../poc)
POC_API_URL=http://127.0.0.1:8000
"""

_GITIGNORE = """\
node_modules/
.next/
.env
.env.local
"""

_GLOBALS_CSS = """\
@import "tailwindcss";

:root {
  color-scheme: light;
}

body {
  background: #f4f6fb;
  color: #111b28;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
"""

_LAYOUT_TSX = """\
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GAIK PoC Frontend Starter",
  description: "Next.js App Router starter connected to the local GAIK PoC backend.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
"""

_BACKEND_HELPER_TS = """\
import type { NextRequest } from "next/server";

/**
 * Server-side base URL for the local Python PoC server (`poc/app.py`).
 * Keep this server-only: never call `poc/app.py` directly from browser code
 * and never proxy `/api/source`.
 */
export function pocApiUrl(): string {
  return (process.env.POC_API_URL || "http://127.0.0.1:8000").replace(/\\/+$/, "");
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Reject non-loopback Host headers and cross-origin browser writes so another
 * website or LAN host cannot trigger local runs with the owner's API keys.
 */
export function isLocalSameOriginRequest(req: NextRequest): boolean {
  const hostHeader = (req.headers.get("host") || "").trim().toLowerCase();
  if (!hostHeader) return false;
  const hostname = hostHeader.startsWith("[")
    ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
    : hostHeader.split(":")[0];
  if (!LOOPBACK_HOSTS.has(hostname)) return false;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host.toLowerCase() !== hostHeader) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = (req.headers.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  return true;
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
"""

_API_SOLUTION_ROUTE = """\
import { NextRequest, NextResponse } from "next/server";
import { isLocalSameOriginRequest, pocApiUrl } from "@/lib/poc-backend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // poc/app.py refuses a foreign Host on every route; so does its proxy here.
  if (!isLocalSameOriginRequest(req)) {
    return NextResponse.json({ ok: false, error: { code: "forbidden" } }, { status: 403 });
  }
  try {
    const res = await fetch(`${pocApiUrl()}/api/solution`, { cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "backend_unreachable",
          message: "Could not reach the local PoC server. Run `python app.py` in ../poc first.",
        },
      },
      { status: 502 },
    );
  }
}
"""

_API_STATUS_ROUTE = """\
import { NextRequest, NextResponse } from "next/server";
import { isLocalSameOriginRequest, pocApiUrl } from "@/lib/poc-backend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // The log tail can quote the run's inputs: the same loopback check as /api/run.
  if (!isLocalSameOriginRequest(req)) {
    return NextResponse.json({ busy: false, elapsed_seconds: 0, log_tail: "" }, { status: 403 });
  }
  try {
    const res = await fetch(`${pocApiUrl()}/api/status`, { cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ busy: false, elapsed_seconds: 0, log_tail: "" }, { status: 502 });
  }
}
"""

_API_RUN_ROUTE = """\
import { NextRequest, NextResponse } from "next/server";
import { isLocalSameOriginRequest, MAX_UPLOAD_BYTES, pocApiUrl } from "@/lib/poc-backend";

export const dynamic = "force-dynamic";

async function readBoundedBody(req: NextRequest, limit: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function POST(req: NextRequest) {
  if (!isLocalSameOriginRequest(req)) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Only same-origin local requests are allowed." } },
      { status: 403 },
    );
  }
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: { code: "not_a_form", message: "Send inputs as multipart/form-data." } },
      { status: 415 },
    );
  }
  const raw = await readBoundedBody(req, MAX_UPLOAD_BYTES);
  if (raw === null) {
    return NextResponse.json(
      { ok: false, error: { code: "payload_too_large", message: "Upload exceeds the 50 MB limit." } },
      { status: 413 },
    );
  }
  try {
    // Preserve exact Content-Length framing for poc/app.py while staying bounded.
    const res = await fetch(`${pocApiUrl()}/api/run`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(raw.byteLength),
      },
      body: Buffer.from(raw),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    // Node's fetch stops waiting for the answer after about 300 s while the
    // run goes on in poc/app.py: that is not an unreachable server.
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "proxy_timeout",
            message:
              "The run took longer than this frontend waits for an answer (about 5 minutes). " +
              "It may still be running: see the terminal of `python app.py`.",
          },
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "backend_unreachable",
          message: "Could not reach the local PoC server. Run `python app.py` in ../poc first.",
        },
      },
      { status: 502 },
    );
  }
}
"""

_API_FILE_ROUTE = """\
import { NextRequest, NextResponse } from "next/server";
import { isLocalSameOriginRequest, pocApiUrl } from "@/lib/poc-backend";

export const dynamic = "force-dynamic";

const RUN_ID_RE = /^[0-9a-f]{16}$/;

function validSegments(segments: string[]): boolean {
  if (segments.length === 0) return false;
  return segments.every(
    (seg) =>
      seg.length > 0 &&
      seg !== "." &&
      seg !== ".." &&
      !seg.includes("/") &&
      !seg.includes("\\\\") &&
      !seg.includes("\\u0000"),
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; path: string[] }> },
) {
  if (!isLocalSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { runId, path } = await params;
  if (!RUN_ID_RE.test(runId) || !validSegments(path)) {
    return NextResponse.json({ error: "invalid file request" }, { status: 400 });
  }
  const encodedPath = path.map((seg) => encodeURIComponent(seg)).join("/");
  const fallbackName = path[path.length - 1] ?? "output";
  try {
    const res = await fetch(`${pocApiUrl()}/api/runs/${encodeURIComponent(runId)}/files/${encodedPath}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return new NextResponse(await res.text(), { status: res.status });
    }
    const bytes = await res.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition":
          res.headers.get("content-disposition") ?? `attachment; filename="${fallbackName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
"""

_PAGE_TSX = """\
import { SolutionRunner } from "@/components/solution-runner";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <SolutionRunner />
    </main>
  );
}
"""

_SOLUTION_RUNNER_TSX = """\
"use client";

import { useEffect, useState } from "react";

type InputGroup = {
  kind: string;
  label: string;
  extensions: string[];
  multiple: boolean;
};

type OutputField = {
  key: string;
  label: string;
  type: string;
  description?: string;
};

type SolutionDescriptor = {
  id?: string;
  name?: string;
  purpose?: string;
  language?: string;
  inputs?: InputGroup[];
  asks_question?: boolean;
  question_label?: string;
  output_fields?: OutputField[];
  sample_files?: string[];
  env_file?: boolean;
};

type RunOutput = {
  name: string;
  kind: string;
  size: number;
  url: string;
};

type RunResponse = {
  ok: boolean;
  run_id?: string;
  exit_code?: number;
  duration_seconds?: number;
  log_tail?: string;
  outputs?: RunOutput[];
  result?: unknown;
  error?: { code?: string; message?: string };
};

function proxyFileHref(runId: string | undefined, output: RunOutput): string {
  if (!runId) return "#";
  const encodedPath = output.name
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `/api/files/${encodeURIComponent(runId)}/${encodedPath}`;
}

export function SolutionRunner() {
  const [solution, setSolution] = useState<SolutionDescriptor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<RunResponse | null>(null);

  useEffect(() => {
    fetch("/api/solution", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || "Failed to load solution metadata");
        setSolution(data);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Backend unavailable"));
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        const status = (await res.json()) as { elapsed_seconds?: number };
        if (typeof status.elapsed_seconds === "number") setElapsed(status.elapsed_seconds);
      } catch {
        // Ignore transient status poll errors while the run is active.
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [running]);

  const accept = (solution?.inputs ?? [])
    .flatMap((group) => group.extensions ?? [])
    .join(",");

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    setRunning(true);
    setElapsed(0);
    setResult(null);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file, file.name);
      if (solution?.asks_question && question.trim()) form.append("question", question.trim());
      const res = await fetch("/api/run", { method: "POST", body: form });
      const data = (await res.json()) as RunResponse;
      setResult(data);
    } catch {
      setResult({ ok: false, error: { message: "Request failed while contacting /api/run." } });
    } finally {
      setRunning(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        <h1 className="text-base font-semibold">PoC backend not reachable</h1>
        <p className="mt-2">{loadError}</p>
        <p className="mt-2 font-mono text-xs">cd ../poc && python app.py</p>
      </div>
    );
  }

  if (!solution) {
    return <p className="text-sm text-slate-600">Loading solution configuration...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <p className="text-xs font-medium uppercase tracking-wide text-sky-700">GAIK PoC Starter UI</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{solution.name || "GAIK Solution"}</h1>
        {solution.purpose && <p className="mt-2 text-sm text-slate-600">{solution.purpose}</p>}
        {solution.env_file === false && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No <code>.env</code> file detected in <code>poc/</code>. Copy <code>.env.example</code> to{" "}
            <code>.env</code> and configure provider credentials before running.
          </p>
        )}
      </header>

      <form onSubmit={handleRun} className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Inputs</h2>
          {solution.inputs && solution.inputs.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {solution.inputs.map((group) => (
                <li
                  key={`${group.kind}-${group.label}`}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                >
                  <span className="font-medium">{group.label}</span>
                  {group.extensions.length > 0 && (
                    <span className="ml-1.5 font-mono text-[11px] text-slate-500">
                      {group.extensions.join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-slate-700">Upload input file(s)</span>
          <input
            type="file"
            multiple
            accept={accept || undefined}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>

        {files.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
            {files.map((f) => (
              <li key={f.name} className="flex items-center justify-between px-3 py-1.5">
                <span className="truncate font-medium text-slate-800">{f.name}</span>
                <span className="text-slate-500">{Math.max(1, Math.round(f.size / 1024))} KB</span>
              </li>
            ))}
          </ul>
        )}

        {solution.asks_question && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700">{solution.question_label || "Question"}</span>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Ask a question about the uploaded documents..."
            />
          </label>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={running}
            className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:opacity-60"
          >
            {running ? `Running (${elapsed}s)...` : "Run pipeline"}
          </button>
          {files.length === 0 && solution.sample_files && solution.sample_files.length > 0 && (
            <span className="text-xs text-slate-500">
              No files picked: will run with bundled sample_input ({solution.sample_files.join(", ")}).
            </span>
          )}
        </div>
      </form>

      {result && (
        <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              {result.ok ? "Run succeeded" : "Run failed"}
            </h2>
            {typeof result.duration_seconds === "number" && (
              <span className="text-xs text-slate-500">{result.duration_seconds}s</span>
            )}
          </div>

          {!result.ok && result.error?.message && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {result.error.message}
            </p>
          )}

          {result.result !== undefined && result.result !== null && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Structured result</h3>
              <pre className="mt-1.5 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
                {JSON.stringify(result.result, null, 2)}
              </pre>
            </div>
          )}

          {result.outputs && result.outputs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Output files</h3>
              <ul className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
                {result.outputs.map((out) => (
                  <li key={out.name} className="flex items-center justify-between px-3 py-2">
                    <span className="font-mono text-slate-800">{out.name}</span>
                    <a
                      href={proxyFileHref(result.run_id, out)}
                      download={out.name}
                      className="font-medium text-sky-700 hover:underline"
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.log_tail && (
            <details open={!result.ok}>
              <summary className="cursor-pointer text-xs font-medium text-slate-600">Technical log</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">
                {result.log_tail}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
"""


def _readme_md(descriptor: dict[str, Any]) -> str:
    name = descriptor.get("name") or "GAIK Solution"
    return f"""\
# {name} — Next.js Frontend Starter

Optional Next.js App Router frontend connected to the local Python PoC backend (`../poc/app.py`).

## Quick start (local)

1. Start the Python PoC backend in `../poc/`:
   ```bash
   cd ../poc
   pip install -r requirements.txt
   cp .env.example .env  # fill in your provider keys
   python app.py         # listens on http://127.0.0.1:8000
   ```

2. Start this Next.js frontend in a second terminal:
   ```bash
   cd ../frontend
   cp .env.example .env.local
   npm install
   npm run dev           # opens http://127.0.0.1:3001
   ```

## Architecture

- `app/api/solution/route.ts` -> proxies `GET /api/solution` (`poc/ui/solution.json`)
- `app/api/run/route.ts` -> forwards multipart uploads to `POST /api/run`
- `app/api/status/route.ts` -> polls `GET /api/status`
- `app/api/files/[runId]/[...path]/route.ts` -> downloads output artifacts from `GET /api/runs/<id>/files/<path>`
- `/api/source` is intentionally **not** proxied.
- Note: Node's default fetch timeout (~300s) may interrupt very long synchronous `POST /api/run` calls; convert to async jobs before production hosting.

## Customising with a coding agent

See [`AGENT_PROMPT.md`](./AGENT_PROMPT.md) for a ready-to-use brief tailored to this use case.

## Production note

`poc/app.py` is designed for local testing (loopback only, no authentication, single active run at a time).
Before hosting this UI for end users, add authentication, per-user run ownership, job queueing, and private artifact storage.
"""


def _agent_prompt_md(descriptor: dict[str, Any]) -> str:
    name = descriptor.get("name") or "GAIK Solution"
    purpose = descriptor.get("purpose") or "(see ../poc/README.md)"
    inputs = descriptor.get("inputs") or []
    outputs = descriptor.get("output_fields") or []
    steps = descriptor.get("steps") or []

    input_lines = (
        "\n".join(
            f"- **{i.get('label', i.get('kind', 'Input'))}** (`{i.get('kind', 'file')}`): "
            f"{', '.join(i.get('extensions') or ['any file'])}"
            for i in inputs
            if isinstance(i, dict)
        )
        or "- Inspect `../poc/ui/solution.json` and `../poc/run_poc.py` for expected inputs."
    )
    output_lines = (
        "\n".join(
            f"- `{f.get('key', '')}` ({f.get('type', 'string')}): {f.get('description') or f.get('label', '')}"
            for f in outputs
            if isinstance(f, dict) and f.get("key")
        )
        or "- Inspect `../poc/schemas/output_schema.py` or `../poc/README.md`."
    )
    step_lines = (
        "\n".join(
            f"{idx}. **{s.get('title', s.get('id', 'Step'))}** ({s.get('kind', 'step')}"
            + (f", `{s['component']}`" if s.get("component") else "")
            + ")"
            for idx, s in enumerate(steps, start=1)
            if isinstance(s, dict)
        )
        or "1. Inspect `../use_case.blueprint.json` and `../poc/run_poc.py`."
    )

    return f"""\
# Coding Agent Brief — Customise Frontend for "{name}"

Use this prompt with Claude Code, Codex, Cursor, or Antigravity to tailor the Next.js starter in `frontend/` to this specific GAIK use case.

## Use Case Summary

- **Solution:** {name}
- **Purpose:** {purpose}
- **Backend contract:** `../poc/app.py` (local HTTP server on `POC_API_URL`, default `http://127.0.0.1:8000`)

## Expected Inputs

{input_lines}

## Expected Output Fields

{output_lines}

## Pipeline Steps

{step_lines}

## Task for the Agent

1. Read `../poc/README.md`, `../poc/ui/solution.json`, and `../poc/run_poc.py` to understand exact input slot roles (including required vs optional files) and the real JSON/file outputs written to `output/`.
2. Customise `components/solution-runner.tsx` so that:
   - Each required input role has a clear upload slot with validation before running.
   - The structured result renders in a domain-appropriate layout (cards, editable review form, table, or report preview) instead of raw JSON.
   - Output artifacts (`outputs[]`), grounding checks (`source_trace`), and failure diagnostics (`ok: false`, `log_tail`) are presented cleanly.
3. Keep all calls to `poc/app.py` inside `app/api/*` Route Handlers; do **not** expose `/api/source` or API keys to browser code.
4. Verify with `npm run typecheck` and `npm run build`, and test one real end-to-end run against `python ../poc/app.py`.
"""


def frontend_files(poc_dir: str) -> dict[str, str]:
    """Return ``{zip_path: utf8_content}`` for the optional ``frontend/`` starter."""
    descriptor = _read_solution_descriptor(poc_dir)
    slug = str(descriptor.get("id") or "gaik-poc")
    return {
        "frontend/package.json": _package_json(slug),
        "frontend/tsconfig.json": _TSCONFIG_JSON,
        "frontend/next.config.ts": _NEXT_CONFIG_TS,
        "frontend/postcss.config.mjs": _POSTCSS_CONFIG,
        "frontend/.env.example": _ENV_EXAMPLE,
        "frontend/.gitignore": _GITIGNORE,
        "frontend/README.md": _readme_md(descriptor),
        "frontend/AGENT_PROMPT.md": _agent_prompt_md(descriptor),
        "frontend/lib/poc-backend.ts": _BACKEND_HELPER_TS,
        "frontend/app/globals.css": _GLOBALS_CSS,
        "frontend/app/layout.tsx": _LAYOUT_TSX,
        "frontend/app/page.tsx": _PAGE_TSX,
        "frontend/app/api/solution/route.ts": _API_SOLUTION_ROUTE,
        "frontend/app/api/status/route.ts": _API_STATUS_ROUTE,
        "frontend/app/api/run/route.ts": _API_RUN_ROUTE,
        "frontend/app/api/files/[runId]/[...path]/route.ts": _API_FILE_ROUTE,
        "frontend/components/solution-runner.tsx": _SOLUTION_RUNNER_TSX,
    }
