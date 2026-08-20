#!/usr/bin/env tsx
// ============================================================================
// bootstrap-agent.ts — Workflow Setup CI/CD Repo Baru (Agent Mode)
// ============================================================================
// Satu file bootstrap agent mode berbasis pi SDK (https://pi.dev/docs/latest/sdk).
//
// Workflow end-to-end (sesuai catatan Obsidian "Workflow-Setup-CI-CD-Repo-Baru"):
//   0. clone & cek branch
//   1. bootstrap CI/CD (cicd-init + trigger-ci-init)
//   2. fix Makefile (fallback GIT_USER/GIT_TOKEN) + compose.yaml (build args)
//   3. fix Dockerfile (Go version) + regenerate go.sum
//   4. fix cicd.json PROJECT (path GitOps)
//   5. make build (lokal) + push branch
//   6. GitOps: secret file-config (SOPS) + deployment + service
//   7. apply langsung (develop/staging/sandbox) atau PR (production)
//   8. verifikasi pod / pipeline / health
//
// Mode:
//   --dry-run        Tampilkan plan + cek prereq, tanpa eksekusi agent/LLM
//   (default)        Jalankan agent (LLM) dengan tools read/bash/edit/write
//
// Usage:
//   npm run bootstrap -- --repo plus-be-merchantpg-manager --branch develop \
//       --type be --port 3011 --lang go [--dry-run]
// ============================================================================

import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

// ────────────────────────────────────────────────────────────────────────────
// 1. Mapping data (sumber: ConfigMap jx-init-ns-map + ~/.pi/ns.json + observasi)
// ────────────────────────────────────────────────────────────────────────────

const PREFIX_PROJECT: Record<string, string> = {
	plus: "qoin",
	pay: "payout",
	ngen: "ngenwal",
	saas: "saas",
};

const BRANCH_ENV: Record<string, string> = {
	develop: "develop",
	development: "develop",
	staging: "staging",
	sandbox: "sandbox",
	main: "production",
	master: "production",
};

// namespace -> kube context (dari ~/.pi/ns.json + verified)
const NS_CONTEXT: Record<string, string> = {
	"develop-qoin": "hw-dev",
	"sandbox-qoin": "hw-dev",
	"develop-payout": "hw-pro-p",
	"staging-payout": "hw-pro-p",
	"production-payout": "hw-pro-p",
	"production-qoin": "hw-pro-q",
	"production-ngenwal": "hw-pro-u",
	"production-saas": "hw-pro-u",
};

const GITOPS_REPO = "gitops";
const GITOPS_ORG = "Qoin-Digital-Indonesia";
const GITOPS_DIR = `${process.env.HOME}/gitops`;

// ────────────────────────────────────────────────────────────────────────────
// 2. Helpers (pure, di-export untuk test)
// ────────────────────────────────────────────────────────────────────────────

export interface PlanOptions {
	repo: string;
	branch: string;
	type: "be" | "web";
	port: string;
	lang: "go" | "dotnet" | "node";
}

export interface PlanResult {
	repo: string;
	project: string;
	env: string;
	namespace: string;
	context: string;
	gitopsBranch: string;
	gitopsMode: "direct" | "pr";
	gitopsPath: string;
	secretKey: string;
	secretMountPath: string;
	steps: string[];
}

/** Resolve project dari prefix repo (plus* → qoin, dst). */
export function resolveProject(repo: string): string {
	for (const [prefix, project] of Object.entries(PREFIX_PROJECT)) {
		if (repo.startsWith(prefix)) return project;
	}
	return "qoinplus";
}

/** Resolve env dari branch (develop → develop, main/v* → production, dst). */
export function resolveEnv(branch: string): string {
	if (/^v\d/.test(branch)) return "production";
	return BRANCH_ENV[branch] ?? "staging";
}

/** Namespace = {env}-{project}, kecuali production-payout dsb yang sudah baku. */
export function resolveNamespace(env: string, project: string): string {
	return `${env}-${project}`;
}

/** Kube context dari namespace. */
export function resolveContext(namespace: string): string {
	return NS_CONTEXT[namespace] ?? "hw-dev";
}

/** GitOps branch target + mode (direct untuk non-production, PR untuk production). */
export function resolveGitOps(env: string): { branch: string; mode: "direct" | "pr" } {
	if (env === "production") return { branch: "main", mode: "pr" };
	return { branch: env, mode: "direct" };
}

/** Konfigurasi secret file-config sesuai bahasa. */
export function resolveSecretConfig(lang: PlanOptions["lang"], env: string) {
	switch (lang) {
		case "go":
			return { key: ".env", mountPath: "/.env", sourceFile: `.env.${env}` };
		case "node":
			return { key: ".env", mountPath: "/.env", sourceFile: `.env.${env}` };
		case "dotnet":
			return {
				key: `appsettings.${env}.json`,
				mountPath: `/app/appsettings.${env}.json`,
				sourceFile: `appsettings.${env}.json`,
			};
	}
}

/** Bangun plan lengkap dari opsi (digunakan juga oleh agent sebagai instruksi). */
export function buildPlan(opts: PlanOptions): PlanResult {
	const project = resolveProject(opts.repo);
	const env = resolveEnv(opts.branch);
	const namespace = resolveNamespace(env, project);
	const context = resolveContext(namespace);
	const { branch: gitopsBranch, mode } = resolveGitOps(env);
	const isWeb = opts.type === "web";
	const gitopsPath = isWeb
		? `web/${env}/${opts.repo}/docker-compose.yaml`
		: `cce/${namespace}/${opts.repo}_deployment.yaml`;
	const sec = resolveSecretConfig(opts.lang, env);

	const steps = [
		`[0] clone ${opts.repo} @ branch ${opts.branch} → workspace`,
		`[1] bootstrap CI/CD: cicd-init + trigger-ci-init (Makefile, compose.yaml, trigger-ci.yml, secrets)`,
		`[2] fix Makefile: GITHUB_USER?=$(GIT_USER), GITHUB_PASSWORD?=$(GIT_TOKEN)`,
		`[3] fix compose.yaml: build args GITHUB_USER/GITHUB_TOKEN`,
		`[4] fix Dockerfile Go version (jika ${opts.lang}==go: golang:X-alpine sesuai dependency) + regenerate go.sum`,
		`[5] fix cicd.json: PROJECT=${project} (bukan qoinplus) → path gitops benar`,
		`[6] make build ENV=${env} (lokal, pastikan sukses) → push branch ${opts.branch}`,
		`[7] GitOps di ${GITOPS_ORG}/${GITOPS_REPO} → ${gitopsPath}`,
		`    - secret file-config-${opts.repo} (key=${sec.key}, mount ${sec.mountPath}, SOPS encrypt)`,
		`    - deployment + service + update kustomization.yaml`,
		`[8] apply: mode=${mode} (${mode === "pr" ? "PR ke main + review" : "commit & push langsung ke branch " + gitopsBranch})`,
		`[9] apply ke cluster: kubectl --context ${context} apply ... ns ${namespace}`,
		`[10] verifikasi: pod Running, log "http server started", pipeline Succeeded, health 200/401`,
	];

	return {
		repo: opts.repo,
		project,
		env,
		namespace,
		context,
		gitopsBranch,
		gitopsMode: mode,
		gitopsPath,
		secretKey: sec.key,
		secretMountPath: sec.mountPath,
		steps,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// 3. System prompt agent (embed workflow dari catatan Obsidian)
// ────────────────────────────────────────────────────────────────────────────

export function buildSystemPrompt(plan: PlanResult, opts: PlanOptions): string {
	return `You are a DevOps agent that bootstraps CI/CD for a new service repo, end-to-end.

TARGET:
- repo    : ${opts.repo}
- branch  : ${opts.branch} (env=${plan.env})
- type    : ${opts.type} (be/web)
- lang    : ${opts.lang}
- port    : ${opts.port}
- project : ${plan.project}
- gitops  : ${plan.gitopsPath} (mode ${plan.gitopsMode}, branch ${plan.gitopsBranch})
- cluster : kubectl --context ${plan.context} --namespace ${plan.namespace}

RULES (wajib):
1. Jangan commit/push langsung ke branch main/master — untuk production buat PR.
2. Jangan pernah menulis secret plaintext ke repo gitops — wajib SOPS encrypt (*_secret_sops.yaml).
3. Uji \`make build\` LOKAL dulu sebelum push (jangan andalkan pipeline untuk menemukan bug build).
4. Sebelum commit: stage + review diff + cek tidak ada file sensitif (.env, *.key, auth.json).
5. Ikuti langkah-langkah plan di bawah ini secara berurutan; berhenti & laporkan jika ada step gagal.

PLAN:
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

KONTEKS TAMBAHAN:
- Pipeline runtime = generic v2 (webhook-trigger). Step trigger-gitops membaca PROJECT dari cicd.json → path cce/{env}-{project}/.
- Pipeline JX hanya menyediakan env GIT_USER/GIT_TOKEN (bukan GITHUB_*), jadi Makefile wajib fallback.
- Secret file-config (${opts.lang}): key=${plan.secretKey}, mount ${plan.secretMountPath} via file-config-volume.
- Jika lang=go dan ada dependency private re-tag (qoinhubhelper), cek requirement go version di Dockerfile builder.
- Cluster develop/sandbox tidak punya ArgoCD app aktif → apply manual via kubectl (bukan production, aman).
- Prefix repo → project: plus*→qoin, pay*→payout, ngen*→ngenwal, saas*→saas.

Mulai dari step 1. Laporkan progres singkat per step dan hasil akhir.`;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. CLI + agent session
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
	const args: Record<string, string> = { type: "be", lang: "go", port: "3011", branch: "develop" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
			args[key] = val;
		}
	}
	return args;
}

export async function checkPrereq(): Promise<string[]> {
	const missing: string[] = [];
	for (const cmd of ["git", "gh", "kubectl", "docker", "base64"]) {
		const has = await new Promise<boolean>((res) => {
			import("node:child_process").then(({ execFile }) =>
				execFile("which", [cmd], (err) => res(!err)),
			);
		});
		if (!has) missing.push(cmd);
	}
	if (!process.env.GITHUB_USER && !process.env.GIT_USER) {
		missing.push("GITHUB_USER/GIT_USER env (untuk build private repo)");
	}
	return missing;
}

async function runAgent(opts: PlanOptions, plan: PlanResult) {
	const cwd = process.cwd();
	const agentDir = getAgentDir();

	// DefaultResourceLoader dengan system prompt override (workflow bootstrap)
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		systemPromptOverride: () => buildSystemPrompt(plan, opts),
		// Hindari APPEND_SYSTEM.md dari agent dir ikut campur
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();

	const modelRuntime = await ModelRuntime.create();

	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime,
		resourceLoader: loader,
		tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
		sessionManager: SessionManager.inMemory(cwd),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
	});

	try {
		session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				process.stdout.write(event.assistantMessageEvent.delta);
			}
			if (event.type === "tool_execution_start") {
				console.log(`\n⚙️  [tool] ${event.toolName}`);
			}
			if (event.type === "tool_execution_end") {
				console.log(`\n✔️  [tool] ${event.toolName} → ${event.isError ? "ERROR" : "ok"}`);
			}
		});

		console.log(`\n🚀 Agent bootstrap dimulai: ${opts.repo} @ ${opts.branch} (env ${plan.env})\n`);
		await session.prompt(
			`Jalankan workflow bootstrap CI/CD untuk ${opts.repo} (branch ${opts.branch}, ${opts.type}, ${opts.lang}, port ${opts.port}) sesuai plan. ` +
				`Lakukan end-to-end sampai verifikasi, laporkan setiap langkah.`,
		);
		console.log("\n\n✅ Agent selesai.");
	} finally {
		session.dispose();
	}
}

export async function main(argv: string[] = process.argv.slice(2)) {
	const args = parseArgs(argv);

	if (!args.repo) {
		console.error(
			`Usage: npm run bootstrap -- --repo <nama-repo> --branch <develop|staging|sandbox|main> ` +
				`--type <be|web> --port <port> --lang <go|dotnet|node> [--dry-run]`,
		);
		process.exit(2);
	}

	const opts: PlanOptions = {
		repo: args.repo,
		branch: args.branch ?? "develop",
		type: (args.type as PlanOptions["type"]) ?? "be",
		port: args.port ?? "3011",
		lang: (args.lang as PlanOptions["lang"]) ?? "go",
	};
	const plan = buildPlan(opts);

	// ── Mode dry-run: tampilkan plan + prereq, tanpa LLM ──
	if (args["dry-run"] === "true") {
		console.log("╔══════════════════════════════════════════════════════════╗");
		console.log("║  🧪 DRY-RUN — Workflow Setup CI/CD Repo Baru            ║");
		console.log("╚══════════════════════════════════════════════════════════╝");
		console.log(`Repo      : ${plan.repo}`);
		console.log(`Branch    : ${opts.branch} → env ${plan.env}`);
		console.log(`Project   : ${plan.project}`);
		console.log(`Namespace : ${plan.namespace} (context ${plan.context})`);
		console.log(`GitOps    : ${plan.gitopsPath}`);
		console.log(`  mode     : ${plan.gitopsMode} (${plan.gitopsBranch})`);
		console.log(`  secret   : file-config-${plan.repo} key=${plan.secretKey} mount=${plan.secretMountPath}`);
		console.log("\n📋 Plan:");
		plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

		const missing = await checkPrereq();
		console.log(`\n🔍 Prereq: ${missing.length === 0 ? "✅ semua tersedia" : "❌ kurang: " + missing.join(", ")}`);
		return { plan, prereq: missing };
	}

	await runAgent(opts, plan);
	return { plan, agent: "run" };
}

// Jalankan langsung bila file dieksekusi sebagai script
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error("❌ Bootstrap agent gagal:", err);
		process.exit(1);
	});
}
