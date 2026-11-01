"""What the wizard agent's tools may touch.

The agent runs with ``bypassPermissions``, which on its own lets every tool
reach anything the API container can. The agent only needs its own session and
the wizard's assets, so a PreToolUse hook decides every tool call before it runs:

* files are written only in the session's own directory, and read only there
  and in the wizard's own assets (SKILL.md, references, templates, scripts);
* Bash runs only the wizard's scripts, one plain command at a time: no shell
  operators, redirection or variables, so nothing else can be chained on;
* every other tool (web fetch and search, subagents, notebooks) is refused.

A refusal tells the agent what is allowed, so it can carry on within the rules.
The PoC itself runs in the sandbox Job, not here.
"""

from __future__ import annotations

import json
import os
import re
import shlex
from pathlib import Path
from typing import Any

from wizard_api.services import scaffold_guard

_READ_TOOLS = {"Read": "file_path", "Grep": "path", "Glob": "path", "LS": "path"}
_WRITE_TOOLS = {"Write": "file_path", "Edit": "file_path", "MultiEdit": "file_path"}
_HARMLESS_TOOLS = {"TodoWrite"}

#: Scripts the wizard's SKILL.md tells the agent to run. ``promote_template.py``
#: is left out on purpose: a promoted template is reused by every later session.
_SCRIPTS = frozenset(
    {
        "check_requirements.py",
        "generate_bpmn.py",
        "generate_docs.py",
        "generate_mermaid.py",
        "generate_schema.py",
        "run_wizard.py",
        "scaffold_poc.py",
        "validate_blueprint.py",
    }
)
#: Scripts that turn the blueprint into code, so they get its text checked first.
_SCAFFOLDING_SCRIPTS = frozenset({"scaffold_poc.py", "run_wizard.py"})
_PYTHON = frozenset({"python", "python3"})
#: The two one-liners SKILL.md uses: a syntax check and an import check.
_ONE_LINERS = (
    re.compile(r"^import ast; ast\.parse\(open\('([^']+)'\)\.read\(\)\)$"),
    re.compile(r"^import (gaik(?:\.[A-Za-z0-9_]+)*)$"),
)
#: A one-liner is accepted only as the whole command in one pair of double
#: quotes, with nothing the shell would expand inside (no $, backtick or
#: backslash) and nothing chained on after the closing quote.
_ONE_LINER_COMMAND = re.compile(r'^python3? -c "([^"\\$`]*)"$')
#: Arguments that name a file even without a slash (a bare name is relative to
#: the wizard's own directory, which the agent must not write into).
_FILE_NAME = re.compile(
    r"\.(md|json|py|mmd|bpmn|ya?ml|txt|csv|pdf|docx|html|toml|cfg|ini|sh)$", re.I
)
_SHELL_SYNTAX = re.compile(r"[;&|`$<>(){}\\\n\r*?\[\]~!#]")


def _deny(reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def _inside(path: str, roots: list[Path], cwd: Path) -> bool:
    target = Path(path) if os.path.isabs(path) else cwd / path
    real = Path(os.path.realpath(target))
    return any(real == root or root in real.parents for root in roots)


class ToolGuard:
    """Per-session rules; ``hook`` is registered as the agent's PreToolUse hook."""

    def __init__(self, wizard_dir: Path, output_dir: Path) -> None:
        self.cwd = Path(os.path.realpath(wizard_dir))
        self.output = Path(os.path.realpath(output_dir))
        self.readable = [self.output, self.cwd]
        self.writable = [self.output]

    async def hook(self, input_data: Any, tool_use_id: str | None, context: Any) -> dict[str, Any]:
        tool = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input") or {}
        reason = self.check(tool, tool_input if isinstance(tool_input, dict) else {})
        return _deny(reason) if reason else {}

    def check(self, tool: str, tool_input: dict[str, Any]) -> str | None:
        """Why the call is refused, or None when it may run."""
        if tool in _HARMLESS_TOOLS:
            return None
        if tool in _WRITE_TOOLS:
            path = tool_input.get(_WRITE_TOOLS[tool]) or ""
            if not path or not _inside(path, self.writable, self.cwd):
                return f"Files can be written only in the session directory {self.output}."
            return None
        if tool in _READ_TOOLS:
            paths = [tool_input.get(_READ_TOOLS[tool]) or str(self.cwd)]
            pattern = tool_input.get("pattern")
            if tool == "Glob" and isinstance(pattern, str):
                if ".." in Path(pattern).parts:
                    return "Glob patterns may not climb out of their directory with '..'."
                if os.path.isabs(pattern):
                    paths.append(pattern.split("*", 1)[0] or "/")
            if not all(_inside(p, self.readable, self.cwd) for p in paths):
                return (
                    f"Files can be read only in the session directory {self.output} "
                    "and in the wizard's own files."
                )
            return None
        if tool == "Bash":
            return self._check_bash(str(tool_input.get("command") or ""))
        return f"The {tool} tool is not available in the wizard."

    def _check_bash(self, command: str) -> str | None:
        allowed = (
            "Bash runs only the wizard's scripts, one plain command at a time, e.g. "
            "`python scripts/validate_blueprint.py --blueprint "
            "<session dir>/use_case.blueprint.json`. "
            "Use the Read, Write, Edit, Glob and Grep tools for files. The PoC runs in the sandbox "
            "from the wizard's Run button, not here."
        )
        whole = _ONE_LINER_COMMAND.match(command.strip())
        if whole:
            return self._check_one_liner(whole.group(1), allowed)
        if _SHELL_SYNTAX.search(command):
            return "No shell operators, redirection, variables or globs. " + allowed
        try:
            argv = shlex.split(command)
        except ValueError:
            return allowed
        if len(argv) < 2 or argv[0] not in _PYTHON:
            return allowed
        if argv[1] == "-c":
            return allowed
        script = argv[1]
        if (
            not _inside(script, [self.cwd / "scripts"], self.cwd)
            or Path(script).name not in _SCRIPTS
        ):
            return allowed
        for arg in argv[2:]:
            value = arg.split("=", 1)[1] if arg.startswith("--") and "=" in arg else arg
            # Scripts find the wizard's assets themselves; every path they are
            # given is the session's, which also keeps outputs out of SKILL.md.
            is_path = "/" in value or value.startswith(".") or _FILE_NAME.search(value)
            if is_path and not _inside(value, self.writable, self.cwd):
                return f"Paths must be in the session directory {self.output}. " + allowed
        if Path(script).name in _SCAFFOLDING_SCRIPTS:
            return self._check_blueprint(argv)
        return None

    def _check_one_liner(self, code: str, allowed: str) -> str | None:
        for one_liner in _ONE_LINERS:
            match = one_liner.match(code)
            if match:
                if one_liner is _ONE_LINERS[0] and not _inside(
                    match.group(1), self.readable, self.cwd
                ):
                    return allowed
                return None
        return allowed

    def _check_blueprint(self, argv: list[str]) -> str | None:
        """The scaffolder pastes blueprint text into code it runs (scaffold_guard)."""
        path = None
        for i, arg in enumerate(argv):
            if arg == "--blueprint" and i + 1 < len(argv):
                path = argv[i + 1]
            elif arg.startswith("--blueprint="):
                path = arg.split("=", 1)[1]
        if path is None:
            return None
        target = Path(path) if os.path.isabs(path) else self.cwd / path
        try:
            blueprint = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None  # the script reports an unreadable blueprint itself
        if not isinstance(blueprint, dict):
            return None
        found = scaffold_guard.problems(blueprint)
        if not found and scaffold_guard.safe_for_scaffolding(blueprint) == blueprint:
            return None
        return (
            "Fix the blueprint before scaffolding: names that become code must be plain "
            "identifiers (letters, digits, _), and text values may not contain double quotes, "
            "backslashes or line breaks (use ” instead of a double quote). "
            + ("Problems: " + "; ".join(found[:5]) if found else "")
        ).strip()
