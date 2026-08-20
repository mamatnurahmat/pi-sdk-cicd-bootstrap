#!/usr/bin/env bash
# ============================================================================
# run.sh — jalankan pi-sdk-cicd-bootstrap via Docker (single command)
# ============================================================================
# Memakai image multi-platform newrahmat/pi-sdk-cicd-bootstrap:0.1.0
# (linux/amd64 + linux/arm64 — cocok untuk Mac & node cluster amd64).
#
# Usage (satu perintah):
#   ./run.sh --repo pay-be-audittrail-module --branch develop --dry-run true
#   ./run.sh --repo plus-be-merchantpg-manager --branch develop --type be --port 3011 --lang go
#
# Credentials (env):
#   PI_MOUNT_AUTH=1          mount ~/.pi/agent → /etc/pi/agent (LLM auth + models)
#   PI_MOUNT_WORKSPACE=1     mount $(pwd) → /workspace (agar agent bisa edit file lokal)
#   PI_FORWARD_CREDS=1       forward GITHUB_*, DOCKERHUB_*, WEBHOOK_TRIGGER_* ke container
#
# Optional env:
#   PI_IMAGE        default: newrahmat/pi-sdk-cicd-bootstrap:0.1.0
#   PI_PLATFORM     default: linux/amd64 (cocok untuk amd64; Mac pakai linux/arm64)
# ============================================================================
set -euo pipefail

PI_IMAGE="${PI_IMAGE:-newrahmat/pi-sdk-cicd-bootstrap:0.1.0}"
PI_PLATFORM="${PI_PLATFORM:-linux/amd64}"
PI_MOUNT_AUTH="${PI_MOUNT_AUTH:-0}"
PI_MOUNT_WORKSPACE="${PI_MOUNT_WORKSPACE:-0}"
PI_FORWARD_CREDS="${PI_FORWARD_CREDS:-0}"

# ── Banner ───────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  🐳 pi-sdk-cicd-bootstrap — Docker single command        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Image    : ${PI_IMAGE}"
echo "║  Platform : ${PI_PLATFORM}"
echo "║  LLM auth : $([ "$PI_MOUNT_AUTH" = "1" ] && echo 'mount ~/.pi/agent' || echo 'tidak (dry-run)')"
echo "║  Workspace: $([ "$PI_MOUNT_WORKSPACE" = "1" ] && echo 'mount $(pwd)' || echo 'tidak')"
echo "║  Creds    : $([ "$PI_FORWARD_CREDS" = "1" ] && echo 'forward GITHUB_*/DOCKERHUB_*/WEBHOOK_*' || echo 'tidak')"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Siapkan argumen docker ───────────────────────────────────────────────
DOCKER_ARGS=(run --rm --platform "${PI_PLATFORM}")

# 1) Mount auth pi (~/.pi/agent) — untuk agent mode penuh (LLM)
if [ "$PI_MOUNT_AUTH" = "1" ]; then
  # ModelRuntime butuh tulis lock file (auth.json.lock) → mount read-write
  DOCKER_ARGS+=(
    -e PI_AGENT_DIR=/etc/pi/agent
    -e PI_AUTH_PATH=/etc/pi/agent/auth.json
    -e PI_MODELS_PATH=/etc/pi/agent/models.json
    -v "${HOME}/.pi/agent:/etc/pi/agent"
  )
  echo "📎 LLM auth : ~/.pi/agent → /etc/pi/agent (rw utk lock)"
fi

# 2) Mount workspace — agar agent bisa clone/edit repo di folder lokal.
# Catatan: JANGAN pakai -w /workspace (node akan resolve node_modules host,
# bukan dari image → esbuild platform mismatch). Cwd tetap /app; agent
# mengakses workspace via /workspace (tools bash/read/write).
if [ "$PI_MOUNT_WORKSPACE" = "1" ]; then
  DOCKER_ARGS+=(
    -v "${PWD}:/workspace"
  )
  echo "📁 Workspace: ${PWD} → /workspace (cwd tetap /app)"
fi

# 3) Forward credentials (bukan mount file, tapi env pass-through)
if [ "$PI_FORWARD_CREDS" = "1" ]; then
  # source-auth menyediakan GITHUB_USER/GITHUB_PASSWORD, DOCKERHUB_*, WEBHOOK_TRIGGER_*, dll
  # shellcheck disable=SC1091
  source "${HOME}/.pi/agent/bin/source-auth" "" 2>/dev/null || true
  for VAR in GITHUB_USER GITHUB_PASSWORD GITHUB_TOKEN DOCKERHUB_USER DOCKERHUB_PASSWORD \
             WEBHOOK_TRIGGER_URL WEBHOOK_TRIGGER_TOKEN GIT_USER GIT_TOKEN; do
    if [ -n "${!VAR:-}" ]; then
      DOCKER_ARGS+=(-e "${VAR}=${!VAR}")
    fi
  done
  echo "🔑 Creds    : GITHUB_*/DOCKERHUB_*/WEBHOOK_* diteruskan (env)"
fi

echo ""

# ── Eksekusi single command ──────────────────────────────────────────────
exec docker "${DOCKER_ARGS[@]}" "${PI_IMAGE}" "$@"
