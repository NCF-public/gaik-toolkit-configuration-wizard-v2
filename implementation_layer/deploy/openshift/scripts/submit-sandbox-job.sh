#!/usr/bin/env bash
# Submit one sandbox PoC run (S5-1 / #89) and print the Job name.
#
#   ./submit-sandbox-job.sh <session-id> [image]
#
# Renders sandbox-job.yaml's placeholders and applies it with `oc`. #91
# (SandboxRunner) will call this same path from wizard_api; keeping the
# rendering here means the manifest stays the single source of truth for the
# isolation settings.
#
# --dry-run renders to stdout without touching a cluster, which is also how the
# manifest test exercises it.
set -euo pipefail

TEMPLATE="$(cd "$(dirname "$0")/.." && pwd)/sandbox-job.yaml"
SESSION_ID="${1:-}"
IMAGE="${2:-image-registry.apps.2.rahti.csc.fi/PROJECT_PLACEHOLDER/wizard-v2-poc-runner:latest}"
DRY_RUN="${DRY_RUN:-}"

if [ -z "$SESSION_ID" ]; then
  echo "usage: $0 <session-id> [image]" >&2
  exit 2
fi

# Job names must be DNS-1123 labels, so keep the run id lowercase alphanumeric.
RUN_ID="$(date +%Y%m%d%H%M%S)-$(printf '%s' "$SESSION_ID" | tr -dc 'a-z0-9' | tail -c 8)"

render() {
  sed \
    -e "s|SESSION_ID_PLACEHOLDER|${SESSION_ID}|g" \
    -e "s|RUN_ID_PLACEHOLDER|${RUN_ID}|g" \
    -e "s|IMAGE_PLACEHOLDER|${IMAGE}|g" \
    "$TEMPLATE"
}

if [ -n "$DRY_RUN" ]; then
  render
  exit 0
fi

# The default image still carries the registry project placeholder the other
# manifests here use; submitting that would fail with an ImagePullBackOff after
# the Job is already created, so refuse up front.
case "$IMAGE" in
  *PROJECT_PLACEHOLDER*)
    echo "pass the runner image explicitly: $0 $SESSION_ID <image>" >&2
    exit 2
    ;;
esac

if ! command -v oc >/dev/null 2>&1; then
  echo "oc not found — run with DRY_RUN=1 to render only" >&2
  exit 1
fi

render | oc apply -f - >/dev/null
echo "wizard-v2-poc-run-${RUN_ID}"
