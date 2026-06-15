#!/usr/bin/env bash
#
# Secure, idempotent deploy of the "Gamifying World Improvement" game server to
# Azure Container Apps via the Azure CLI.
#
# Security model (open-source safe):
#   * Secrets are read at deploy time from the GITIGNORED submission/.env. They
#     are NEVER printed, committed, or baked into the image.
#   * submission/.dockerignore + the explicit COPY allowlist in the Dockerfile
#     keep .env and prior-run state out of the registry build entirely.
#   * Every .env value is pushed as an encrypted Container App *secret* and the
#     container reads it via `secretref:` — nothing sensitive appears in the
#     plaintext app template / `az containerapp show` output.
#
# Prereqs: `az login` (done), the `containerapp` az extension (auto-installed
# below). No local Docker required — the image is built remotely by ACR.
#
# Usage:
#   submission/deploy/deploy_container_app.sh
# Override any of these via environment:
#   RESOURCE_GROUP, LOCATION, ACR_NAME, ENVIRONMENT, APP_NAME, DEPLOY_DEMO_MODE
set -euo pipefail

# --- Resolve paths ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBMISSION_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SUBMISSION_DIR}/.env"

# --- Configurable names (safe, non-secret defaults) ------------------------
RESOURCE_GROUP="${RESOURCE_GROUP:-agentsleague-creative-rg}"
LOCATION="${LOCATION:-eastus2}"
# ACR names must be globally unique, 5-50 lowercase alphanumerics.
ACR_NAME="${ACR_NAME:-aglcreative$(echo "${RANDOM}${RANDOM}" | cut -c1-8)}"
ENVIRONMENT="${ENVIRONMENT:-agentsleague-cae}"
APP_NAME="${APP_NAME:-worldforge-game}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
IMAGE_REPO="worldforge"
TARGET_PORT=8000

echo "==> Deploy config"
echo "    Resource group : ${RESOURCE_GROUP}"
echo "    Location       : ${LOCATION}"
echo "    ACR            : ${ACR_NAME}"
echo "    Environment    : ${ENVIRONMENT}"
echo "    App            : ${APP_NAME}"
echo "    Image          : ${IMAGE_REPO}:${IMAGE_TAG}"

# --- Validate .env (without revealing it) ----------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found. Copy submission/.env.example to .env and fill it." >&2
  exit 1
fi

# --- Build secret + env-ref lists from .env --------------------------------
# Each non-empty KEY=VALUE becomes an encrypted secret 's-<key>' plus an env var
# 'KEY=secretref:s-<key>'. Keys in SKIP_KEYS are handled explicitly below.
declare -a SECRETS=()
declare -a ENV_REFS=()
SKIP_KEYS=("PORT")

normalize() { echo "$1" | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-'; }
in_skip() { local k; for k in "${SKIP_KEYS[@]}"; do [[ "$1" == "$k" ]] && return 0; done; return 1; }

while IFS= read -r line || [[ -n "$line" ]]; do
  # Strip CR, skip comments / blanks.
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" != *=* ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  key="$(echo -n "$key" | tr -d '[:space:]')"
  # Skip empty values and explicit skip keys.
  [[ -z "$val" ]] && continue
  in_skip "$key" && continue
  sname="s-$(normalize "$key")"
  SECRETS+=("${sname}=${val}")
  ENV_REFS+=("${key}=secretref:${sname}")
done < "${ENV_FILE}"

# DEMO_MODE: respect .env unless DEPLOY_DEMO_MODE overrides it.
if [[ -n "${DEPLOY_DEMO_MODE:-}" ]]; then
  ENV_REFS=("${ENV_REFS[@]/#DEMO_MODE=secretref:*/}")  # drop any DEMO_MODE ref
  ENV_REFS+=("DEMO_MODE=${DEPLOY_DEMO_MODE}")
fi
# PORT is a fixed, non-secret platform value.
ENV_REFS+=("PORT=${TARGET_PORT}")

echo "==> Injecting ${#SECRETS[@]} secret(s) from .env (values hidden)."

# --- Provision (idempotent) ------------------------------------------------
echo "==> Ensuring az containerapp extension"
az extension add --name containerapp --upgrade --only-show-errors 1>/dev/null
az provider register --namespace Microsoft.App --wait 1>/dev/null || true
az provider register --namespace Microsoft.OperationalInsights --wait 1>/dev/null || true

echo "==> Resource group"
az group create -n "${RESOURCE_GROUP}" -l "${LOCATION}" --only-show-errors 1>/dev/null

echo "==> Azure Container Registry"
if ! az acr show -n "${ACR_NAME}" -g "${RESOURCE_GROUP}" --only-show-errors 1>/dev/null 2>&1; then
  az acr create -n "${ACR_NAME}" -g "${RESOURCE_GROUP}" --sku Basic \
    --admin-enabled true --only-show-errors 1>/dev/null
fi

echo "==> Building image remotely in ACR (no local Docker needed)"
az acr build \
  --registry "${ACR_NAME}" \
  --image "${IMAGE_REPO}:${IMAGE_TAG}" \
  --file "${SUBMISSION_DIR}/Dockerfile" \
  "${SUBMISSION_DIR}" \
  --only-show-errors 1>/dev/null
IMAGE="${ACR_NAME}.azurecr.io/${IMAGE_REPO}:${IMAGE_TAG}"

echo "==> Container Apps environment"
if ! az containerapp env show -n "${ENVIRONMENT}" -g "${RESOURCE_GROUP}" --only-show-errors 1>/dev/null 2>&1; then
  az containerapp env create -n "${ENVIRONMENT}" -g "${RESOURCE_GROUP}" \
    -l "${LOCATION}" --only-show-errors 1>/dev/null
fi

echo "==> Deploying container app"
if az containerapp show -n "${APP_NAME}" -g "${RESOURCE_GROUP}" --only-show-errors 1>/dev/null 2>&1; then
  az containerapp secret set -n "${APP_NAME}" -g "${RESOURCE_GROUP}" \
    --secrets "${SECRETS[@]}" --only-show-errors 1>/dev/null
  az containerapp update -n "${APP_NAME}" -g "${RESOURCE_GROUP}" \
    --image "${IMAGE}" \
    --set-env-vars "${ENV_REFS[@]}" --only-show-errors 1>/dev/null
else
  az containerapp create -n "${APP_NAME}" -g "${RESOURCE_GROUP}" \
    --environment "${ENVIRONMENT}" \
    --image "${IMAGE}" \
    --registry-server "${ACR_NAME}.azurecr.io" \
    --target-port "${TARGET_PORT}" \
    --ingress external \
    --min-replicas 0 --max-replicas 1 \
    --cpu 1 --memory 2Gi \
    --secrets "${SECRETS[@]}" \
    --env-vars "${ENV_REFS[@]}" \
    --only-show-errors 1>/dev/null
fi

FQDN="$(az containerapp show -n "${APP_NAME}" -g "${RESOURCE_GROUP}" \
  --query properties.configuration.ingress.fqdn -o tsv)"
echo ""
echo "==> Deployed. Live URL:"
echo "    https://${FQDN}/"
echo ""
echo "Tear down everything with:"
echo "    az group delete -n ${RESOURCE_GROUP} --yes --no-wait"
