"""Walk a set of use cases through a running Solution Wizard v2 API and check the result.

    python run_usecases.py                      # every case in usecases.json, one after another
    python run_usecases.py --only policy-rag    # one case (comma-separated ids)
    python run_usecases.py --stop-at-gate 1     # quick pass: stop once Gate 1 is approved
    python run_usecases.py --run                # also start the PoC test run (needs the sandbox)
    python run_usecases.py --list

Each case plays the user: it describes the use case, answers anything else with
"make sensible assumptions and go on", approves each gate, and at set points
does what a tester would try by hand (reload during a reply, reopen a gate,
ask for a change after approval, write in another language, end the session).
It talks to wizard_api only; the web app is not involved.

Standard library only. Needs a running wizard_api (see WIZARD-DEV.md).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
GATE_AT = {4: 1, 9: 2, 11: 3, 13: 4}
GO_ON = {
    "fi": "Hyvä. Tee järkevät oletukset avoimiin kohtiin, kirjaa ne ja jatka seuraavaan vaiheeseen ilman lisäkysymyksiä.",
    "en": "Good. Make sensible assumptions for anything open, record them, and go on to the next step without further questions.",
}
WAKE = {
    "fi": "Gate {n} hyväksytty paneelista, jatka.",
    "en": "Gate {n} approved in the panel, continue.",
}
OTHER_LANGUAGE = {
    "fi": "From now on, could you answer me in English?",
    "en": "Voisitko vastata tästä eteenpäin suomeksi?",
}
QUIET_FRAMES = {"delta", "narration_end", "activity", "heartbeat", "done"}
PRINT_LOCK = threading.Lock()


class Api:
    def __init__(self, base: str, user: str, token: str | None) -> None:
        self.base = base.rstrip("/")
        self.user = user
        self.token = token

    def call(
        self,
        method: str,
        path: str,
        body=None,
        stream: bool = False,
        raw: tuple[bytes, str] | None = None,
    ):
        """JSON in, JSON out. An HTTP error comes back as {"_error": code, "_body": text}."""
        headers = {"X-Wizard-User-Id": self.user}
        if self.token:
            headers["X-Wizard-Service-Token"] = self.token
        data = None
        if raw is not None:
            data, headers["Content-Type"] = raw
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base + path, data=data, method=method, headers=headers
        )
        try:
            response = urllib.request.urlopen(request, timeout=3600)
        except urllib.error.HTTPError as err:
            return {"_error": err.code, "_body": err.read().decode(errors="replace")[:600]}
        except (urllib.error.URLError, OSError) as err:
            return {"_error": 0, "_body": str(err)[:300]}
        if stream:
            if response.status == 204:
                return {"_error": 204, "_body": "nothing running"}
            return response
        text = response.read().decode()
        return json.loads(text) if text else {}


def read_reply(response) -> tuple[str, int, list[dict], set[str]]:
    """Read one chat stream to its end: the reply, tool calls, error frames, frame kinds seen."""
    text: list[str] = []
    tools, problems, kinds = 0, [], set()
    for raw in response:
        line = raw.decode(errors="replace").strip()
        if not line.startswith("data: "):
            continue
        try:
            event = json.loads(line[6:])
        except json.JSONDecodeError:
            continue
        kinds.update(event.keys())
        if "delta" in event:
            text.append(event["delta"])
        elif event.get("narration_end"):
            text.clear()
        elif "activity" in event:
            tools += 1
        elif event.get("error"):
            problems.append(event)
    return "".join(text), tools, problems, kinds


def content_digest(detail: dict) -> str:
    """What the gates approve: the steps and the output definition."""
    approved = {
        "steps": detail.get("blueprint", {}).get("steps"),
        "output": detail.get("target_output_spec"),
    }
    return hashlib.sha256(
        json.dumps(approved, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


class Walk:
    def __init__(self, api: Api, case: dict, out: Path, opts: argparse.Namespace) -> None:
        self.api, self.case, self.opts = api, case, opts
        self.id = case["id"]
        self.locale = case.get("locale", "fi")
        self.todo = set(case.get("scenarios", []))
        self.checks: list[dict] = []
        self.stream_errors: list[dict] = []
        self.last_kinds: set[str] = set()
        self.sid = ""
        self.out = out
        self.log_file = (out / f"{self.id}.log").open("w", encoding="utf-8")
        self.started = time.time()

    # -- output ---------------------------------------------------------
    def log(self, *parts) -> None:
        self.log_file.write(" ".join(str(p) for p in parts) + "\n")
        self.log_file.flush()

    def note(self, text: str) -> None:
        self.log(text)
        with PRINT_LOCK:
            print(f"{datetime.now():%H:%M:%S} [{self.id}] {text}", flush=True)

    def check(self, name: str, result: str, detail: str = "") -> None:
        self.checks.append({"name": name, "result": result, "detail": detail})
        self.note(f"CHECK {name}: {result}{' · ' + detail if detail else ''}")

    # -- the wizard ------------------------------------------------------
    def detail(self) -> dict:
        return self.api.call("GET", f"/sessions/{self.sid}")

    def say(self, message: str) -> str:
        started = time.time()
        response = self.api.call(
            "POST",
            f"/sessions/{self.sid}/chat",
            {"message": message, "locale": self.locale},
            stream=True,
        )
        if isinstance(response, dict):
            self.note(f"! chat refused: {response}")
            self.last_kinds = set()
            return ""
        reply, tools, problems, kinds = read_reply(response)
        self.last_kinds = kinds
        self.stream_errors += problems
        self.log(f"USER: {message}")
        self.log(
            f"WIZARD ({time.time() - started:.0f} s, {tools} tool calls, frames {sorted(kinds - QUIET_FRAMES)}):"
        )
        self.log(reply)
        for problem in problems:
            self.note(f"! stream error: {json.dumps(problem, ensure_ascii=False)[:300]}")
        return reply

    def state_line(self, d: dict) -> str:
        steps = d.get("blueprint", {}).get("steps") or []
        return json.dumps(
            {
                "step": d.get("step"),
                "gates": "".join(
                    str(d["gate_statuses"].get(f"gate_{n}", "?"))[0] for n in (1, 2, 3, 4)
                ),
                "status": d.get("status"),
                "steps": [
                    f"{s.get('name')} [{s.get('type')}{':' + s['component'] if s.get('component') else ''}]"
                    for s in steps
                ],
                "reopened": (d.get("metadata") or {}).get("gate_reopened"),
            },
            ensure_ascii=False,
        )

    # -- what a tester tries by hand --------------------------------------
    def say_with_reload(self, message: str) -> None:
        """Send a message, then act like a page reload: the reply must still be reachable."""
        result: dict = {}
        sender = threading.Thread(target=lambda: result.update(reply=self.say(message)))
        sender.start()
        time.sleep(2)
        pending = (self.detail() or {}).get("pending_turn")
        second = self.api.call(
            "POST", f"/sessions/{self.sid}/chat", {"message": "hei", "locale": self.locale}
        )
        joined = self.api.call("GET", f"/sessions/{self.sid}/chat/stream", stream=True)
        if isinstance(joined, dict):
            code = joined.get("_error")
            if code in (404, 405):
                self.check("reload_mid_reply", "skip", "this API has no /chat/stream")
            elif code == 204 and not sender.is_alive():
                self.check("reload_mid_reply", "skip", "the reply had ended before the reload")
            else:
                self.check(
                    "reload_mid_reply", "fail", f"could not join the running reply: {joined}"
                )
        else:
            reply, _, _, kinds = read_reply(joined)
            sender.join()
            same = reply.strip() == (result.get("reply") or "").strip()
            refused = isinstance(second, dict) and second.get("_error") == 409
            ok = bool(reply.strip()) and refused
            self.check(
                "reload_mid_reply",
                "pass" if ok else "fail",
                f"joined reply {len(reply)} chars, same text as the first reader: {same}; "
                f"second message while replying -> {second.get('_error') if isinstance(second, dict) else 200}; "
                f"pending_turn seen: {bool(pending)}",
            )
        sender.join()

    def language_offer(self) -> None:
        self.say(OTHER_LANGUAGE[self.locale])
        offered = "offer_locale" in self.last_kinds
        self.check(
            "language_offer",
            "pass" if offered else "fail",
            "" if offered else "no offer_locale frame in the reply",
        )

    def reopen_in_panel(self) -> None:
        res = self.api.call("POST", f"/sessions/{self.sid}/gates/1/reopen")
        if res.get("_error") in (404, 405):
            self.check("reopen_in_panel", "skip", "this API has no gate reopening")
            return
        if "_error" in res:
            self.check("reopen_in_panel", "fail", str(res)[:300])
            return
        pending = all(res["gate_statuses"].get(f"gate_{n}") != "approved" for n in (1, 2, 3, 4))
        ok = pending and res.get("step") == 4
        self.check(
            "reopen_in_panel",
            "pass" if ok else "fail",
            f"step {res.get('step')}, gates {res['gate_statuses']}",
        )

    def change(self, name: str) -> None:
        text = self.case.get("change")
        if not text:
            self.check(name, "skip", "the case has no 'change' text")
            return
        before = self.detail()
        self.say(text)
        after = self.detail()
        reopened = [
            n
            for n in (1, 2, 3, 4)
            if before["gate_statuses"].get(f"gate_{n}") == "approved"
            and after["gate_statuses"].get(f"gate_{n}") != "approved"
        ]
        if reopened:
            by = (after.get("metadata") or {}).get("gate_reopened")
            self.check(
                name,
                "pass",
                f"gates {reopened} reopened, step {after.get('step')}, {json.dumps(by, ensure_ascii=False)}",
            )
        elif content_digest(before) != content_digest(after):
            self.check(name, "fail", "approved content changed and no gate was reopened")
        else:
            self.check(
                name, "skip", "the wizard changed nothing in the steps or the output definition"
            )

    def after_gate(self, gate: int) -> None:
        if gate == 1 and "language_offer" in self.todo:
            self.todo.discard("language_offer")
            self.language_offer()
        elif gate == 2 and "reopen_in_panel" in self.todo:
            self.todo.discard("reopen_in_panel")
            self.reopen_in_panel()
        elif gate == 2 and "change_in_chat" in self.todo:
            self.todo.discard("change_in_chat")
            self.change("change_in_chat")
        elif gate == 3 and "change_after_gate3" in self.todo:
            self.todo.discard("change_after_gate3")
            self.change("change_after_gate3")

    # -- the package and its run ------------------------------------------
    def record(self, name: str, result: str, detail: str = "") -> None:
        """A check a reopened gate can reach twice: the latest result stands."""
        self.checks = [c for c in self.checks if c["name"] != name]
        self.check(name, result, detail)

    def package_ready(self) -> bool:
        files = self.api.call("GET", f"/sessions/{self.sid}/poc/files")
        names = [
            (f.get("path") or f.get("name") or str(f)) if isinstance(f, dict) else str(f)
            for f in files.get("files", [])
        ]
        if not files.get("generated") or not names:
            return False
        self.package = names
        self.record("package", "pass", f"{len(names)} files")
        return True

    def run_poc(self) -> None:
        for name in self.case.get("inputs", []):
            path = (HERE / name).resolve()
            boundary = uuid.uuid4().hex
            body = (
                (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
                    "Content-Type: application/octet-stream\r\n\r\n"
                ).encode()
                + path.read_bytes()
                + f"\r\n--{boundary}--\r\n".encode()
            )
            sent = self.api.call(
                "POST",
                f"/sessions/{self.sid}/poc/input",
                raw=(body, f"multipart/form-data; boundary={boundary}"),
            )
            self.log(f"input {path.name}: {sent}")
        started = self.api.call("POST", f"/sessions/{self.sid}/runs")
        if started.get("_error") == 503:
            self.record("poc_run", "skip", "no sandbox behind this API")
            return
        if "_error" in started:
            self.record("poc_run", "fail", str(started)[:300])
            return
        run_id, status = started["run_id"], {}
        deadline = time.time() + 20 * 60
        while time.time() < deadline:
            status = self.api.call("GET", f"/sessions/{self.sid}/runs/{run_id}")
            if status.get("finished") or "_error" in status:
                break
            time.sleep(10)
        ok = bool(status.get("finished")) and status.get("exit_code") == 0
        self.record(
            "poc_run", "pass" if ok else "fail", json.dumps(status, ensure_ascii=False)[:300]
        )

    # -- one use case from start to finish ---------------------------------
    def walk(self) -> dict:
        try:
            self._walk()
        except Exception as err:  # one broken case must not stop the set
            self.check("walk", "fail", f"{type(err).__name__}: {err}")
        return self.finish()

    def _walk(self) -> None:
        c = self.case
        created = self.api.call(
            "POST", "/sessions", {"user_id": self.api.user, "title": c["title"]}
        )
        if "_error" in created:
            raise RuntimeError(f"could not create a session: {created}")
        self.sid = created["id"]
        self.note(f"SESSION {self.sid} · {c['title']}")
        if "reload_mid_reply" in self.todo:
            self.todo.discard("reload_mid_reply")
            self.say_with_reload(c["description"])
        else:
            self.say(c["description"])
        idle = 0
        for _ in range(60):
            d = self.detail()
            self.note("STATE " + self.state_line(d))
            step = d["step"]
            gate = GATE_AT.get(step)
            if gate and d["gate_statuses"].get(f"gate_{gate}") != "approved":
                res = self.api.call(
                    "PATCH",
                    f"/sessions/{self.sid}",
                    {"gate_statuses": {f"gate_{gate}": "approved"}},
                )
                if "_error" in res:
                    self.note(f"Gate {gate} not approvable yet: {res['_body'][:300]}")
                    idle += 1
                    if idle > 5:
                        break
                    self.say(GO_ON[self.locale])
                    continue
                self.note(f"GATE {gate} approved")
                idle = 0
                if gate < 4:
                    self.api.call("PATCH", f"/sessions/{self.sid}", {"step": step + 1})
                else:
                    self.api.call(
                        "PATCH", f"/sessions/{self.sid}", {"metadata": {"status": "done"}}
                    )
                if gate == self.opts.stop_at_gate:
                    return
                self.say(WAKE[self.locale].format(n=gate))
                if gate == 4:
                    return
                self.after_gate(gate)
                continue
            if step == 10 and self.package_ready():
                # The PoC step: the package is built here, the test run belongs
                # here, and the page's "Next step" takes the session on to Gate 3.
                if self.opts.run:
                    self.run_poc()
                self.api.call("PATCH", f"/sessions/{self.sid}", {"step": 11})
                continue
            if step == 12:
                # The page's "Next step" from the documentation phase onto Gate 4.
                self.api.call("PATCH", f"/sessions/{self.sid}", {"step": 13})
                continue
            idle += 1
            if idle > 10:
                self.note("gave up: the session does not move on")
                return
            self.say(GO_ON[self.locale])

    def finish(self) -> dict:
        final = self.detail() if self.sid else {}
        gates = final.get("gate_statuses", {})
        steps = final.get("blueprint", {}).get("steps") or []
        components = sorted({s["component"] for s in steps if s.get("component")})
        stop = self.opts.stop_at_gate
        wanted = range(1, (stop or 4) + 1)
        reached = bool(final) and all(gates.get(f"gate_{n}") == "approved" for n in wanted)
        self.check(
            "reaches_the_end" if not stop else f"reaches_gate_{stop}",
            "pass" if reached else "fail",
            f"step {final.get('step')}, gates {gates}",
        )
        pattern = (self.case.get("expect") or {}).get("component")
        if pattern and stop == 1:
            self.check("expected_component", "skip", "the components are chosen after Gate 1")
        elif pattern:
            hit = [name for name in components if re.search(pattern, name, re.I)]
            self.check(
                "expected_component",
                "pass" if hit else "fail",
                f"{hit or components} (wanted /{pattern}/)"
                if steps
                else "the blueprint has no steps",
            )
        self.check(
            "no_stream_errors",
            "fail" if self.stream_errors else "pass",
            f"{len(self.stream_errors)} error frames",
        )
        if (not stop or stop >= 3) and not any(c["name"] == "package" for c in self.checks):
            self.check("package", "fail", "no PoC package was generated")
        for left in sorted(self.todo - {"end_session"}):
            self.check(left, "skip", "the walk ended before this point")
        if "end_session" in self.case.get("scenarios", []) and self.sid:
            ended = self.api.call("POST", f"/sessions/{self.sid}/agent/end")
            if ended.get("_error") in (404, 405):
                self.check("end_session", "skip", "this API has no /agent/end")
            else:
                live = (self.detail() or {}).get("agent_live")
                self.check(
                    "end_session",
                    "pass" if "_error" not in ended and not live else "fail",
                    f"agent_live {live}",
                )
        (self.out / f"{self.id}.json").write_text(
            json.dumps(
                {
                    k: final.get(k)
                    for k in (
                        "id",
                        "step",
                        "status",
                        "gate_statuses",
                        "blueprint",
                        "target_output_spec",
                        "metadata",
                    )
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self.log_file.close()
        return {
            "id": self.id,
            "title": self.case["title"],
            "session": self.sid,
            "step": final.get("step"),
            "minutes": round((time.time() - self.started) / 60, 1),
            "components": components,
            "package_files": len(getattr(self, "package", [])),
            "checks": self.checks,
        }


def write_summary(out: Path, results: list[dict], args: argparse.Namespace) -> None:
    mark = {"pass": "ok", "fail": "FAIL", "skip": "skip"}
    lines = [
        "# Wizard use case run",
        "",
        f"{datetime.now():%Y-%m-%d %H:%M} · API `{args.base}` · PoC run {'on' if args.run else 'off'}"
        + (f" · stopped at Gate {args.stop_at_gate}" if args.stop_at_gate else ""),
        "",
        "| Case | Result | Step | Min | Components | Package files |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        counts = {k: sum(1 for c in r["checks"] if c["result"] == k) for k in mark}
        verdict = f"{counts['fail']} failed" if counts["fail"] else "all passed"
        verdict += f" ({counts['pass']} ok, {counts['skip']} skipped)"
        lines.append(
            f"| {r['id']} | {verdict} | {r['step']} | {r['minutes']} | {', '.join(r['components']) or '-'} | {r['package_files']} |"
        )
    for r in results:
        lines += [
            "",
            f"## {r['id']}: {r['title']}",
            "",
            f"Session `{r['session']}` · log `{r['id']}.log` · final state `{r['id']}.json`",
            "",
        ]
        lines += [
            f"- **{mark[c['result']]}** {c['name']}" + (f": {c['detail']}" if c["detail"] else "")
            for c in r["checks"]
        ]
    (out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "summary.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", default=os.environ.get("WIZARD_API_URL", "http://localhost:8100"))
    parser.add_argument("--user", default=os.environ.get("WIZARD_USER_ID", "dev@gaik.local"))
    parser.add_argument(
        "--token-env",
        default="WIZARD_API_TOKEN",
        help="environment variable that holds the service token, if the API wants one",
    )
    parser.add_argument("--cases", default=str(HERE / "usecases.json"))
    parser.add_argument("--only", default="", help="comma-separated case ids")
    parser.add_argument("--parallel", type=int, default=1, help="sessions at a time")
    parser.add_argument(
        "--run",
        action="store_true",
        help="start the PoC test run before Gate 3 (needs the sandbox)",
    )
    parser.add_argument(
        "--stop-at-gate",
        type=int,
        default=0,
        choices=[0, 1, 2, 3],
        help="stop once this gate is approved",
    )
    parser.add_argument(
        "--out",
        default="",
        help="folder for logs and the summary (default: a new folder in the temp directory)",
    )
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    cases = json.loads(Path(args.cases).read_text(encoding="utf-8"))["cases"]
    if args.only:
        wanted = [x.strip() for x in args.only.split(",") if x.strip()]
        unknown = set(wanted) - {c["id"] for c in cases}
        if unknown:
            parser.error(f"unknown case ids: {sorted(unknown)}")
        cases = [c for c in cases if c["id"] in wanted]
    if args.list:
        for c in cases:
            print(
                f"{c['id']:24} {c.get('locale', 'fi')}  {', '.join(c.get('scenarios', [])) or '-'}  ·  {c['title']}"
            )
        return 0

    out = (
        Path(args.out)
        if args.out
        else Path(tempfile.gettempdir()) / "wizard-usecase-runs" / f"{datetime.now():%Y%m%d-%H%M%S}"
    )
    out.mkdir(parents=True, exist_ok=True)
    api = Api(args.base, args.user, os.environ.get(args.token_env, "").strip() or None)
    probe = api.call("GET", "/sessions/00000000-0000-0000-0000-000000000000")
    if probe.get("_error") == 0:
        print(f"No wizard_api at {args.base}: {probe['_body']}")
        return 2
    print(f"{len(cases)} use cases against {args.base}; results in {out}", flush=True)
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        results = list(pool.map(lambda c: Walk(api, c, out, args).walk(), cases))
    write_summary(out, results, args)
    failed = sum(1 for r in results for c in r["checks"] if c["result"] == "fail")
    print(f"Summary: {out / 'summary.md'} · {failed} failed checks")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
