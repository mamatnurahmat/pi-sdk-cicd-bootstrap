# pi-sdk-cicd-bootstrap

Bootstrap **agent mode** via [pi SDK](https://pi.dev/docs/latest/sdk) — satu file yang menjalankan
workflow **setup CI/CD repo baru** end-to-end (sesuai catatan Obsidian
`Workflow-Setup-CI-CD-Repo-Baru`), lengkap dengan **end-to-end testing**.

> ✅ **Status: TERUJI di production** — workflow ini sudah dipakai nyata untuk
> `plus-be-merchantpg-manager` (develop-qoin) dan `pay-be-audittrail-module`
> (production-payout, tag `v1.0.0`).

## 📦 Struktur

```
pi-sdk-cicd-bootstrap/
├── bootstrap-agent.ts            ← 1 file: workflow agent mode (pi SDK)
├── e2e/
│   └── bootstrap-agent.test.ts   ← end-to-end test (unit mapping + dry-run + LIVE agent)
├── manifests/                    ← contoh manifest hasil generate (pay-be-audittrail-module)
├── package.json
└── README.md
```

## ⚙️ Install

```bash
cd ~/workspace/pi-sdk-cicd-bootstrap
npm install
```

Butuh `auth.json` model pi yang valid (default `~/.pi/agent/auth.json`).

## 🚀 Usage

### Dry-run (tanpa LLM, cek plan + prereq)

```bash
npm run bootstrap -- --repo pay-be-audittrail-module --branch develop \
    --type be --port 80 --lang go --dry-run true
```

### Agent mode penuh (LLM menjalankan workflow end-to-end)

```bash
npm run bootstrap -- --repo pay-be-audittrail-module --branch develop \
    --type be --port 80 --lang go
```

### Argumen

| Arg | Default | Deskripsi |
|-----|---------|-----------|
| `--repo` | (wajib) | Nama repo GitHub |
| `--branch` | `develop` | Branch source (develop/staging/sandbox/main/v*) |
| `--type` | `be` | `be` (backend) atau `web` (frontend) |
| `--port` | `3011` | Port aplikasi |
| `--lang` | `go` | `go`, `dotnet`, atau `node` |
| `--dry-run` | `false` | Tampilkan plan + prereq tanpa agent |

## 🧠 Workflow (10 langkah)

```
[0] clone repo @ branch
[1] bootstrap CI/CD (cicd-init + trigger-ci-init)
[2] fix Makefile (fallback GIT_USER/GIT_TOKEN)
[3] fix compose.yaml (build args GITHUB_USER/GITHUB_TOKEN)
[4] fix Dockerfile Go version + regenerate go.sum
[5] fix cicd.json PROJECT (path GitOps benar)
[6] make build lokal → push branch
[7] GitOps: secret file-config (SOPS) + deployment + service
[8] apply: direct (develop/staging/sandbox) atau PR (production)
[9] apply ke cluster (kubectl --context ... -n ...)
[10] verifikasi (pod, log, pipeline, health)
```

## ✅ Studi Kasus Nyata (2026-08-20)

### 1. `plus-be-merchantpg-manager` → develop-qoin (hw-dev)

| Langkah | Detail |
|---------|--------|
| Bootstrap | `cicd-init` + `trigger-ci-init` |
| Fix build | Dockerfile `golang:1.19`→`1.25` (qoinhubhelper re-tag butuh go1.25), go.sum regenerate |
| Fix auth | Makefile fallback `GITHUB_USER?=$(GIT_USER)` / `GITHUB_PASSWORD?=$(GIT_TOKEN)` |
| Fix path | `cicd.json` PROJECT `qoinplus`→`qoin` (folder `cce/develop-qoin`) |
| GitOps | deployment+service+secret SOPS di `cce/develop-qoin` & `cce/sandbox-qoin` |
| Apply | manual ke `hw-dev` (tanpa ArgoCD app) + patch host `.env` 193.x→10.2.1.x |
| Hasil | pod Running, pipeline Succeeded, image `d50f55c` |

### 2. `pay-be-audittrail-module` → production-payout (hw-pro-p)

| Langkah | Detail |
|---------|--------|
| Bootstrap | `cicd-init` + `trigger-ci-init`, PROJECT `qoinpay`→`payout` |
| Fix build | Dockerfile `golang:1.16`→`1.25` (main.go pakai `//go:build`) |
| Image | build local `ff4e27f` → pipeline develop `6df8074` |
| GitOps | manifest di `cce/production-payout` → **PR #81 merged** |
| Apply | secret SOPS + deployment + service ke `hw-pro-p` (approval) |
| Tag v1.0.0 | master sync CI/CD → tag → pipeline production → GitOps **PR #83 merged** |
| Hasil | pod Running image `v1.0.0`, listen queue `payque-audittrail-activities` |

### Alur tagging production (v\*)

```
push tag v1.0.0 (master)
  → GitHub Actions CI Trigger (tag v*)
  → webhook-trigger (Jenkins X)
  → pipeline production: build + push loyaltolpi/<repo>:v1.0.0
  → gitops-service: cce/production-payout/<repo>_deployment.yaml → PR ke main (auto-merge)
  → kubectl set image / rollout di cluster production
```

## 🗺️ Mapping yang di-encode

| Prefix repo | Project | Namespace contoh | Kube context |
|-------------|---------|------------------|--------------|
| `plus*` | `qoin` | develop-qoin / sandbox-qoin | `hw-dev` |
| `pay*` | `payout` | develop-payout / production-payout | `hw-pro-p` |
| `ngen*` | `ngenwal` | production-ngenwal | `hw-pro-u` |
| `saas*` | `saas` | production-saas | `hw-pro-u` |

| Branch | ENV | GitOps mode |
|--------|-----|-------------|
| develop/staging/sandbox | develop/staging/sandbox | direct push |
| main / v* | production | PR ke main |

| Bahasa | Secret key | mountPath |
|--------|-----------|-----------|
| Go / Node | `.env` | `/.env` |
| .NET | `appsettings.{env}.json` | `/app/appsettings.{env}.json` |

## 🧪 Testing

```bash
# Unit + integrasi (tanpa LLM) — cepat
npm run test:e2e

# Termasuk LIVE agent mode (butuh auth model, jalankan agent reasoning)
CI_RUN_LIVE=1 npm run test:e2e
```

Coverage test (14 test):

| # | Test | Jenis |
|---|------|-------|
| 1-4 | `resolveProject` / `resolveEnv` / `resolveNamespace` / `resolveContext` | unit |
| 5 | `resolveGitOps` (direct vs PR) | unit |
| 6 | `resolveSecretConfig` per bahasa | unit |
| 7-10 | `buildPlan` be/Go, production, web/Node, dotnet | unit |
| 11 | `checkPrereq` tools tersedia | integrasi |
| 12-13 | `main --dry-run` + CLI script | integrasi (e2e ringan) |
| 14 | LIVE agent: session + reasoning + system prompt | e2e (LLM) |

## 🐳 Docker Single Command (cara paling simpel)

Image multi-platform (amd64+arm64) sudah di-publish: `newrahmat/pi-sdk-cicd-bootstrap:0.1.0`.
Jalankan langsung tanpa install npm:

```bash
# Dry-run (aman, tanpa LLM)
docker run --rm --platform linux/amd64 newrahmat/pi-sdk-cicd-bootstrap:0.1.0 \
  --repo pay-be-audittrail-module --branch develop --dry-run true

# Agent mode penuh (mount auth LLM dari ~/.pi/agent)
docker run --rm --platform linux/amd64 \
  -e PI_AGENT_DIR=/etc/pi/agent \
  -e PI_AUTH_PATH=/etc/pi/agent/auth.json \
  -e PI_MODELS_PATH=/etc/pi/agent/models.json \
  -v "${HOME}/.pi/agent:/etc/pi/agent" \
  newrahmat/pi-sdk-cicd-bootstrap:0.1.0 \
  --repo pay-be-audittrail-module --branch develop
```

### Wrapper `./run.sh` (single command)

```bash
# Dry-run (tanpa LLM)
./run.sh --repo pay-be-audittrail-module --branch develop --dry-run true

# Agent penuh (LLM) + credentials eksekusi
PI_MOUNT_AUTH=1 PI_FORWARD_CREDS=1 ./run.sh --repo pay-be-audittrail-module --branch develop

# + mount workspace (agent bisa edit repo lokal di /workspace)
PI_MOUNT_AUTH=1 PI_MOUNT_WORKSPACE=1 PI_FORWARD_CREDS=1 \
  ./run.sh --repo pay-be-audittrail-module --branch develop
```

### 🔑 Credentials di mode Docker Run

| Env run.sh | Apa yang di-mount/forward | Untuk apa |
|---|---|---|
| `PI_MOUNT_AUTH=1` | `~/.pi/agent` → `/etc/pi/agent` (rw) | **LLM auth** — auth.json + models.json + settings.json untuk agent mode penuh |
| `PI_FORWARD_CREDS=1` | env `GITHUB_USER/PASSWORD`, `DOCKERHUB_*`, `WEBHOOK_TRIGGER_*`, `GIT_USER/TOKEN` | **Eksekusi workflow** — clone/push repo, push image, trigger CI |
| `PI_MOUNT_WORKSPACE=1` | `${PWD}` → `/workspace` | Agent bisa clone/edit repo di folder lokal |

**Catatan penting (dari pengalaman):**
- Mount auth harus **read-write** — ModelRuntime menulis `auth.json.lock` (gagal jika `:ro`).
- **Jangan pakai `-w /workspace`** — node akan resolve `node_modules` host (esbuild platform mismatch). Cwd tetap `/app`; agent akses workspace via path `/workspace`.
- Image multi-arch (amd64+arm64) — node cluster pakai `--platform linux/amd64`.
- Prereq `docker` di dalam container = tidak ada (DinD terpisah) — normal untuk dry-run.

**Docker run manual (tanpa wrapper):**

```bash
# Dry-run — tanpa credential
 docker run --rm --platform linux/amd64 newrahmat/pi-sdk-cicd-bootstrap:0.1.0 \
   --repo pay-be-audittrail-module --branch develop --dry-run true

# Agent penuh — mount LLM auth (rw utk lock) + forward creds
 docker run --rm --platform linux/amd64 \
   -e PI_AGENT_DIR=/etc/pi/agent \
   -e PI_AUTH_PATH=/etc/pi/agent/auth.json \
   -e PI_MODELS_PATH=/etc/pi/agent/models.json \
   -v "${HOME}/.pi/agent:/etc/pi/agent" \
   -e GITHUB_USER -e GITHUB_PASSWORD -e DOCKERHUB_USER -e DOCKERHUB_PASSWORD \
   newrahmat/pi-sdk-cicd-bootstrap:0.1.0 \
   --repo pay-be-audittrail-module --branch develop
```

> ⚠️ **Keamanan:** jangan pernah commit auth.json / credential plaintext. Forward env via
> shell (bukan hardcode di script), dan di CI gunakan Secret/CI-secret.

## ☸️ Jalankan di Kubernetes (Pod / CronJob / Job)

Project bisa berjalan di pod Kubernetes untuk otomasi bootstrap CI/CD. File pendukung ada di `k8s/`.

### Tantangan utama

| Tantangan | Solusi |
|---|---|
| Auth model LLM | mount `~/.pi/agent/auth.json` sebagai Secret → `/etc/pi` |
| Kredensial eksekusi | Secret `GITHUB_TOKEN` + kubeconfig (atau RBAC in-cluster) |
| Tools di pod | image `node:20-alpine` + `git`, `kubectl`, `gh` (Dockerfile di `k8s/`) |
| Network | egress ke provider LLM (DeepSeek/OpenRouter) + Docker Hub + GitHub |

### Setup

```bash
# build image
cd ~/workspace/pi-sdk-cicd-bootstrap
docker build -f k8s/Dockerfile -t loyaltolpi/pi-sdk-cicd-bootstrap:latest .

# isi secret (auth.json + GITHUB_TOKEN + kubeconfig) lalu apply
kubectl apply -f k8s/manifest.yaml
```

### Alur kerja di pod

```
CronJob (pola aman: dry-run) → jalankan bootstrap-agent.ts --dry-run true
  → buat plan + cek prereq → simpan ke log/ConfigMap

Job / Service (pola agent penuh) → createAgentSession → agent pakai bash
  → clone → cicd-init → make build → gitops → apply (per RBAC)
```

> ⚠️ **Best practice:** di pod gunakan mode `--dry-run` untuk plan-only (tanpa LLM).
> Mode agent penuh (LLM eksekusi perintah) sebaiknya dibatasi tools-nya dan
> hanya untuk non-production. Production tetap via PR (lihat aturan global).

## 🔑 Config Provider, Model & Credentials (untuk pod)

Pi SDK memakai `ModelRuntime.create()` yang membaca kredensial dengan prioritas:

```
1. Runtime override (setRuntimeApiKey)      ← tidak di-persist
2. auth.json (stored credentials)            ← ~/.pi/agent/auth.json
3. Environment variables                     ← OPENROUTER_API_KEY, ANTHROPIC_API_KEY, dll
4. Fallback custom provider (models.json)    ← ~/.pi/agent/models.json
```

### File yang dibutuhkan di pod (`/etc/pi/agent/`)

| File | Isi | Sumber lokal |
|---|---|---|
| `auth.json` | API keys LLM (`OPENROUTER_API_KEY` dll) | `~/.pi/agent/auth.json` |
| `models.json` | registri provider + model (openrouter → deepseek) | `~/.pi/models.json` |
| `settings.json` | defaultModel / defaultProvider / thinkingLevel | `~/.pi/agent/settings.json` |

Lokasi bisa di-override via env di pod:
```yaml
env:
  - name: PI_AGENT_DIR     # agent dir pi (untuk DefaultResourceLoader)
    value: /etc/pi/agent
  - name: PI_AUTH_PATH     # lokasi auth.json
    value: /etc/pi/agent/auth.json
  - name: PI_MODELS_PATH   # lokasi models.json
    value: /etc/pi/agent/models.json
```

### Kredensial eksekusi workflow (selain LLM)

| Credential | Untuk apa | Di pod |
|---|---|---|
| `GITHUB_USER` + `GITHUB_PASSWORD` | clone/push repo aplikasi (private) | Secret `pi-exec-creds` |
| `GITHUB_TOKEN` (gh) | buat PR gitops, trigger-ci | Secret `pi-exec-creds` |
| `DOCKERHUB_USER/PASSWORD` | push image ke registry | Secret (optional) |
| kubeconfig / RBAC | `kubectl apply` ke namespace target | Secret / ServiceAccount |
| `WEBHOOK_TRIGGER_TOKEN` | trigger Jenkins X pipeline | Secret (optional) |

> ⚠️ **Jangan pernah commit** auth.json/models.json plaintext — selalu via Secret
> (contoh `k8s/manifest.yaml` → `Secret pi-auth`), dan isi nilai dari
> `~/.pi/agent/auth.json` + `~/.pi/models.json` saat apply.

## 🔒 Aturan yang di-encode (dari AGENTS.md + skill)

- Tidak commit/push langsung ke `main`/`master` — production wajib PR.
- Secret file-config wajib SOPS-encrypted (`*_secret_sops.yaml`), tanpa plaintext.
- Uji `make build` lokal sebelum push.
- Pipeline JX hanya punya `GIT_USER`/`GIT_TOKEN` → Makefile wajib fallback.
- `cicd.json` PROJECT harus sesuai prefix (mis. `qoin`, bukan `qoinplus`).
- `.env` di repo sering pakai host infra lama (`193.x`) — patch ke host internal cluster
  sebelum apply (contoh: Redis `10.2.1.7`, RabbitMQ `10.7.1.110`, Mongo `10.7.1.237`).
