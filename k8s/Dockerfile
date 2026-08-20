# ============================================================================
# Dockerfile — pi-sdk-cicd-bootstrap (untuk pod Kubernetes)
# ============================================================================
# Image minimal untuk menjalankan bootstrap-agent.ts di cluster.
#
# ── PI AGENT ─────────────────────────────────────────────────────────────
# Project ini memakai pi agent sebagai **SDK library** (bukan binary CLI):
#   npm dependency: @earendil-works/pi-coding-agent@0.84.2
#   import: createAgentSession / ModelRuntime / SessionManager
# SDK di-install otomatis oleh `npm ci` di bawah (dari package.json dependencies).
# Binary CLI `pi` (interaktif) TIDAK di-install — tidak dibutuhkan (headless pod).
# ─────────────────────────────────────────────────────────────────────────
#
# Build:
#   docker build -f k8s/Dockerfile -t loyaltolpi/pi-sdk-cicd-bootstrap:latest .
# ============================================================================
# undici 8.x (dependency pi-coding-agent) butuh Node >= 22.19 → pakai node:24-alpine
FROM node:24-alpine

RUN apk add --no-cache git openssh-client curl bash ca-certificates \
    && curl -fsSL https://dl.k8s.io/release/v1.30.0/bin/linux/amd64/kubectl -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl \
    && curl -fsSL https://github.com/cli/cli/releases/download/v2.54.0/gh_2.54.0_linux_amd64.tar.gz | tar xz -C /tmp \
    && mv /tmp/gh_2.54.0_linux_amd64/bin/gh /usr/local/bin/gh \
    && chmod +x /usr/local/bin/gh

WORKDIR /app

# ── Install dependencies (termasuk pi-coding-agent SDK) ──────────────────
# npm ci penuh (tanpa --omit=dev) supaya tsx & @types/node ikut ter-install.
COPY package.json package-lock.json ./
RUN npm ci

# ── Verifikasi SDK pi agent terpasang ────────────────────────────────────
# package.json tidak bisa di-require langsung (exports hanya . / rpc-entry / client)
# → verifikasi via VERSION yang di-export dari index.
RUN node -e "import('@earendil-works/pi-coding-agent').then(m => console.log('[OK] pi-coding-agent SDK terinstall (VERSION=' + m.VERSION + ')'))"

COPY bootstrap-agent.ts ./
COPY e2e ./e2e
COPY manifests ./manifests

# Agent memakai tools bash/read/write — default tools tetap tersedia
ENTRYPOINT ["npx", "tsx", "bootstrap-agent.ts"]
