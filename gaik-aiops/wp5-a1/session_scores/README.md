# Session scores

Says for every wizard session how it went, without anyone opening it: a job reads the facts the
wizard already records on its spans and writes them to MLflow as scores. No prompt or response text
is read; none exists in the stack.

## What you see in MLflow

In the experiment `wizard-v2-api`:

- **Overview → Quality**: the average, count, distribution and daily trend of each score over all
  sessions. The tab has a time range and no other filter.
- **Evaluation runs**: one run per group of sessions with the same environment, wizard version, model
  and reasoning level, named `sessions: s4 · 0.5.2 · <model> · high`, with the group's numbers as
  columns. Sort or chart them to compare versions, models and reasoning levels.
- **Traces**: the scores are assessments on each session's first trace, which has the tag
  `gaik.session_scores.carrier`. Filter and save a view, for example:

| View | Filter |
|---|---|
| Sessions of one environment | ``tags.`gaik.session_scores.carrier` = 'true' AND tags.`deployment.environment.name` = 'staging'`` |
| Sessions whose PoC run failed | ``tags.`gaik.session_scores.carrier` = 'true' AND feedback.`PoC run passed` = '0.0'`` |
| Sessions that did not finish | ``tags.`gaik.session_scores.carrier` = 'true' AND feedback.`Session finished` = '0.0'`` |

  Save one with the view menu left of the time range (*Save as new view*); a saved view has a share link.

## The scores

Each is a number, so the Quality tab can average it (it shows no average for true/false).

| Score | Value | From |
|---|---|---|
| `Session finished` | 1 when the last gate (`gate_4`) stands approved, else 0 | `wizard.gate` spans, and the gate statuses each `wizard.turn` starts from |
| `PoC run passed` | 1 when the latest settled run of the package succeeded, 0 when it failed or timed out; absent when no run settled | `wizard.sandbox.result` spans of kind `run` |
| `Gate rejections` | times a gate was rejected or an approval taken back (by the user, the agent's tool or a change in the chat); a reopening that takes several gates back counts each | `wizard.gate` spans |
| `Session cost EUR`, `Session cost USD` | the turns' cost; euros only where the deployment has a rate | `gaik.turn.cost.*` on `wizard.turn` |
| `Session duration min` | from the session's first span to its last, idle time included | trace times |
| `Finished PoC cost EUR`, `Finished PoC duration min` | the same two numbers, only for a finished session whose PoC run passed, so the average is the price and time of one working PoC | the above |

A session is scored once it has been quiet for 60 minutes (longer than one turn may run), and again
if it goes on later. A session that never finishes therefore counts as not finished; there is no
separate "abandoned" state.

A group's run has `sessions`, `finished_pct`, `poc_run_pct` (sessions that ran their package),
`poc_passed_pct` (of those), `eur_per_finished_poc`, `minutes_per_finished_poc`, `eur_per_session`,
`usd_per_session` and `gate_rejections_per_session`, over the sessions begun in the last 30 days. Each
pass logs them again, so a metric's history is its trend.

## Limits

- The labels are read from the session's first trace. Sessions recorded before the wizard sent its
  version, model and reasoning level are grouped under `unknown`.
- Sessions recorded before the wizard made a span for a reopened gate (the panel's Change, the
  agent's tool) show a reopening only when the next turn starts, and do not count it in
  `Gate rejections`.
- A run's result is recorded only when someone followed the run to its end in the web app. A run
  nobody watched leaves no result, and the session then has no `PoC run passed`.
- A group none of whose sessions are inside the window any more keeps its last numbers.
- A number a group has no session for (no finished PoC yet, say) is written as NaN and shown as `-`.
- The job reads traces one at a time and stops starting new sessions after 1500 traces in a pass;
  the next pass goes on from there. MLflow builds each trace in memory to answer, and a client that
  asks for hundreds at once can get the server killed.

## Run it

Against the compose stack (`deploy/compose`), from this folder:

```bash
uv run session-scores --settle-minutes 0
```

| Setting | Default | |
|---|---|---|
| `MLFLOW_TRACKING_URI` | `http://127.0.0.1:5000` | |
| `--experiment`, `SESSION_SCORES_EXPERIMENT` | `wizard-v2-api` | |
| `--settle-minutes`, `SESSION_SCORES_SETTLE_MINUTES` | `60` | how long a session must be quiet |
| `--lookback-hours`, `SESSION_SCORES_LOOKBACK_HOURS` | `72` | how far back the first pass reads |
| `--window-days`, `SESSION_SCORES_WINDOW_DAYS` | `30` | sessions compared in the group runs |
| `--max-traces`, `SESSION_SCORES_MAX_TRACES` | `1500` | traces read in one pass |

The job keeps its place in the experiment tag `gaik.session_scores.watermark_ms`. Delete the tag to
have the next pass read the look-back again; sessions already scored are not scored twice.

On Kubernetes it is the CronJob `session-scores` (`deploy/k8s/stack/base/session-scores.yaml`), every
15 minutes. It talks to MLflow inside the namespace and holds no secret.

## Tests

```bash
uv run --extra dev pytest -q
```

`tests/test_stack.py` sends a synthetic session through the collector into the `example-producer`
experiment and runs the job on it; it is skipped without the stack.
