#!/usr/bin/env bash
# Fires or clears the harmless AIOpsTestAlert (deploy/compose/prometheus/rules/test-alert.yml) by
# sending the gauge gaik.aiops.test_alert through the collector: 1 to fire, 0 to clear. Without a
# clear the alert clears on its own 5 minutes after the last fire. It touches no wizard and pages
# nobody (severity info, no outside receiver). Steps: wp5-a1/dashboards-alerting.md, "Test alert".
#
#   deploy/k8s/stack/overlays/rahti/send-test-alert.sh fire
#   deploy/k8s/stack/overlays/rahti/send-test-alert.sh clear
#
# OTLP_ENDPOINT (default http://127.0.0.1:4318, the local stack or an oc port-forward), for a
# protected endpoint OTLP_TOKEN, and ENVIRONMENT to label the alert with an environment name.
set -euo pipefail

case "${1:-}" in
  fire) VALUE=1 ;;
  clear) VALUE=0 ;;
  *) echo "usage: $0 fire|clear" >&2; exit 2 ;;
esac

ENDPOINT="${OTLP_ENDPOINT:-http://127.0.0.1:4318}"
# Below a second, so a clear sent in the same second as its fire is not dropped by Prometheus as a
# duplicate sample. GNU date knows %N; BSD date (macOS) prints it as is, then perl measures.
NOW="$(date +%s%N)"
case "$NOW" in
  *[!0-9]*) NOW="$(perl -MTime::HiRes=time -e 'printf "%.0f", time * 1e9')" ;;
esac

ATTRIBUTES='{"key":"service.name","value":{"stringValue":"aiops-test-alert"}}'
if [ -n "${ENVIRONMENT:-}" ]; then
  case "$ENVIRONMENT" in
    *[!A-Za-z0-9._-]*) echo "ENVIRONMENT may hold letters, digits, '.', '_' and '-' only" >&2; exit 2 ;;
  esac
  ATTRIBUTES="$ATTRIBUTES,{\"key\":\"deployment.environment.name\",\"value\":{\"stringValue\":\"$ENVIRONMENT\"}}"
fi

BODY="{\"resourceMetrics\":[{\"resource\":{\"attributes\":[$ATTRIBUTES]},\"scopeMetrics\":[{\"scope\":{\"name\":\"gaik.test-alert\"},\"metrics\":[
 {\"name\":\"gaik.aiops.test_alert\",\"description\":\"1 while the AIOps test alert should fire\",
  \"gauge\":{\"dataPoints\":[{\"timeUnixNano\":\"$NOW\",\"asInt\":\"$VALUE\"}]}}
]}]}]}"

# The token goes to curl as a header file, never on its command line.
if [ -n "${OTLP_TOKEN:-}" ]; then
  printf '%s' "$BODY" | curl -fsS -o /dev/null -X POST -H "Content-Type: application/json" \
    -H @<(printf 'Authorization: Bearer %s\n' "$OTLP_TOKEN") --data-binary @- "$ENDPOINT/v1/metrics"
else
  printf '%s' "$BODY" | curl -fsS -o /dev/null -X POST -H "Content-Type: application/json" \
    --data-binary @- "$ENDPOINT/v1/metrics"
fi

if [ "$VALUE" = 1 ]; then
  echo "Sent $1 to $ENDPOINT. AIOpsTestAlert reaches Alertmanager and the Grafana 'Active alerts'"
  echo "panels within about 30 seconds and clears 5 minutes after the last fire, or on '$0 clear'."
else
  echo "Sent $1 to $ENDPOINT. AIOpsTestAlert resolves within about 30 seconds."
fi
