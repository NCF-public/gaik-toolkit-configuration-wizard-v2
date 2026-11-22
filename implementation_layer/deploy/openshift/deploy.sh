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
#   export INSTANCE=                               # empty = the staging stack
#   export NEXT_PUBLIC_SUPABASE_URL=...            # web build (unless dev-auth)
#   export NEXT_PUBLIC_SUPABASE_ANON_KEY=...       # web build (unless dev-auth)
#   export NEXT_PUBLIC_DEV_AUTH=false              # or true for the dev login
#
#   ./deploy.sh secrets     # apply the untracked secrets.yaml for this instance
#   ./deploy.sh manifests   # apply db, PVCs, services, route, deployments
#   ./deploy.sh api         # build + push + roll out the backend
#   ./deploy.sh web         # build + push + roll out the frontend
#   ./deploy.sh poc-runner  # build + push the sandbox PoC run image, point the api at it
#   ./deploy.sh all         # manifests, then poc-runner, api and web
#   ./deploy.sh pin [tag]   # pin the stack's images by digest to what runs now
#   ./deploy.sh verify      # show route, env, recent api logs
#   ./deploy.sh render <f>  # print a manifest as it would be applied (no oc)
#
# INSTANCES:
#   Every resource is named after $NAME = wizard-v2[-$INSTANCE]: the
#   Deployments, Services, Route, PVCs, the db/token/web Secrets and the image
#   repositories. With INSTANCE empty the names are the historical ones
#   (wizard-v2-api, ...), so existing deployments are untouched. With
#   INSTANCE=s4 a second, independent stack (wizard-v2-s4-*) lives in the SAME
#   project, with its own database, session storage, images and public URL
#   (wizard-v2-s4-web-<project>.2.rahtiapp.fi). Only the project-wide
#   gaik-demo-api-keys Secret (model provider keys) is shared between instances.
#
# PREREQUISITES:
#   1. oc CLI + Docker with buildx.
#   2. oc login https://api.2.rahti.csc.fi:6443
#   3. oc project "$PROJECT"
#   4. Fill secrets: cp secrets.yaml.example secrets.yaml (edit) &&
#      ./deploy.sh secrets ; the file keeps NAME_PLACEHOLDER so the same copy
#      serves every instance.
# =============================================================================
set -euo pipefail

REGISTRY="image-registry.apps.2.rahti.csc.fi"
PROJECT="${PROJECT:-}"
INSTANCE="${INSTANCE:-}"
# Resource-name prefix. Kubernetes names are DNS labels, so the instance part
# is limited to lowercase letters, digits and dashes; the check is below.
NAME="wizard-v2${INSTANCE:+-$INSTANCE}"
API_DEPLOYMENT="$NAME-api"
WEB_DEPLOYMENT="$NAME-web"
# Not a Deployment: sandbox-job.yaml names this image per run (#89), so there is
# nothing to roll out -- pushing a new tag is the whole deploy.
POC_RUNNER_IMAGE="$NAME-poc-runner"
SCANNER_DEPLOYMENT="$NAME-scanner"
BUILDX_BUILDER="${BUILDX_BUILDER:-gaik-rahti}"
NL="
"
# Set by deploy_poc_runner: the runner image it pushed, by digest.
NEW_RUNNER_REF=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"          # implementation_layer/
WEB_DIR="$IMPL_DIR/solution_wizard_v2"

# Baked into both images at build time so a running pod can report exactly
# what it's running (GET /health on the api, the login page footer on the
# web app) without needing GitHub or oc access. Prefers the nearest
# dev-YYYY-MM-DD-<sha> tag (see .github/workflows/solution-wizard-v2.yml);
# falls back to a bare short SHA if the checkout has no tags reachable.
APP_VERSION="$(cd "$IMPL_DIR/.." && git describe --tags --always --dirty 2>/dev/null || echo unknown)"
REPO_ROOT="$(cd "$IMPL_DIR/.." && pwd)"

# The manifests deploy.sh applies, in dependency order. Every one of them goes
# through render_manifest, so a name that is not NAME_PLACEHOLDER-based would
# silently belong to every instance at once.
MANIFESTS=(rbac.yaml networkpolicy-sandbox.yaml postgres.yaml pvc-sessions.yaml services.yaml route.yaml deployment-scanner.yaml deployment-api.yaml deployment-web.yaml)

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

print_usage() {
    echo "Usage: PROJECT=<project> [INSTANCE=<name>] ./deploy.sh [secrets|manifests|api|web|poc-runner|scanner|all|pin [tag]|signin|signin-off|verify|render <file>]"
    echo ""
    echo "  secrets    Apply secrets.yaml (untracked) for this instance"
    echo "  manifests  Apply db + PVCs + services + route + deployments"
    echo "  api        Build, push and roll out $API_DEPLOYMENT"
    echo "  web        Build, push and roll out $WEB_DEPLOYMENT"
    echo "  poc-runner Build and push $POC_RUNNER_IMAGE and point the api at it (restarts the api)"
    echo "  scanner    Build and push $SCANNER_DEPLOYMENT, apply and roll it out (upload malware check)"
    echo "  all        manifests, then poc-runner, api and web"
    echo "  pin [tag]  Pin every image of this stack by digest to what runs now (or api and web to <tag>)"
    echo "  signin     Put the Keycloak sign-in proxy in front of $WEB_DEPLOYMENT (signin-proxy.yaml)"
    echo "  signin-off Point the Route straight at $WEB_DEPLOYMENT again, back to its own sign-in"
    echo "  verify     Show route, images, api env and recent api logs"
    echo "  render <f> Print manifest <f> with project and instance substituted"
    echo ""
    echo "  INSTANCE empty -> the staging stack (wizard-v2-*)."
    echo "  INSTANCE=s4    -> a second stack (wizard-v2-s4-*) in the same project."
}

require_project() {
    if [ -z "$PROJECT" ]; then
        echo -e "${RED}Error: PROJECT env var is required (export PROJECT=<staging-project>)${NC}"
        exit 1
    fi
}

require_valid_instance() {
    # Empty is the staging stack. Anything else becomes part of DNS-1123 names
    # (Services, the Route host), so it must be a lowercase label fragment.
    if [ -n "$INSTANCE" ] && ! [[ "$INSTANCE" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
        echo -e "${RED}Error: INSTANCE='$INSTANCE' is not a valid name fragment (lowercase letters, digits, dashes; e.g. s4)${NC}"
        exit 1
    fi
}

check_oc_login() {
    if ! oc whoami &> /dev/null; then
        echo -e "${RED}Error: not logged in to OpenShift${NC}"
        echo "Run: oc login https://api.2.rahti.csc.fi:6443"
        exit 1
    fi
    echo -e "${GREEN}Logged in as: $(oc whoami) — project: $PROJECT — instance: $NAME${NC}"
}

# The deployed images carry APP_VERSION from `git describe`, and the login page
# shows it. That only means something if the commit exists somewhere other than
# the machine that built it: a customer test once reported build ce53774, which
# is in no branch of this repository, so nobody could tell what had been running.
# `--dirty` does not catch that case — the tree was clean, the commit was simply
# never pushed.
require_pushed_commit() {
    local head dirty remote_refs
    head="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
    if [ -z "$head" ]; then
        echo -e "${RED}Error: not a git checkout — refusing to build an image nobody can trace${NC}"
        exit 1
    fi

    dirty="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)"
    if [ -n "$dirty" ]; then
        echo -e "${RED}Error: the working tree has uncommitted changes.${NC}"
        echo "  The image would be built from something that exists only here."
        echo "  Commit and push first, or stash."
        exit 1
    fi

    git -C "$REPO_ROOT" fetch --quiet origin 2>/dev/null || true
    remote_refs="$(git -C "$REPO_ROOT" branch -r --contains "$head" 2>/dev/null)"
    if [ -z "$remote_refs" ]; then
        echo -e "${RED}Error: HEAD ($(git -C "$REPO_ROOT" rev-parse --short HEAD)) is not on any remote branch.${NC}"
        echo "  The login page would report a version nobody else can resolve,"
        echo "  which is exactly what happened with ce53774."
        echo "  Push the branch first."
        exit 1
    fi

    echo -e "${GREEN}Building $APP_VERSION from a pushed commit${NC}"
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

render_manifest() {
    # Substitute the image-registry project and the instance name prefix.
    # The same two placeholders appear in secrets.yaml(.example).
    sed -e "s/PROJECT_PLACEHOLDER/$PROJECT/g" -e "s/NAME_PLACEHOLDER/$NAME/g" "$1"
}

apply_manifest() {
    render_manifest "$SCRIPT_DIR/$1" | oc apply -n "$PROJECT" -f -
}

# --- Images by digest ---------------------------------------------------------
# A Deployment names its image by digest, never by :latest. With :latest, any
# pod restart (a node drain, an eviction, an out-of-memory kill) starts whatever
# was pushed last, which may be an s4 build that was never tested on this stack.
# A digest keeps the pod on the image that was rolled out until the next deploy.

# The digest an image stream tag of this project points at.
image_digest() {  # <repository> <tag>
    local digest
    digest="$(oc get istag "$1:$2" -n "$PROJECT" -o jsonpath='{.image.metadata.name}' 2>/dev/null || true)"
    case "$digest" in
        sha256:*) echo "$digest" ;;
        *) echo -e "${RED}Error: no image $1:$2 in project $PROJECT${NC}" >&2; return 1 ;;
    esac
}

# registry/project/repository:tag (or @digest) -> repository
image_repository() {
    local ref="${1%@*}"
    ref="${ref##*/}"
    echo "${ref%%:*}"
}

# registry/project/repository:tag -> tag (latest when there is none)
image_tag() {
    local ref="${1##*/}"
    case "$ref" in *@*) return 1 ;; *:*) echo "${ref##*:}" ;; *) echo latest ;; esac
}

pinned_ref() {  # <repository> <digest>
    echo "$REGISTRY/$PROJECT/$1@$2"
}

# The digest the running pods of a Deployment started from, for one container.
# Pods that disagree (a rollout still going) are refused rather than guessed.
running_digest() {  # <deployment> <container>
    local ids
    ids="$(oc get pods -n "$PROJECT" -l "app=$1" --field-selector=status.phase=Running \
        -o jsonpath="{range .items[*]}{.status.containerStatuses[?(@.name==\"$2\")].imageID}{\"\\n\"}{end}" \
        2>/dev/null | grep . | sed 's/.*@//' | sort -u || true)"
    case "$ids" in
        *"$NL"*|"") ;;      # several images, or none
        sha256:*) echo "$ids"; return 0 ;;
    esac
    if [ -z "$ids" ]; then
        echo -e "${RED}Error: no running pod of deployment/$1 with container $2${NC}" >&2
    else
        echo -e "${RED}Error: the pods of deployment/$1 run different images; wait for its rollout${NC}" >&2
    fi
    return 1
}

# The repository a Deployment's container names now (its own, or another
# stack's when it was set by hand).
current_repository() {  # <deployment> <container>
    local image
    image="$(oc get "deployment/$1" -n "$PROJECT" \
        -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$2\")].image}" 2>/dev/null || true)"
    [ -n "$image" ] || { echo -e "${RED}Error: deployment/$1 has no container $2${NC}" >&2; return 1; }
    image_repository "$image"
}

# A digest a Deployment can be pinned to: a digest, and in that image stream,
# or the next pod cannot pull it.
pinnable() {  # <deployment> <repository> <digest>
    case "$3" in sha256:*) ;; *) echo -e "${RED}Error: no digest to pin deployment/$1 to${NC}" >&2; return 1 ;; esac
    oc get isimage "$2@$3" -n "$PROJECT" >/dev/null 2>&1 \
        || { echo -e "${RED}Error: $2@$3 is not in project $PROJECT${NC}" >&2; return 1; }
}

# Points every container of a Deployment at one digest and waits for the
# rollout. A digest it already runs changes nothing. The api's
# WIZARD_POC_RUNNER_IMAGE can be pinned in the same rollout (one restart).
pin_deployment() {  # <deployment> <repository> <digest> [runner image ref]
    local d="$1" repo="$2" ref runner="${4:-}"
    pinnable "$d" "$repo" "$3" || return 1
    ref="$(pinned_ref "$repo" "$3")"
    echo -e "${YELLOW}Pinning deployment/$d to $ref${NC}"
    oc rollout pause "deployment/$d" -n "$PROJECT" >/dev/null
    # An interrupted deploy must not leave the Deployment paused.
    trap 'oc rollout resume "deployment/'"$d"'" -n "'"$PROJECT"'" >/dev/null 2>&1; exit 130' INT TERM
    if ! { oc set image "deployment/$d" -n "$PROJECT" "*=$ref" >/dev/null \
        && { [ -z "$runner" ] || oc set env "deployment/$d" -n "$PROJECT" -c "$d" \
            "WIZARD_POC_RUNNER_IMAGE=$runner" >/dev/null; }; }; then
        oc rollout resume "deployment/$d" -n "$PROJECT" >/dev/null
        trap - INT TERM
        echo -e "${RED}Error: could not pin deployment/$d${NC}" >&2
        return 1
    fi
    oc rollout resume "deployment/$d" -n "$PROJECT" >/dev/null
    trap - INT TERM
    oc rollout status "deployment/$d" -n "$PROJECT" --timeout=300s
}

# The sandbox runner image the api names now, by digest: the repository it
# names (which may be another stack's, see README), at the tag it names.
runner_by_digest() {
    local current repo tag digest
    current="$(oc get "deployment/$API_DEPLOYMENT" -n "$PROJECT" \
        -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$API_DEPLOYMENT\")].env[?(@.name==\"WIZARD_POC_RUNNER_IMAGE\")].value}" 2>/dev/null || true)"
    [ -n "$current" ] || current="$REGISTRY/$PROJECT/$POC_RUNNER_IMAGE:latest"
    repo="$(image_repository "$current")"
    if ! tag="$(image_tag "$current")"; then
        echo "$current"     # already a digest
        return 0
    fi
    digest="$(image_digest "$repo" "$tag")" || return 1
    pinned_ref "$repo" "$digest"
}

deployment_exists() {
    oc get "deployment/$1" -n "$PROJECT" >/dev/null 2>&1
}

# Applying a deployment manifest (which names :latest) keeps the digests the
# live Deployment names: the manifest's own image and the api's runner are
# replaced by the live values. Text substitution, so the Service beside the
# Deployment in the same file passes through untouched.
live_value() {  # <deployment> <jsonpath>
    oc get "deployment/$1" -n "$PROJECT" -o jsonpath="$2" 2>/dev/null || true
}

keep_live_images() {  # <deployment>; manifest on stdin, manifest on stdout
    local d="$1" image runner script=()
    image="$(live_value "$d" "{.spec.template.spec.containers[0].image}")"
    case "$image" in
        *@sha256:*) script+=(-e "s|$REGISTRY/$PROJECT/$d:latest|$image|g") ;;
    esac
    if [ "$d" = "$API_DEPLOYMENT" ]; then
        runner="$(live_value "$d" "{.spec.template.spec.containers[?(@.name==\"$d\")].env[?(@.name==\"WIZARD_POC_RUNNER_IMAGE\")].value}")"
        case "$runner" in
            *@sha256:*) script+=(-e "s|$REGISTRY/$PROJECT/$POC_RUNNER_IMAGE:latest|$runner|g") ;;
        esac
    fi
    if [ ${#script[@]} -eq 0 ]; then cat; else sed "${script[@]}"; fi
}

# Pins each Deployment of this stack to the image its running pod started from,
# and the sandbox runner to the digest its tag names now. Nothing new is pulled:
# what runs now is what keeps running after a restart. With a tag, the api and
# the web app go to that image stream tag instead (a rollback, for example
# pre-<version>-<date>); the runner and the scanner stay where they are.
pin_stack() {  # [tag]
    # Every digest is looked up and checked before any Deployment changes, so a
    # missing tag or a pod mid-rollout stops the script with the stack as it was.
    local tag="${1:-}" runner api_repo api_digest web_repo web_digest scan_repo="" scan_digest=""
    runner="$(runner_by_digest)" || exit 1
    api_repo="$(current_repository "$API_DEPLOYMENT" "$API_DEPLOYMENT")" || exit 1
    web_repo="$(current_repository "$WEB_DEPLOYMENT" "$WEB_DEPLOYMENT")" || exit 1
    if [ -n "$tag" ]; then
        api_digest="$(image_digest "$api_repo" "$tag")" || exit 1
        web_digest="$(image_digest "$web_repo" "$tag")" || exit 1
    else
        api_digest="$(running_digest "$API_DEPLOYMENT" "$API_DEPLOYMENT")" || exit 1
        web_digest="$(running_digest "$WEB_DEPLOYMENT" "$WEB_DEPLOYMENT")" || exit 1
    fi
    pinnable "$API_DEPLOYMENT" "$api_repo" "$api_digest" || exit 1
    pinnable "$WEB_DEPLOYMENT" "$web_repo" "$web_digest" || exit 1
    if deployment_exists "$SCANNER_DEPLOYMENT"; then
        scan_repo="$(current_repository "$SCANNER_DEPLOYMENT" clamd)" || exit 1
        scan_digest="$(running_digest "$SCANNER_DEPLOYMENT" clamd)" || exit 1
        pinnable "$SCANNER_DEPLOYMENT" "$scan_repo" "$scan_digest" || exit 1
    fi
    pin_deployment "$API_DEPLOYMENT" "$api_repo" "$api_digest" "$runner" || exit 1
    pin_deployment "$WEB_DEPLOYMENT" "$web_repo" "$web_digest" || exit 1
    if [ -n "$scan_repo" ]; then
        pin_deployment "$SCANNER_DEPLOYMENT" "$scan_repo" "$scan_digest" || exit 1
    fi
    show_images
}

show_images() {
    local d line unpinned=0
    echo -e "${YELLOW}Images:${NC}"
    for d in "$API_DEPLOYMENT" "$WEB_DEPLOYMENT" "$SCANNER_DEPLOYMENT"; do
        deployment_exists "$d" || continue
        while IFS= read -r line; do
            echo "  $d/$line"
            case "$line" in *@sha256:*) ;; *) unpinned=1 ;; esac
        done < <(oc get "deployment/$d" -n "$PROJECT" \
            -o jsonpath='{range .spec.template.spec.containers[*]}{.name}={.image}{"\n"}{end}')
    done
    line="$(oc get "deployment/$API_DEPLOYMENT" -n "$PROJECT" \
        -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$API_DEPLOYMENT\")].env[?(@.name==\"WIZARD_POC_RUNNER_IMAGE\")].value}" 2>/dev/null || true)"
    echo "  sandbox runner=${line:-(not set)}"
    case "$line" in *@sha256:*) ;; *) unpinned=1 ;; esac
    if [ "$unpinned" = 1 ]; then
        echo -e "${RED}  Not every image is pinned by digest: run ./deploy.sh pin${NC}"
    fi
}

deploy_secrets() {
    local f="$SCRIPT_DIR/secrets.yaml"
    if [ ! -f "$f" ]; then
        echo -e "${RED}Error: $f not found (cp secrets.yaml.example secrets.yaml and fill it in)${NC}"
        exit 1
    fi
    echo -e "${YELLOW}Applying secrets for $NAME to project $PROJECT...${NC}"
    apply_manifest secrets.yaml
    echo -e "${GREEN}Secrets applied.${NC}"
}

deploy_manifests() {
    echo -e "${YELLOW}Applying manifests for $NAME to project $PROJECT...${NC}"
    local m signin=0
    # A stack whose sign-in goes through Keycloak keeps it: its Route stays on the
    # proxy, and the web app's sign-in settings, which deployment-web.yaml lacks,
    # are set again after it is applied.
    signin_enabled && signin=1
    for m in "${MANIFESTS[@]}"; do
        if [ "$m" = route.yaml ] && [ "$signin" = 1 ]; then m=route-signin.yaml; fi
        if [ "$m" = deployment-web.yaml ] && [ "$signin" = 1 ]; then
            # The web app's manifest with the sign-in settings already in it, so
            # it rolls out once and never runs with the dev login behind the proxy.
            local env=() line
            while IFS= read -r line; do env+=("$line"); done < <(signin_env)  # no mapfile in macOS bash 3.2
            render_manifest "$SCRIPT_DIR/$m" | oc set env --local -f - "${env[@]}" -o yaml \
                | keep_live_images "$WEB_DEPLOYMENT" | oc apply -n "$PROJECT" -f -
            continue
        fi
        case "$m" in
            deployment-api.yaml) render_manifest "$SCRIPT_DIR/$m" | keep_live_images "$API_DEPLOYMENT" | oc apply -n "$PROJECT" -f - ; continue ;;
            deployment-web.yaml) render_manifest "$SCRIPT_DIR/$m" | keep_live_images "$WEB_DEPLOYMENT" | oc apply -n "$PROJECT" -f - ; continue ;;
            deployment-scanner.yaml) render_manifest "$SCRIPT_DIR/$m" | keep_live_images "$SCANNER_DEPLOYMENT" | oc apply -n "$PROJECT" -f - ; continue ;;
        esac
        apply_manifest "$m"
    done
    echo -e "${GREEN}Manifests applied. (Ensure ./deploy.sh secrets has run for this instance.)${NC}"
}

deploy_api() {
    ensure_registry_login
    ensure_buildx_builder
    # Build context is implementation_layer/ because the Dockerfile COPYs both
    # wizard_api/ and solution_wizard/ (BPMN generation).
    echo -e "${YELLOW}Building and pushing $API_DEPLOYMENT ($APP_VERSION)...${NC}"
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
    # The new build by its digest, and in the same rollout the runner: the one
    # `all` has just pushed, or else the digest the api's runner tag names now.
    local digest runner="${NEW_RUNNER_REF:-}"
    digest="$(image_digest "$API_DEPLOYMENT" "$APP_VERSION")" || exit 1
    if [ -z "$runner" ] && ! runner="$(runner_by_digest)"; then
        echo -e "${YELLOW}The sandbox runner is left as it is: build it with ./deploy.sh poc-runner${NC}"
        runner=""
    fi
    pin_deployment "$API_DEPLOYMENT" "$API_DEPLOYMENT" "$digest" "$runner"
    echo -e "${GREEN}$API_DEPLOYMENT deployed${NC}"
}

deploy_poc_runner() {
    ensure_registry_login
    ensure_buildx_builder
    # Build context is the poc-runner dir alone: the image installs gaik from
    # PyPI at a pinned version, so it needs no source from this repo.
    echo -e "${YELLOW}Building and pushing $POC_RUNNER_IMAGE ($APP_VERSION)...${NC}"
    docker buildx build \
        --platform linux/amd64 \
        --provenance=false \
        --output type=registry,oci-mediatypes=false \
        -t "$REGISTRY/$PROJECT/$POC_RUNNER_IMAGE:latest" \
        -t "$REGISTRY/$PROJECT/$POC_RUNNER_IMAGE:$APP_VERSION" \
        "$IMPL_DIR/deploy/poc-runner"
    local digest
    digest="$(image_digest "$POC_RUNNER_IMAGE" "$APP_VERSION")" || exit 1
    NEW_RUNNER_REF="$(pinned_ref "$POC_RUNNER_IMAGE" "$digest")"
    echo -e "${GREEN}$POC_RUNNER_IMAGE pushed: $NEW_RUNNER_REF${NC}"
    # `all` pins it with the api's own rollout; on its own, the api restarts
    # once to take the new runner.
    if [ "${1:-}" != nopin ] && deployment_exists "$API_DEPLOYMENT"; then
        local repo
        repo="$(current_repository "$API_DEPLOYMENT" "$API_DEPLOYMENT")" || exit 1
        digest="$(running_digest "$API_DEPLOYMENT" "$API_DEPLOYMENT")" || exit 1
        pin_deployment "$API_DEPLOYMENT" "$repo" "$digest" "$NEW_RUNNER_REF"
    fi
}

deploy_scanner() {
    ensure_registry_login
    ensure_buildx_builder
    # The build downloads the current ClamAV signatures into the image, so a
    # new pod scans before its first update; rebuild now and then to keep that
    # starting point fresh.
    echo -e "${YELLOW}Building and pushing $SCANNER_DEPLOYMENT ($APP_VERSION)...${NC}"
    docker buildx build \
        --platform linux/amd64 \
        --provenance=false \
        --output type=registry,oci-mediatypes=false \
        -t "$REGISTRY/$PROJECT/$SCANNER_DEPLOYMENT:latest" \
        -t "$REGISTRY/$PROJECT/$SCANNER_DEPLOYMENT:$APP_VERSION" \
        "$IMPL_DIR/deploy/scanner"
    # Its own manifest only: applying it touches no other deployment.
    render_manifest "$SCRIPT_DIR/deployment-scanner.yaml" | keep_live_images "$SCANNER_DEPLOYMENT" \
        | oc apply -n "$PROJECT" -f -
    local digest
    digest="$(image_digest "$SCANNER_DEPLOYMENT" "$APP_VERSION")" || exit 1
    pin_deployment "$SCANNER_DEPLOYMENT" "$SCANNER_DEPLOYMENT" "$digest"
    echo -e "${GREEN}$SCANNER_DEPLOYMENT deployed. Point the api at it (once):"
    echo -e "  oc set env deployment/$API_DEPLOYMENT -c $API_DEPLOYMENT WIZARD_MALWARE_SCANNER=$SCANNER_DEPLOYMENT:3310${NC}"
}

deploy_web() {
    ensure_registry_login
    ensure_buildx_builder
    # NEXT_PUBLIC_* must be baked in at build time — pass them as build args.
    echo -e "${YELLOW}Building and pushing $WEB_DEPLOYMENT ($APP_VERSION)...${NC}"
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
    local digest
    digest="$(image_digest "$WEB_DEPLOYMENT" "$APP_VERSION")" || exit 1
    pin_deployment "$WEB_DEPLOYMENT" "$WEB_DEPLOYMENT" "$digest"
    echo -e "${GREEN}$WEB_DEPLOYMENT deployed${NC}"
}

# --- Sign-in through Keycloak (deploy/keycloak, signin-proxy.yaml) ----------
SIGNIN_DEPLOYMENT="$NAME-signin"
KEYCLOAK_HOST="gaik-keycloak-${PROJECT}.2.rahtiapp.fi"
WEB_HOST="${WEB_DEPLOYMENT}-${PROJECT}.2.rahtiapp.fi"

signin_enabled() {
    oc get deployment "$SIGNIN_DEPLOYMENT" -n "$PROJECT" >/dev/null 2>&1
}

signin_env() {
    # The web app checks the forwarded token itself (lib/proxy-auth.ts). The
    # keys come from Keycloak's Service; the issuer is its public address.
    # The sign-in proxy is one more hop in X-Forwarded-For after the router.
    # Sign-out goes to the proxy's /oauth2/sign_out, which also ends the
    # Keycloak session (--backend-logout-url in signin-proxy.yaml). The dev
    # account list has no use behind the proxy and is removed.
    printf '%s\n' \
        WIZARD_AUTH_MODE=proxy \
        "WIZARD_OIDC_ISSUER=https://$KEYCLOAK_HOST/realms/gaik" \
        "WIZARD_OIDC_JWKS_URL=http://gaik-keycloak:8080/realms/gaik/protocol/openid-connect/certs" \
        "WIZARD_OIDC_CLIENT_ID=$NAME" \
        WIZARD_OIDC_GROUP=wizard-user \
        WIZARD_TRUSTED_PROXY_HOPS=2 \
        WIZARD_DEV_USERS-
}

set_signin_env() {
    local env=() line
    while IFS= read -r line; do env+=("$line"); done < <(signin_env)  # no mapfile in macOS bash 3.2
    oc set env "deployment/$WEB_DEPLOYMENT" -n "$PROJECT" "${env[@]}" >/dev/null
}

deploy_signin() {
    if ! oc get secret "$SIGNIN_DEPLOYMENT" -n "$PROJECT" >/dev/null 2>&1; then
        echo -e "${RED}Error: Secret $SIGNIN_DEPLOYMENT is missing. Register the stack in Keycloak first:${NC}"
        echo "  PROJECT=$PROJECT ../keycloak/deploy.sh add-client $NAME https://$WEB_HOST"
        exit 1
    fi
    # The proxy's pages (signin-templates/). A user the proxy turned away has no
    # proxy session to end, so the waiting page signs out at Keycloak itself.
    local sign_out="https://$KEYCLOAK_HOST/realms/gaik/protocol/openid-connect/logout?client_id=$NAME\&amp;post_logout_redirect_uri=https%3A%2F%2F$WEB_HOST%2F"
    sed -e "s#SIGN_OUT_URL_PLACEHOLDER#$sign_out#g" "$SCRIPT_DIR/signin-templates/error.html" \
        | oc create configmap "$SIGNIN_DEPLOYMENT-templates" -n "$PROJECT" --from-file=error.html=/dev/stdin \
            --dry-run=client -o yaml | oc apply -n "$PROJECT" -f -
    # Proxy first, then the Route, then the web app: at no point does the Route
    # lead to a web app that expects a proxy that is not there.
    apply_manifest signin-proxy.yaml
    # oauth2-proxy reads its pages when it starts: a changed page needs a restart.
    oc rollout restart "deployment/$SIGNIN_DEPLOYMENT" -n "$PROJECT" >/dev/null
    oc rollout status "deployment/$SIGNIN_DEPLOYMENT" -n "$PROJECT" --timeout=300s
    apply_manifest route-signin.yaml
    set_signin_env
    oc rollout status "deployment/$WEB_DEPLOYMENT" -n "$PROJECT" --timeout=300s
    echo -e "${GREEN}Sign-in for $NAME now goes through Keycloak: https://$WEB_HOST${NC}"
}

remove_signin() {
    apply_manifest route.yaml
    oc set env "deployment/$WEB_DEPLOYMENT" -n "$PROJECT" WIZARD_AUTH_MODE- WIZARD_OIDC_ISSUER- \
        WIZARD_OIDC_JWKS_URL- WIZARD_OIDC_CLIENT_ID- WIZARD_OIDC_GROUP- WIZARD_OIDC_LOGOUT_URL- \
        WIZARD_TRUSTED_PROXY_HOPS=1 >/dev/null
    oc rollout status "deployment/$WEB_DEPLOYMENT" -n "$PROJECT" --timeout=300s
    # Removed, not scaled down: `manifests` keys on the proxy's Deployment.
    # The Secret and the Keycloak client stay, so `signin` can turn it on again.
    oc delete deployment,service "$SIGNIN_DEPLOYMENT" -n "$PROJECT" --ignore-not-found >/dev/null
    oc delete configmap "$SIGNIN_DEPLOYMENT-templates" -n "$PROJECT" --ignore-not-found >/dev/null
    echo -e "${GREEN}$NAME uses its own sign-in again; $SIGNIN_DEPLOYMENT removed.${NC}"
}

verify() {
    echo -e "${YELLOW}Route:${NC}";    oc get route "$WEB_DEPLOYMENT" -n "$PROJECT"
    show_images
    echo -e "${YELLOW}API env:${NC}";  oc set env deployment/$API_DEPLOYMENT --list -n "$PROJECT"
    echo -e "${YELLOW}API version (baked into the image, GET /health):${NC}"
    oc exec "deployment/$API_DEPLOYMENT" -n "$PROJECT" -- \
        python3 -c "import urllib.request,sys; sys.stdout.write(urllib.request.urlopen('http://localhost:8100/health').read().decode())" \
        2>/dev/null || echo "  (could not reach /health inside the pod)"
    echo -e "${YELLOW}API logs:${NC}"; oc logs deployment/$API_DEPLOYMENT -n "$PROJECT" --tail=40 || true
}

[ $# -eq 0 ] && { print_usage; exit 1; }
require_project
require_valid_instance

# `render` needs no cluster: it is what the manifest tests and a curious
# operator use to see exactly what `manifests` / `secrets` would apply.
if [ "$1" = "render" ]; then
    [ $# -eq 2 ] || { print_usage; exit 1; }
    render_manifest "$SCRIPT_DIR/$2"
    exit 0
fi

check_oc_login

case "$1" in
    secrets)    deploy_secrets ;;
    manifests)  deploy_manifests ;;
    api)        check_docker; require_pushed_commit; deploy_api ;;
    web)        check_docker; require_pushed_commit; deploy_web ;;
    poc-runner) check_docker; require_pushed_commit; deploy_poc_runner ;;
    scanner)    check_docker; require_pushed_commit; deploy_scanner ;;
    all)        check_docker; require_pushed_commit; deploy_scanner; deploy_manifests; deploy_poc_runner nopin; deploy_api; deploy_web ;;
    pin)        [ $# -le 2 ] || { print_usage; exit 1; }; pin_stack "${2:-}" ;;
    signin)     deploy_signin ;;
    signin-off) remove_signin ;;
    verify)     verify ;;
    *)          print_usage; exit 1 ;;
esac

echo -e "${GREEN}Done!${NC}"
