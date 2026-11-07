"""Create one MLflow experiment per application and write the collector's routes to them.

MLflow assigns experiment ids itself, so the collector cannot name them in a static config. This runs
once before the collector starts: it makes sure an experiment exists for every application in
MLFLOW_EXPERIMENTS (experiment name = OTel service.name), then writes a collector config fragment that
routes each application's traces to its experiment. Traces from any other service go to the Default
experiment (id 0) through the base config's otlphttp/mlflow exporter.

The fragment is JSON, which the collector reads as YAML. Re-running is safe: existing experiments are
reused.

Environment:
    MLFLOW_TRACKING_URI   e.g. http://mlflow:5000
    MLFLOW_EXPERIMENTS    comma-separated service names
    ROUTES_FILE           where to write the fragment
"""

import json
import os
import re
import sys

from mlflow import MlflowClient

NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def experiment_ids(client: MlflowClient, names: list[str]) -> dict[str, str]:
    ids = {}
    for name in names:
        found = client.get_experiment_by_name(name)
        ids[name] = found.experiment_id if found else client.create_experiment(name, tags={"service.name": name})
    return ids


def routes(ids: dict[str, str]) -> dict:
    exporters, pipelines, table = {}, {}, []
    for name, experiment_id in ids.items():
        key = re.sub(r"[^A-Za-z0-9_-]", "_", name)
        exporters[f"otlphttp/mlflow-{key}"] = {
            "traces_endpoint": "http://mlflow:5000/v1/traces",
            "headers": {"x-mlflow-experiment-id": experiment_id},
        }
        pipelines[f"traces/mlflow-{key}"] = {"receivers": ["routing/mlflow"], "exporters": [f"otlphttp/mlflow-{key}"]}
        table.append({
            "statement": f'route() where attributes["service.name"] == "{name}"',
            "pipelines": [f"traces/mlflow-{key}"],
        })
    pipelines["traces/mlflow-default"] = {"receivers": ["routing/mlflow"], "exporters": ["otlphttp/mlflow"]}
    # Spans are pseudonymised in the traces pipeline before they reach the router.
    pipelines["traces"] = {
        "receivers": ["otlp"],
        "processors": ["transform/privacy", "batch"],
        "exporters": ["spanmetrics", "routing/mlflow"],
    }
    return {
        "connectors": {"routing/mlflow": {"default_pipelines": ["traces/mlflow-default"], "table": table}},
        "exporters": exporters,
        "service": {"pipelines": pipelines},
    }


def main() -> int:
    names = [n.strip() for n in os.environ.get("MLFLOW_EXPERIMENTS", "").split(",") if n.strip()]
    bad = [n for n in names if not NAME.match(n)]
    if bad:
        print(f"invalid service names: {bad}", file=sys.stderr)
        return 1
    ids = experiment_ids(MlflowClient(), names)
    # With no applications listed the fragment is empty and every trace goes to Default.
    with open(os.environ["ROUTES_FILE"], "w", encoding="utf-8") as fh:
        json.dump(routes(ids) if ids else {}, fh, indent=2)
    for name, experiment_id in ids.items():
        print(f"{name} -> experiment {experiment_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
