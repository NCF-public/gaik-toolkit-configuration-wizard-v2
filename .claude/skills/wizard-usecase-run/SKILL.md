---
name: wizard-usecase-run
description: Walks a set of different use cases (document extraction, RAG, audio, classification, report writing, questions over tabular data) through a running Solution Wizard v2 with the real agent and checks the result of each - the components chosen, the gates, the generated PoC package and optionally its test run - plus what a tester tries by hand, such as a reload during a reply, reopening a gate, asking for a change after approval, writing in another language and ending the session. Use when asked to test the wizard with several use cases, to check that a change to the wizard API, the agent prompt or the skill still produces working sessions end to end, or for "aja wizardin use caset", "testaa wizard eri use caseilla", "run the use case set". Local and manual; it is not part of CI. For the web app's own behaviour use its Playwright specs.
---

# Wizard use case run

`run_usecases.py` plays the user against `wizard_api`: it creates a session for each case in
`usecases.json`, describes the use case, answers every other question with "make sensible
assumptions and go on", approves the gates, and tries the scenarios the case lists. It needs
Python only, and a running API with a working agent (`implementation_layer/WIZARD-DEV.md`).

## Run it

1. Check the API answers (`GET <base>/health` is 200), and ask which one to use if it is not
   the local stack. `--base` (or `WIZARD_API_URL`) names it; the default is
   `http://localhost:8100`. Against a deployed test instance the API is reached with a
   port-forward and wants its service token in an environment variable (`--token-env`, default
   `WIZARD_API_TOKEN`); never print the token.
2. Start the run in the background; a whole case takes 10 to 30 minutes:

   ```bash
   python .claude/skills/wizard-usecase-run/run_usecases.py --out <folder outside the repository>
   ```

   - `--only invoice-extraction,policy-rag` runs some cases, `--list` shows them.
   - `--stop-at-gate 1` is the quick pass (a minute or two a case) after a change to the early
     conversation.
   - `--run` starts the PoC test run at the PoC step. Where the API has a sandbox it is
     needed: Gate 3 is refused there without a successful run. Without a sandbox the check is
     reported as skipped and Gate 3 is approved without a run.
   - `--parallel 2` runs two sessions at a time. Keep it at 1 unless the user asks: the API
     lets one user have two sessions working at a time, and a third waits (the runner retries
     a `429 agent_busy` for ten minutes). For the same reason do not start a second run beside
     one that is going.
3. When it ends, read `summary.md` in the output folder and report from it.

## Read the result

`summary.md` has one row a case (failed checks, last step, minutes, components, package files)
and the checks of each case below it. Beside it are `<case>.log` (the whole conversation) and
`<case>.json` (the final blueprint, output definition and gates).

- A failed check is a finding only after its log has been read: quote the lines that show it.
  `expected_component` fails when the wizard chose something else, which can be a fair choice;
  say which and let the user judge.
- `skip` means the walk did not get there or the API lacks the feature (an older branch has no
  gate reopening, `/chat/stream` or `/agent/end`).
- A failure that names a refusal (`last refusal: 429 ...`) or a lost connection comes from the
  environment, not the wizard: run that case again with `--only` into a new `--out` folder.
- `change_in_chat` (after Gate 2) passes only if the agent reopens a gate with its own tool;
  the API compares approved content by itself only after Gate 3 (`change_after_gate3`).
- The checks do not judge whether the solution is good. When the user wants that, give each
  case to a small-model subagent with one question - does the blueprint in `<case>.json` do
  what the description in `usecases.json` asks, and what is missing - and have it answer with
  the step names it relied on. Check what it reports before passing it on.

Report the cases that failed first, then what was not covered: the web app is not exercised,
and without `--run` no package was executed.

## Scenarios

| Scenario | What the walk does | Passes when |
| --- | --- | --- |
| `reload_mid_reply` | Joins the running reply from a second connection and sends a second message meanwhile | The reply arrives on the second connection and the second message is refused |
| `language_offer` | Writes in the other language after Gate 1 | The reply carries the offer to switch the interface language |
| `reopen_in_panel` | Reopens Gate 1 after Gate 2, as the panel does | Every gate is pending again and the session is back at Gate 1 |
| `change_in_chat` | Asks for the case's `change` after Gate 2 | An approved gate was reopened (skipped if nothing approved changed) |
| `change_after_gate3` | Asks for the same after Gate 3 | An approved gate was reopened |
| `end_session` | Ends the agent when the session is done | The session reports no live agent |

Every case also checks that it reaches the end with all gates approved, that a package exists
at Gate 3, that an expected component is among the blueprint's steps, and that no reply carried
an error frame.

## Add or change a case

Edit `usecases.json`: an `id`, a `title`, a `locale` (`fi` or `en`), a `description` written
the way a customer would write it, `expect.component` as a regular expression over component
names, and the scenarios to try. Use invented organisations and data only. A case that should
run with real sample input lists files beside `usecases.json` in `inputs`; keep customer
documents out of the repository.
