#!/usr/bin/env python3
"""Experimental: the Solution Wizard on OpenAI Codex with an Azure OpenAI model.

run_wizard_interactive.py runs the wizard on Claude Code through the Claude
Agent SDK. This runner starts the Codex CLI instead, with the same skill
(SKILL.md) and the same first message, against a model deployed in your Azure
OpenAI resource (gpt-6.2-sol unless you name another deployment). It is an
experiment for comparing the two agents; the web app's wizard still runs Claude.

--- Prerequisites -----------------------------------------------------------

1. The Codex CLI, 0.166 or later, on PATH:

       npm install -g @openai/codex
       codex --version

2. The wizard's Python packages, as for the Claude runner (its helpers are
   reused here, so this includes the Claude Agent SDK):

       pip install "gaik[wizard]"

3. A .env file (default: implementation_layer/.env) with your Azure OpenAI
   resource, the same names gaik and the generated PoCs read:

       AZURE_API_KEY=<key>
       AZURE_ENDPOINT=https://<resource>.openai.azure.com/
       AZURE_API_VERSION=<version the PoCs use>

   The model is a deployment name in that resource (--model, or
   WIZARD_CODEX_MODEL in the shell or the .env file).

--- How it differs from run_wizard_interactive.py ---------------------------

- Codex's own sandbox stands in for agent_tool_guard.py, and it limits less.
  Commands write only in the wizard folder, the output folder and the temp
  folder, but they are not limited to the wizard's scripts, they may read any
  file you can (.env files included), and they run with network access and
  the .env names, the Azure key among them, in their environment. The wizard
  folder is not write-protected either. Run it on your own machine with your
  own sample files, from a clean checkout, and check `git status` afterwards.
  A command that needs more than the sandbox allows asks for your approval.
- Codex gets a settings folder of its own per output folder (printed at start):
  your ~/.codex settings, plugins and MCP servers, this repository's AGENTS.md
  and the skills in ~/.agents/skills are not loaded. Codex's bundled skills
  stay listed.
- The agent gets the system basics and the names your .env sets, nothing else
  from your shell, as with the Claude runner.
- There is no cost limit: Codex has no per-session budget.

--- Usage -------------------------------------------------------------------

    python run_wizard_codex.py --output-dir C:/projects/my-use-case
    python run_wizard_codex.py --model gpt-6.2-sol --reasoning-effort high
    python run_wizard_codex.py --output-dir C:/projects/my-use-case --resume <session id>
    python run_wizard_codex.py --preflight      # one small request, then exit
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import dotenv_values, load_dotenv

# run_wizard_interactive's helpers are imported where they are used: that module
# imports the Claude Agent SDK, and the config functions here need neither.
WIZARD_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = "gpt-6.2-sol"
DEFAULT_EFFORT = "medium"
#: The names Codex itself needs; the .env file names everything else.
REQUIRED_ENV_VARS = ["AZURE_API_KEY", "AZURE_ENDPOINT"]


def _toml(value: str) -> str:
    """A TOML basic string. JSON's escapes are TOML's, as long as characters
    outside the BMP stay as they are (TOML refuses surrogate escapes)."""
    return json.dumps(value, ensure_ascii=False)


def azure_base_url(endpoint: str) -> str:
    """The Responses API base of an Azure OpenAI resource, from its endpoint."""
    parts = urlparse(endpoint.strip())
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError(
            "AZURE_ENDPOINT must be an https address, such as https://<resource>.openai.azure.com/"
        )
    if parts.username or parts.password:
        # It is written into Codex's config file; the key belongs in AZURE_API_KEY.
        raise ValueError("AZURE_ENDPOINT must not carry a user name or password")
    return f"https://{parts.netloc}/openai/v1"


def codex_home_for(output_dir: Path) -> Path:
    """Codex's settings and sessions for one output folder, outside it.

    Outside, because the agent's commands may write anywhere in the output
    folder, and this one holds the settings that decide what they may do.
    """
    base = Path(os.getenv("LOCALAPPDATA") or Path.home() / ".cache")
    # normcase: the same folder written in another case resumes the same session on Windows.
    digest = hashlib.sha256(os.path.normcase(str(output_dir)).encode()).hexdigest()[:12]
    return base / "gaik-solution-wizard" / "codex" / digest


def write_model_catalog(home: Path, model: str) -> Path | None:
    """Codex's metadata for the model (its instructions, tools and context window),
    taken from the catalog that a signed-in Codex keeps in ~/.codex.

    Azure serves no such metadata, so without it Codex warns "Model metadata ...
    not found" and runs the model on generic defaults. None when the catalog is
    missing or lacks the model (a deployment named other than the model, say).
    """
    cache = Path(os.getenv("CODEX_HOME") or Path.home() / ".codex") / "models_cache.json"
    try:
        models = json.loads(cache.read_text(encoding="utf-8"))["models"]
        entry = next((m for m in models if isinstance(m, dict) and m.get("slug") == model), None)
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if entry is None:
        return None
    path = home / "model_catalog.json"
    path.write_bytes(json.dumps({"models": [entry]}).encode())
    return path


def skill_roots(home: Path | None = None) -> list[Path]:
    """Where Codex finds skills that are not its own: ~/.agents/skills, and
    .agents/skills in the wizard folder and each folder above it in the repository."""
    roots = [(home or Path.home()) / ".agents" / "skills"]
    for folder in (WIZARD_DIR, *WIZARD_DIR.parents):
        roots.append(folder / ".agents" / "skills")
        if (folder / ".git").exists():
            break
    return roots


def skill_files(root: Path) -> list[Path]:
    """Every SKILL.md under ``root`` at any depth, following linked folders once."""
    found, seen = [], set()
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        real = os.path.realpath(dirpath)
        if real in seen:
            dirnames[:] = []
            continue
        seen.add(real)
        if "SKILL.md" in filenames:
            found.append(Path(dirpath) / "SKILL.md")
    return sorted(found)


def user_skills_off(home: Path | None = None) -> str:
    """Turn off the skills Codex would find outside its own (skill_roots).

    The Claude runner loads no skills of the user's, and a skill such as one
    that deploys does not belong in a wizard session. Codex's bundled skills
    (image generation, its own docs and the like) stay listed.
    """
    tables = [
        f"[[skills.config]]\npath = {_toml(p.as_posix())}\nenabled = false\n"
        for root in skill_roots(home)
        for p in skill_files(root)
    ]
    return "\n".join(tables)


def windows_sandbox() -> str:
    """Codex's Windows sandbox: mxc, unless WIZARD_CODEX_WINDOWS_SANDBOX names another."""
    return (os.getenv("WIZARD_CODEX_WINDOWS_SANDBOX") or "").strip() or "mxc"


def codex_config(
    *,
    model: str,
    effort: str,
    base_url: str,
    output_dir: Path,
    approval: str,
    catalog: Path | None = None,
) -> str:
    """config.toml for the wizard's Codex: Azure, the sandbox, nothing of the user's."""
    q = _toml
    catalog_line = f"model_catalog_json = {q(catalog.as_posix())}\n" if catalog else ""
    # Without a Windows sandbox, Codex refuses every command ("blocked by policy").
    windows = f"[windows]\nsandbox = {q(windows_sandbox())}\n\n" if os.name == "nt" else ""
    return f"""\
{catalog_line}model = {q(model)}
model_provider = "azure"
model_reasoning_effort = {q(effort)}
approval_policy = {q(approval)}
sandbox_mode = "workspace-write"
# No AGENTS.md from the repository: the agent follows SKILL.md only, as the
# Claude runner (setting_sources=[]) does.
project_doc_max_bytes = 0

[sandbox_workspace_write]
network_access = true
writable_roots = [{q(output_dir.as_posix())}]

# The runner already narrowed the environment to the system basics and the .env
# names; Codex's own filter would drop the key the wizard's scripts need.
[shell_environment_policy]
inherit = "all"
ignore_default_excludes = true

{windows}[model_providers.azure]
name = "Azure OpenAI"
base_url = {q(base_url)}
env_key = "AZURE_API_KEY"
wire_api = "responses"

{user_skills_off()}"""


def codex_command() -> list[str]:
    """How to start Codex. On Windows the npm shim runs through cmd.exe, which
    cuts an argument at its first line break, so its script is run with node."""
    found = shutil.which("codex")
    if not found:
        raise SystemExit("codex is not on PATH: npm install -g @openai/codex")
    if os.name == "nt" and found.lower().endswith((".cmd", ".bat")):
        script = Path(found).parent / "node_modules" / "@openai" / "codex" / "bin" / "codex.js"
        node = shutil.which("node")
        if not (script.is_file() and node):
            # Through cmd.exe the first message would arrive cut to its first line.
            raise SystemExit(
                f"{found} is a cmd.exe shim and its codex.js was not found beside it: "
                "install Codex with npm (npm install -g @openai/codex) or put codex.exe on PATH"
            )
        return [node, str(script)]
    return [found]


def load_environment(env_file: Path, pass_env: list[str] | None = None) -> dict[str, str]:
    """The agent's environment: system basics and the names the .env file sets.

    The .env values also go into this process's environment, where main() reads
    the runner's own settings (WIZARD_CODEX_MODEL)."""
    from run_wizard_interactive import agent_environment

    names: set[str] = set(REQUIRED_ENV_VARS)
    if env_file.exists():
        load_dotenv(env_file)
        names |= {k for k in dotenv_values(env_file) if k}
    else:
        print(f"(no .env at {env_file}: using the current shell)", file=sys.stderr)
        names |= {k for k in os.environ if k.upper().startswith(("AZURE_", "LLM_PROVIDER"))}
    missing = [k for k in REQUIRED_ENV_VARS if not (os.getenv(k) or "").strip()]
    if missing:
        raise SystemExit(f"Missing Azure settings: {', '.join(missing)} (see --help)")
    return agent_environment(dict(os.environ), names, pass_env or [])


def _inside(path: Path, folder: Path) -> bool:
    path, folder = path.resolve(), folder.resolve()
    return path == folder or folder in path.parents


def prepare(
    output_dir: Path, env: dict[str, str], *, model: str, effort: str, approval: str
) -> dict[str, str]:
    """Write Codex's settings for this output folder; return the process environment."""
    home = codex_home_for(output_dir)
    if _inside(home, output_dir) or _inside(home, WIZARD_DIR):
        raise SystemExit(
            f"Codex's settings folder {home} would be inside a folder the agent writes; "
            "choose another output folder"
        )
    home.mkdir(parents=True, exist_ok=True)
    config = codex_config(
        model=model,
        effort=effort,
        base_url=azure_base_url(env["AZURE_ENDPOINT"]),
        output_dir=output_dir,
        approval=approval,
        catalog=write_model_catalog(home, model),
    )
    (home / "config.toml").write_bytes(config.encode())
    return {**env, "CODEX_HOME": str(home)}


def first_message(output_dir: Path) -> str:
    """The Claude runner's first message, without its Claude Code slash command."""
    from run_wizard_interactive import build_initial_prompt

    return build_initial_prompt(output_dir).removeprefix("/solution-wizard").lstrip()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--output-dir", help="Where the wizard writes (outside this repository)")
    p.add_argument(
        "--env-file",
        default=str(WIZARD_DIR.parent / ".env"),
        help="Default: implementation_layer/.env",
    )
    p.add_argument(
        "--model", default=None, help=f"Azure deployment name (default: {DEFAULT_MODEL})"
    )
    p.add_argument(
        "--reasoning-effort", default=DEFAULT_EFFORT, choices=["low", "medium", "high", "xhigh"]
    )
    p.add_argument(
        "--resume", metavar="SESSION_ID", help="Continue an earlier session of this output folder"
    )
    p.add_argument(
        "--pass-env", action="append", default=[], metavar="NAME", help="Hand another variable on"
    )
    p.add_argument("--preflight", action="store_true", help="Send one small request and exit")
    return p.parse_args()


def main() -> None:
    from run_wizard_interactive import _ask_output_dir, resolve_output_dir, use_utf8_output

    use_utf8_output()
    args = parse_args()
    if args.resume is not None and not args.resume.strip():
        raise SystemExit("--resume needs a session id")
    env = load_environment(Path(args.env_file).expanduser(), args.pass_env)
    model = (args.model or os.getenv("WIZARD_CODEX_MODEL") or "").strip() or DEFAULT_MODEL
    command = codex_command()

    if args.preflight:
        scratch = codex_home_for(Path("preflight")).parent / "preflight-work"
        scratch.mkdir(parents=True, exist_ok=True)
        run_env = prepare(scratch, env, model=model, effort="low", approval="never")
        result = subprocess.run(
            [*command, "exec", "--skip-git-repo-check", "-s", "read-only", "-C", str(scratch),
             "Reply with the single word READY."],
            env=run_env,
            stdin=subprocess.DEVNULL,  # codex exec waits for an open stdin to end
        )  # fmt: skip
        sys.exit(result.returncode)

    output_dir = (
        resolve_output_dir(args.output_dir, Path.cwd()) if args.output_dir else _ask_output_dir()
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    run_env = prepare(
        output_dir, env, model=model, effort=args.reasoning_effort, approval="on-request"
    )
    print(f"Codex settings and sessions: {run_env['CODEX_HOME']}")
    print(f"Model: {model} on Azure, reasoning effort {args.reasoning_effort}")

    folders = ["-C", str(WIZARD_DIR), "--add-dir", str(output_dir)]
    if args.resume:
        argv = [*command, "resume", args.resume.strip(), *folders]
    else:
        argv = [*command, *folders, first_message(output_dir)]
    sys.exit(subprocess.run(argv, env=run_env).returncode)


if __name__ == "__main__":
    main()
