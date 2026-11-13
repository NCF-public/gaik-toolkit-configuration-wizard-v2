"""Walk a set of use cases through a running Solution Wizard v2 API and check the result.

    python run_usecases.py                      # every case in usecases.json, one after another
    python run_usecases.py --only policy-rag    # one case (comma-separated ids)
    python run_usecases.py --stop-at-gate 1     # quick pass: stop once Gate 1 is approved
    python run_usecases.py --run                # also start the PoC test run (needs the sandbox)
    python run_usecases.py --pace quick         # start as the web app's Quick choice does
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
import http.client
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
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
# The line the web app's pace choice puts ahead of the user's first message.
PACE = {
    "quick": {
        "fi": "Tahti: nopea. Kysy vain se, mitä et voi kohtuudella olettaa, mieluiten yhdellä "
        "kierroksella; ehdota muuhun oletukset ja listaa ne oletuksina.",
        "en": "Pace: quick. Ask only what you cannot reasonably assume, in one round if you can; "
        "propose defaults for the rest and list them as assumptions.",
    },
    "thorough": {
        "fi": "Tahti: perusteellinen. Kysy se, mitä tarvitset yksityiskohtien saamiseksi oikein.",
        "en": "Pace: thorough. Ask what you need to get the details right.",
    },
}
LIST_ITEM = re.compile(r"^\s{0,3}(?:[-*+]|\d{1,2}[.)])\s+(.*)$")
FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})")
NOT_ASKING = (
    re.compile(r"(`+).*?\1(?!`)"),  # inline code
    re.compile(r"\]\([^)]*\)"),  # a link's address
    re.compile(r"(?:https?://|www\.)[^\s<>]*[^\s<>?.,!;:'\")\]]", re.I),  # a bare address
)
LOST_STREAM = (OSError, http.client.HTTPException)
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
        # A read is safe to repeat, and a port-forward drops a connection now and then.
        tries = 4 if method == "GET" and not stream else 1
        lost = ""
        for attempt in range(tries):
            if attempt:
                time.sleep(3 * attempt)
            try:
                # A chat reply or a run streams for many minutes; any other call answers at once.
                response = urllib.request.urlopen(request, timeout=3600 if stream else 120)
                if stream:
                    if response.status == 204:
                        return {"_error": 204, "_body": "nothing running"}
                    return response
                text = response.read().decode()
                return json.loads(text) if text else {}
            except urllib.error.HTTPError as err:
                return {"_error": err.code, "_body": err.read().decode(errors="replace")[:600]}
            except LOST_STREAM as err:
                lost = str(err)[:300]
        return {"_error": 0, "_body": lost}


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


def questions_in(markdown: str) -> list[str]:
    """The questions a reply asks, by the rule the web app's answer form uses.

    A question is a list item (bulleted or numbered, with its wrapped lines) that has a
    "?" outside inline code and web addresses; nothing in a fenced code block counts.
    A reply with no such item still asks one question when its last line ends in "?".
    """
    items: list[str] = []
    prose: list[str] = []
    current: str | None = None
    fence = ""
    for line in markdown.splitlines():
        mark = FENCE.match(line)
        if fence:
            if mark and mark[2][0] == fence[0] and len(mark[2]) >= len(fence):
                fence = ""
            continue
        if mark:
            if len(mark[1]) < 2 and current is not None:
                items.append(current)
                current = None
            fence = mark[2]
            continue
        item = LIST_ITEM.match(line)
        if item:
            if current is not None:
                items.append(current)
            current = item[1]
        elif current is not None and re.match(r"\s{2,}\S", line):
            current += " " + line.strip()
        else:
            if current is not None:
                items.append(current)
                current = None
            if line.strip():
                prose.append(line.strip())
    if current is not None:
        items.append(current)

    def asks(text: str) -> bool:
        for pattern in NOT_ASKING:
            text = pattern.sub(" ", text)
        return "?" in text

    asked = [item for item in items if asks(item)]
    if not asked and prose and prose[-1].rstrip("*_ ").endswith("?") and asks(prose[-1]):
        asked = [prose[-1]]
    return asked


def content_digest(detail: dict) -> str:
    """What the gates approve, hashed over the parts the API itself compares."""
    parts = ("id", "type", "component", "parameters", "depends_on")
    steps = [{k: st.get(k) for k in parts} for st in detail.get("blueprint", {}).get("steps") or []]
    approved = {"steps": steps, "output": detail.get("target_output_spec")}
    return hashlib.sha256(
        json.dumps(approved, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


class Walk:
    def __init__(self, api: Api, case: dict, out: Path, opts: argparse.Namespace) -> None:
        self.api, self.case, self.opts = api, case, opts
        self.id = case["id"]
        self.locale = case.get("locale", "fi")
        self.pace = opts.pace or case.get("pace") or ""
        self.rounds = self.questions = 0
        self.unread_reply: str | None = None  # a reply not yet looked at for questions
        self.gate1_approved = False
        self.todo = set(case.get("scenarios", []))
        self.checks: list[dict] = []
        self.stream_errors: list[dict] = []
        self.last_kinds: set[str] = set()
        self.sid = ""
        self.replies = 0
        self.refused = ""
        self.package_version = None
        self.version_before_reopen = None
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
        body = {"message": message, "locale": self.locale}
        response = None
        for _ in range(30):
            response = self.api.call("POST", f"/sessions/{self.sid}/chat", body, stream=True)
            # The API lets one user have a few sessions working at a time (429), and a
            # turn runs on after its stream closes (409 until it ends): wait, do not give up.
            if isinstance(response, dict) and response.get("_error") in (409, 429):
                self.refused = f"{response['_error']}: " + response["_body"][:200]
                time.sleep(20)
                continue
            break
        if isinstance(response, dict):
            self.refused = f"{response.get('_error')}: {response.get('_body', '')[:200]}"
            self.note(f"! chat refused: {self.refused}")
            self.last_kinds = set()
            return ""
        try:
            reply, tools, problems, kinds = read_reply(response)
        except LOST_STREAM as err:
            # The turn runs on in the API: read its reply from the start, as a reload does.
            self.note(f"! the reply's stream was lost ({err}); joining it again")
            reply, tools, problems, kinds = self.rejoin()
        self.replies += 1
        self.unread_reply = reply
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

    def rejoin(self) -> tuple[str, int, list[dict], set[str]]:
        for _ in range(5):
            time.sleep(3)
            joined = self.api.call("GET", f"/sessions/{self.sid}/chat/stream", stream=True)
            if isinstance(joined, dict):
                if joined.get("_error") == 0:
                    continue
                break  # 204: the reply has ended, and its text is not in the log
            try:
                return read_reply(joined)
            except LOST_STREAM:
                continue
        while (self.detail() or {}).get("pending_turn"):
            time.sleep(10)
        return "", 0, [], set()

    def count_questions(self, step: int) -> None:
        """Count the last reply's questions if it came before the specification (step 4)."""
        reply, self.unread_reply = self.unread_reply, None
        if reply is None or self.gate1_approved or step >= 4:
            return
        asked = questions_in(reply)
        if asked:
            self.rounds += 1
            self.questions += len(asked)
            self.log(f"QUESTIONS round {self.rounds}: {len(asked)}")

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
        pending = None
        # The turn is registered only once the agent has started, which on a session's
        # first message is its setup query: give it a minute.
        for _ in range(120):  # until the API says a reply is under way
            pending = (self.detail() or {}).get("pending_turn")
            if pending or not sender.is_alive():
                break
            time.sleep(0.5)
        if not pending:
            sender.join()
            self.check("reload_mid_reply", "skip", "no reply was under way to reload into")
            return
        second = self.api.call(
            "POST",
            f"/sessions/{self.sid}/chat",
            {"message": "hei", "locale": self.locale},
            stream=True,
        )
        refused = isinstance(second, dict) and second.get("_error") == 409
        if not isinstance(second, dict):
            # Accepted after all (the first reply had just ended): it is a turn of its
            # own now, which runs on even if its stream is closed. Read it to its end so
            # the walk does not run into it, and keep it in the log.
            probe_reply, _, probe_problems, _ = read_reply(second)
            self.stream_errors += probe_problems
            self.log("USER: hei")
            self.log("WIZARD (probe accepted):")
            self.log(probe_reply)
        joined = self.api.call("GET", f"/sessions/{self.sid}/chat/stream", stream=True)
        if isinstance(joined, dict):
            sender.join(timeout=15)
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
            reply, _, _, _ = read_reply(joined)
            sender.join()
            same = reply.strip() == (result.get("reply") or "").strip()
            self.check(
                "reload_mid_reply",
                "pass" if reply.strip() and refused else "fail",
                f"joined reply {len(reply)} chars, same text as the first reader: {same}; "
                f"a second message while replying was {'refused (409)' if refused else 'NOT refused'}",
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
        before_package = self.package_version_now()
        self.say(text)
        after = self.detail()
        after_package = self.package_version_now()
        reopened = [
            n
            for n in (1, 2, 3, 4)
            if before["gate_statuses"].get(f"gate_{n}") == "approved"
            and after["gate_statuses"].get(f"gate_{n}") != "approved"
        ]
        if reopened:
            self.version_before_reopen = self.package_version
            by = json.dumps((after.get("metadata") or {}).get("gate_reopened"), ensure_ascii=False)
            self.check(name, "pass", f"gates {reopened} reopened, step {after.get('step')}, {by}")
        elif (content_digest(before), before_package) != (content_digest(after), after_package):
            self.check(name, "fail", "approved content changed and no gate was reopened")
        else:
            self.check(name, "fail", "the wizard neither changed the solution nor reopened a gate")

    def package_version_now(self):
        """The package version the API reports (code, settings, schema), or None.

        What a gate approves is the solution and the package; the blueprint alone
        misses a change made only in the package.
        """
        files = self.api.call("GET", f"/sessions/{self.sid}/poc/files")
        return files.get("version") if files.get("generated") else None

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
        problems = files.get("problems") or []
        if files.get("ready") is False or problems:
            self.record("package", "fail", f"{len(names)} files, not complete: {problems}")
            return False
        self.package = names
        self.package_version = files.get("version")
        self.record("package", "pass", f"{len(names)} files, version {self.package_version}")
        if self.version_before_reopen is not None:
            # A change that reopened a gate has to end in a new package.
            fresh = self.package_version != self.version_before_reopen
            self.record(
                "package_after_change",
                "pass" if fresh else "fail",
                "" if fresh else "the package is the one from before the change",
            )
        return True

    def run_poc(self) -> None:
        names = self.case.get("inputs", [])
        accepted, refused = [], []
        for name in names:
            path = (Path(self.opts.cases).resolve().parent / name).resolve()
            if not path.is_file():
                refused.append(f"{name}: no such file")
                continue
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
            if "_error" in sent:
                refused.append(f"{path.name}: {sent['_error']} {sent['_body'][:160]}")
            else:
                accepted.append(path.name)
        if names:
            # The API takes only the file types the session's blueprint names as input.
            self.record(
                "sample_input",
                "pass" if accepted else "fail",
                f"uploaded {accepted or 'nothing'}"
                + (f"; not taken: {refused}" if refused else ""),
            )
        started = self.api.call("POST", f"/sessions/{self.sid}/runs")
        for _ in range(30):
            # The sandbox takes a few runs at a time (429 sandbox_busy): wait, as for chat.
            if started.get("_error") != 429:
                break
            self.note(f"sandbox busy, waiting: {started['_body'][:200]}")
            time.sleep(20)
            started = self.api.call("POST", f"/sessions/{self.sid}/runs")
        if started.get("_error") == 503:
            self.record("poc_run", "skip", "no sandbox behind this API")
            return
        if "_error" in started:
            self.record("poc_run", "fail", str(started)[:300])
            return
        run_id = started["run_id"]
        # Follow the run the way the PoC tab does: the API records a successful run
        # (which Gate 3 asks for) and saves its log for the agent as this stream ends.
        stream = self.api.call("GET", f"/sessions/{self.sid}/runs/{run_id}/stream", stream=True)
        if not isinstance(stream, dict):
            for _ in stream:
                pass
        status = self.api.call("GET", f"/sessions/{self.sid}/runs/{run_id}")
        deadline = time.time() + 20 * 60
        while not status.get("finished") and "_error" not in status and time.time() < deadline:
            time.sleep(10)
            status = self.api.call("GET", f"/sessions/{self.sid}/runs/{run_id}")
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
        first = c["description"]
        if self.pace:
            first = f"{PACE[self.pace][self.locale]}\n{first}"
        if "reload_mid_reply" in self.todo:
            self.todo.discard("reload_mid_reply")
            self.say_with_reload(first)
        else:
            self.say(first)
        idle = refusals = 0
        seen = None
        for _ in range(80):
            d = self.detail()
            self.note("STATE " + self.state_line(d))
            step = d["step"]
            self.count_questions(step)
            gate = GATE_AT.get(step)
            if (step, content_digest(d)) != seen:  # it moved: not idle
                seen, idle = (step, content_digest(d)), 0
            if gate and d["gate_statuses"].get(f"gate_{gate}") != "approved":
                approval = {"gate_statuses": {f"gate_{gate}": "approved"}}
                res = self.api.call("PATCH", f"/sessions/{self.sid}", approval)
                if "_error" in res:
                    self.note(f"Gate {gate} not approvable yet: {res['_body'][:300]}")
                    refusals += 1
                    if refusals > 6:
                        self.note("gave up: the gate stays refused")
                        return
                    self.say(GO_ON[self.locale])
                    continue
                self.note(f"GATE {gate} approved")
                self.gate1_approved = True
                idle = refusals = 0
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
        if self.opts.stop_at_gate == 1:
            components = []  # still the placeholder: the components are chosen after Gate 1
        stop = self.opts.stop_at_gate
        wanted = range(1, (stop or 4) + 1)
        reached = bool(final) and all(gates.get(f"gate_{n}") == "approved" for n in wanted)
        self.check(
            "reaches_the_end" if not stop else f"reaches_gate_{stop}",
            "pass" if reached else "fail",
            f"step {final.get('step')}, gates {gates}"
            + (f"; last refusal: {self.refused}" if self.refused and not reached else ""),
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
        asked = (
            f"{self.rounds} question rounds, {self.questions} questions before the specification"
        )
        if self.pace == "quick":
            self.check("quick_pace_one_round", "pass" if self.rounds <= 1 else "fail", asked)
        else:
            self.check("question_rounds", "info", asked)
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
            if not self.replies:
                self.check("end_session", "skip", "the wizard never replied in this walk")
            elif ended.get("_error") in (404, 405):
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
            "pace": self.pace or None,
            "question_rounds": self.rounds,
            "questions": self.questions,
            "components": components,
            "package_files": len(getattr(self, "package", [])),
            "checks": self.checks,
        }


def write_summary(out: Path, results: list[dict], args: argparse.Namespace) -> None:
    mark = {"pass": "ok", "fail": "FAIL", "skip": "skip", "info": "info"}
    lines = [
        "# Wizard use case run",
        "",
        f"{datetime.now():%Y-%m-%d %H:%M} · API `{args.base}` · PoC run {'on' if args.run else 'off'}"
        + (f" · pace {args.pace}" if args.pace else "")
        + (f" · stopped at Gate {args.stop_at_gate}" if args.stop_at_gate else ""),
        "",
        "| Case | Result | Step | Min | Question rounds | Questions | Components | Package files |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        counts = {k: sum(1 for c in r["checks"] if c["result"] == k) for k in mark}
        verdict = f"{counts['fail']} failed" if counts["fail"] else "all passed"
        verdict += f" ({counts['pass']} ok, {counts['skip']} skipped)"
        lines.append(
            f"| {r['id']} | {verdict} | {r['step']} | {r['minutes']} | {r['question_rounds']} | {r['questions']} | {', '.join(r['components']) or '-'} | {r['package_files']} |"
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
        "--pace",
        choices=["quick", "thorough"],
        help="start each case with the web app's pace line (default: the case's 'pace', or none)",
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
                f"{c['id']:24} {c.get('locale', 'fi')}  {', '.join(c.get('scenarios', [])) or '-'}"
                f"  ·  {len(c.get('inputs', []))} inputs  ·  {c['title']}"
            )
        return 0

    out = (
        Path(args.out)
        if args.out
        else Path(tempfile.gettempdir()) / "wizard-usecase-runs" / f"{datetime.now():%Y%m%d-%H%M%S}"
    )
    out.mkdir(parents=True, exist_ok=True)
    token = os.environ.get(args.token_env, "").strip() or None
    parsed = urllib.parse.urlsplit(args.base)
    if (
        token
        and parsed.scheme != "https"
        and parsed.hostname not in ("localhost", "127.0.0.1", "::1")
    ):
        print(
            f"Not sending the service token to {args.base}: "
            "use https, or a port-forward to localhost."
        )
        return 2
    api = Api(args.base, args.user, token)
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
