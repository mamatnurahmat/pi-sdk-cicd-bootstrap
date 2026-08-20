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
# Optional env:
#   PI_IMAGE        default: newrahmat/pi-sdk-cicd-bootstrap:0.1.0
#   PI_PLATFORM     default: linux/amd64 (cocok untuk amd64; Mac pakai linux/arm64)
#   PI_MOUNT_AUTH   mount ~/.pi/agent ke /etc/pi/agent (untuk agent mode penuh)
#   PI_DRY_RUN      true/false
# ============================================================================
set -euo pipefail

PI_IMAGE="${PI_IMAGE:-newrahmat/pi-sdk-cicd-bootstrap:0.1.0}"
PI_PLATFORM="${PI_PLATFORM:-linux/amd64}"
PI_MOUNT_AUTH="${PI_MOUNT_AUTH:-0}"

# ── Banner ───────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  🐳 pi-sdk-cicd-bootstrap — Docker single command        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Image   : ${PI_IMAGE}"
echo "║  Platform: ${PI_PLATFORM}"
echo "║  Auth    : $([ "$PI_MOUNT_AUTH" = "1" ] && echo 'mount ~/.pi/agent' || echo 'tidak (dry-run)')"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Siapkan argumen docker ───────────────────────────────────────────────
DOCKER_ARGS=(run --rm --platform "${PI_PLATFORM}")

if [ "$PI_MOUNT_AUTH" = "1" ]; then
  # ModelRuntime butuh tulis lock file (auth.json.lock) → mount read-write
  DOCKER_ARGS+=(
    -e PI_AGENT_DIR=/etc/pi/agent
    -e PI_AUTH_PATH=/etc/pi/agent/auth.json
    -e PI_MODELS_PATH=/etc/pi/agent/models.json
    -v "${HOME}/.pi/agent:/etc/pi/agent"
  )
  echo "📎 Mount auth: ~/.pi/agent → /etc/pi/agent (agent mode penuh, rw utk lock)"
  echo ""
fi

# ── Eksekusi single command ──────────────────────────────────────────────
exec docker "${DOCKER_ARGS[@]}" "${PI_IMAGE}" "$@"
