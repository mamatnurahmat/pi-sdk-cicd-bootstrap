# ============================================================================
# Dockerfile — pi-sdk-cicd-bootstrap (untuk pod Kubernetes)
# ============================================================================
# Image minimal untuk menjalankan bootstrap-agent.ts di cluster:
#   - node + tsx + pi-coding-agent SDK
#   - git, kubectl, gh, docker (DinD optional via sidecar)
#
# Build:
#   docker build -t loyaltolpi/pi-sdk-cicd-bootstrap:latest .
# ============================================================================
FROM node:20-alpine

RUN apk add --no-cache git openssh-client curl bash ca-certificates \
    && curl -fsSL https://dl.k8s.io/release/v1.30.0/bin/linux/amd64/kubectl -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl \
    && curl -fsSL https://github.com/cli/cli/releases/download/v2.54.0/gh_2.54.0_linux_amd64.tar.gz | tar xz -C /tmp \
    && mv /tmp/gh_2.54.0_linux_amd64/bin/gh /usr/local/bin/gh \
    && chmod +x /usr/local/bin/gh

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install

COPY bootstrap-agent.ts ./
COPY e2e ./e2e
COPY manifests ./manifests

# Agent memakai tools bash/read/write — default tools tetap tersedia
ENTRYPOINT ["npx", "tsx", "bootstrap-agent.ts"]
