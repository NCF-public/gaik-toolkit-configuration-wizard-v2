# Explicit case stops

These four diagrams pin the clarified rule: every explicit decision branch to
`end` terminates the whole case, including parallel work, without entering later
report or delivery tasks. Rejection and discard ends also terminate the case.

The blueprint inputs remain in `../bpmn_develop/`. The original develop drawings
are retained there as historical fixtures; they predate this stop rule.

To regenerate these drawings from the current checkout, run from the repository:

```sh
uv run python implementation_layer/solution_wizard/tests/fixtures/bpmn_develop/regenerate.py --stops
```

Review the diagram changes and run the token checks in
`test_bpmn_agent_report_steps.py` before committing them.
