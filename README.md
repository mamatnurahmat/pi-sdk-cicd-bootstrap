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

## 🔒 Aturan yang di-encode (dari AGENTS.md + skill)

- Tidak commit/push langsung ke `main`/`master` — production wajib PR.
- Secret file-config wajib SOPS-encrypted (`*_secret_sops.yaml`), tanpa plaintext.
- Uji `make build` lokal sebelum push.
- Pipeline JX hanya punya `GIT_USER`/`GIT_TOKEN` → Makefile wajib fallback.
- `cicd.json` PROJECT harus sesuai prefix (mis. `qoin`, bukan `qoinplus`).
- `.env` di repo sering pakai host infra lama (`193.x`) — patch ke host internal cluster
  sebelum apply (contoh: Redis `10.2.1.7`, RabbitMQ `10.7.1.110`, Mongo `10.7.1.237`).
