#!/bin/bash
# =============================================================================
# GAIK Solution Wizard V2 — Rahti 2 (staging) deployment script
# =============================================================================
#
# Builds the wizard_api + solution_wizard_v2 images, pushes them to the CSC
# Rahti 2 registry, and rolls out the Deployments.
#
# USAGE:
#   cd implementation_layer/deploy/openshift
#   chmod +x deploy.sh
#   export PROJECT=<your-staging-project>          # required
#   export NEXT_PUBLIC_SUPABASE_URL=...            # web build (unless dev-auth)
#   export NEXT_PUBLIC_SUPABASE_ANON_KEY=...       # web build (unless dev-auth)
#   export NEXT_PUBLIC_DEV_AUTH=false              # or true for the dev login
#
#   ./deploy.sh manifests   # apply db, PVCs, services, route, deployments
#   ./deploy.sh api         # build + push + roll out the backend
#   ./deploy.sh web         # build + push + roll out the frontend
#   ./deploy.sh all         # manifests, then api, then web
#   ./deploy.sh verify      # show routes, env, recent api logs
#
# PREREQUISITES:
#   1. oc CLI + Docker with buildx.
#   2. oc login https://api.2.rahti.csc.fi:6443
#   3. oc project "$PROJECT"
#   4. Fill secrets: cp secrets.yaml.example secrets.yaml (edit) &&
#      oc apply -f secrets.yaml ; also edit the password/url in postgres.yaml.
# =============================================================================
set -euo pipefail

REGISTRY="image-registry.apps.2.rahti.csc.fi"
PROJECT="${PROJECT:-}"
API_DEPLOYMENT="wizard-v2-api"
WEB_DEPLOYMENT="wizard-v2-web"
BUILDX_BUILDER="${BUILDX_BUILDER:-gaik-rahti}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"          # implementation_layer/
WEB_DIR="$IMPL_DIR/solution_wizard_v2"

# Baked into both images at build time so a running pod can report exactly
# what it's running (GET /health on the api, the login page footer on the
# web app) without needing GitHub or oc access. Prefers the nearest
# dev-YYYY-MM-DD-<sha> tag (see .github/workflows/solution-wizard-v2.yml);
# falls back to a bare short SHA if the checkout has no tags reachable.
APP_VERSION="$(cd "$IMPL_DIR/.." && git describe --tags --always --dirty 2>/dev/null || echo unknown)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

print_usage() {
    echo "Usage: PROJECT=<project> ./deploy.sh [manifests|api|web|all|verify]"
    echo ""
    echo "  manifests  Apply db + PVCs + services + route + deployments"
    echo "  api        Build, push and roll out wizard-v2-api"
    echo "  web        Build, push and roll out wizard-v2-web"
    echo "  all        manifests, then api, then web"
    echo "  verify     Show routes, api env and recent api logs"
}

require_project() {
    if [ -z "$PROJECT" ]; then
        echo -e "${RED}Error: PROJECT env var is required (export PROJECT=<staging-project>)${NC}"
        exit 1
    fi
}

check_oc_login() {
    if ! oc whoami &> /dev/null; then
        echo -e "${RED}Error: not logged in to OpenShift${NC}"
        echo "Run: oc login https://api.2.rahti.csc.fi:6443"
        exit 1
    fi
    echo -e "${GREEN}Logged in as: $(oc whoami) — project: $PROJECT${NC}"
}

check_docker() {
    if ! docker info &> /dev/null; then
        echo -e "${RED}Error: Docker is not running${NC}"; exit 1
    fi
}

ensure_registry_login() {
    echo -e "${YELLOW}Authenticating Docker against $REGISTRY...${NC}"
    if ! oc whoami -t | docker login -u "$(oc whoami)" --password-stdin "$REGISTRY" &> /dev/null; then
        echo -e "${RED}Error: failed to log Docker into the Rahti registry${NC}"
        echo "  oc whoami -t | docker login -u \"\$(oc whoami)\" --password-stdin $REGISTRY"
        exit 1
    fi
}

ensure_buildx_builder() {
    # Rahti's registry rejects Docker's default OCI manifest output. A
    # docker-container buildx builder lets us push Docker schema2 directly.
    if ! docker buildx inspect "$BUILDX_BUILDER" &> /dev/null; then
        echo -e "${YELLOW}Creating buildx builder $BUILDX_BUILDER...${NC}"
        docker buildx create --name "$BUILDX_BUILDER" --driver docker-container --use > /dev/null
    else
        docker buildx use "$BUILDX_BUILDER" > /dev/null
    fi
    docker buildx inspect --bootstrap > /dev/null
}

apply_manifest() {
    # Substitute the image-registry project into the deployment manifests.
    sed "s/PROJECT_PLACEHOLDER/$PROJECT/g" "$SCRIPT_DIR/$1" | oc apply -n "$PROJECT" -f -
}

rollout() {
    local d="$1"
    echo -e "${YELLOW}Rolling out deployment/$d...${NC}"
    oc rollout restart "deployment/$d" -n "$PROJECT"
    oc rollout status "deployment/$d" -n "$PROJECT" --timeout=300s
}

deploy_manifests() {
    echo -e "${YELLOW}Applying manifests to project $PROJECT...${NC}"
    oc apply -n "$PROJECT" -f "$SCRIPT_DIR/postgres.yaml"
    oc apply -n "$PROJECT" -f "$SCRIPT_DIR/pvc-sessions.yaml"
    oc apply -n "$PROJECT" -f "$SCRIPT_DIR/services.yaml"
    oc apply -n "$PROJECT" -f "$SCRIPT_DIR/route.yaml"
    apply_manifest deployment-api.yaml
    apply_manifest deployment-web.yaml
    echo -e "${GREEN}Manifests applied. (Ensure secrets.yaml is applied too.)${NC}"
}

deploy_api() {
    ensure_registry_login
    ensure_buildx_builder
    # Build context is implementation_layer/ because the Dockerfile COPYs both
    # wizard_api/ and solution_wizard/ (BPMN generation).
    echo -e "${YELLOW}Building and pushing wizard-v2-api ($APP_VERSION)...${NC}"
    docker buildx build \
        --platform linux/amd64 \
        --provenance=false \
        --target production \
        --output type=registry,oci-mediatypes=false \
        --build-arg "APP_VERSION=${APP_VERSION}" \
        -t "$REGISTRY/$PROJECT/$API_DEPLOYMENT:latest" \
        -t "$REGISTRY/$PROJECT/$API_DEPLOYMENT:$APP_VERSION" \
        -f "$IMPL_DIR/wizard_api/Dockerfile" \
        "$IMPL_DIR"
    rollout "$API_DEPLOYMENT"
    echo -e "${GREEN}wizard-v2-api deployed${NC}"
}

deploy_web() {
    ensure_registry_login
    ensure_buildx_builder
    # NEXT_PUBLIC_* must be baked in at build time — pass them as build args.
    echo -e "${YELLOW}Building and pushing wizard-v2-web ($APP_VERSION)...${NC}"
    docker buildx build \
        --platform linux/amd64 \
        --provenance=false \
        --output type=registry,oci-mediatypes=false \
        --build-arg "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-}" \
        --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
        --build-arg "NEXT_PUBLIC_DEV_AUTH=${NEXT_PUBLIC_DEV_AUTH:-false}" \
        --build-arg "NEXT_PUBLIC_APP_VERSION=${APP_VERSION}" \
        -t "$REGISTRY/$PROJECT/$WEB_DEPLOYMENT:latest" \
        -t "$REGISTRY/$PROJECT/$WEB_DEPLOYMENT:$APP_VERSION" \
        -f "$WEB_DIR/Dockerfile" \
        "$WEB_DIR"
    rollout "$WEB_DEPLOYMENT"
    echo -e "${GREEN}wizard-v2-web deployed${NC}"
}

verify() {
    echo -e "${YELLOW}Routes:${NC}";   oc get routes -n "$PROJECT"
    echo -e "${YELLOW}API env:${NC}";  oc set env deployment/$API_DEPLOYMENT --list -n "$PROJECT"
    echo -e "${YELLOW}API version (baked into the image, GET /health):${NC}"
    oc exec "deployment/$API_DEPLOYMENT" -n "$PROJECT" -- \
        python3 -c "import urllib.request,sys; sys.stdout.write(urllib.request.urlopen('http://localhost:8100/health').read().decode())" \
        2>/dev/null || echo "  (could not reach /health inside the pod)"
    echo -e "${YELLOW}API logs:${NC}"; oc logs deployment/$API_DEPLOYMENT -n "$PROJECT" --tail=40 || true
}

[ $# -eq 0 ] && { print_usage; exit 1; }
require_project
check_oc_login

case "$1" in
    manifests) deploy_manifests ;;
    api)       check_docker; deploy_api ;;
    web)       check_docker; deploy_web ;;
    all)       check_docker; deploy_manifests; deploy_api; deploy_web ;;
    verify)    verify ;;
    *)         print_usage; exit 1 ;;
esac

echo -e "${GREEN}Done!${NC}"
