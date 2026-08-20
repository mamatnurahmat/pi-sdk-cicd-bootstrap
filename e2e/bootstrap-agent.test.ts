// ============================================================================
// e2e/bootstrap-agent.test.ts — End-to-end test workflow bootstrap CI/CD
// ============================================================================
// Menguji:
//  1. Helpers mapping (pure): resolveProject / resolveEnv / resolveNamespace /
//     resolveContext / resolveGitOps / resolveSecretConfig
//  2. buildPlan menghasilkan plan lengkap & benar untuk be (Go) & web (Node)
//  3. checkPrereq mendeteksi tools yang tersedia
//  4. Dry-run mode (main --dry-run) menghasilkan plan + prereq tanpa LLM
//  5. (opsional) Live agent mode — hanya bila CI_RUN_LIVE=1 dan ada model auth
//
// Run: npm run test:e2e
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
	buildPlan,
	buildSystemPrompt,
	checkPrereq,
	resolveContext,
	resolveEnv,
	resolveGitOps,
	resolveNamespace,
	resolveProject,
	resolveSecretConfig,
	main,
	type PlanResult,
} from "../bootstrap-agent.ts";

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "../bootstrap-agent.ts");

// ── 1. Mapping helpers ──────────────────────────────────────────────────────

test("resolveProject: prefix repo → project (plus* → qoin)", () => {
	assert.equal(resolveProject("plus-be-merchantpg-manager"), "qoin");
	assert.equal(resolveProject("pay-be-client-manager"), "payout");
	assert.equal(resolveProject("ngenwal-be-snapconvert-manager"), "ngenwal");
	assert.equal(resolveProject("saas-be-profile-manager"), "saas");
	assert.equal(resolveProject("unknown-service"), "qoinplus");
});

test("resolveEnv: branch → env (develop/staging/sandbox/main/tag)", () => {
	assert.equal(resolveEnv("develop"), "develop");
	assert.equal(resolveEnv("development"), "develop");
	assert.equal(resolveEnv("staging"), "staging");
	assert.equal(resolveEnv("sandbox"), "sandbox");
	assert.equal(resolveEnv("main"), "production");
	assert.equal(resolveEnv("master"), "production");
	assert.equal(resolveEnv("v1.2.0"), "production");
	assert.equal(resolveEnv("unknown-branch"), "staging");
});

test("resolveNamespace: env + project → namespace", () => {
	assert.equal(resolveNamespace("develop", "qoin"), "develop-qoin");
	assert.equal(resolveNamespace("sandbox", "qoin"), "sandbox-qoin");
	assert.equal(resolveNamespace("production", "payout"), "production-payout");
});

test("resolveContext: namespace → kube context", () => {
	assert.equal(resolveContext("develop-qoin"), "hw-dev");
	assert.equal(resolveContext("sandbox-qoin"), "hw-dev");
	assert.equal(resolveContext("production-qoin"), "hw-pro-q");
	assert.equal(resolveContext("production-saas"), "hw-pro-u");
	assert.equal(resolveContext("unknown-ns"), "hw-dev"); // fallback
});

test("resolveGitOps: direct untuk develop/staging/sandbox, PR untuk production", () => {
	assert.deepEqual(resolveGitOps("develop"), { branch: "develop", mode: "direct" });
	assert.deepEqual(resolveGitOps("staging"), { branch: "staging", mode: "direct" });
	assert.deepEqual(resolveGitOps("sandbox"), { branch: "sandbox", mode: "direct" });
	assert.deepEqual(resolveGitOps("production"), { branch: "main", mode: "pr" });
});

test("resolveSecretConfig: aturan secret per bahasa", () => {
	assert.deepEqual(resolveSecretConfig("go", "develop"), {
		key: ".env",
		mountPath: "/.env",
		sourceFile: ".env.develop",
	});
	assert.deepEqual(resolveSecretConfig("node", "staging"), {
		key: ".env",
		mountPath: "/.env",
		sourceFile: ".env.staging",
	});
	assert.deepEqual(resolveSecretConfig("dotnet", "production"), {
		key: "appsettings.production.json",
		mountPath: "/app/appsettings.production.json",
		sourceFile: "appsettings.production.json",
	});
});

// ── 2. buildPlan ────────────────────────────────────────────────────────────

test("buildPlan: be/Go develop → cce/develop-qoin, direct, secret .env", () => {
	const plan = buildPlan({
		repo: "plus-be-merchantpg-manager",
		branch: "develop",
		type: "be",
		port: "3011",
		lang: "go",
	});
	assert.equal(plan.project, "qoin");
	assert.equal(plan.env, "develop");
	assert.equal(plan.namespace, "develop-qoin");
	assert.equal(plan.context, "hw-dev");
	assert.equal(plan.gitopsBranch, "develop");
	assert.equal(plan.gitopsMode, "direct");
	assert.equal(plan.gitopsPath, "cce/develop-qoin/plus-be-merchantpg-manager_deployment.yaml");
	assert.equal(plan.secretKey, ".env");
	assert.equal(plan.secretMountPath, "/.env");
	assert.ok(plan.steps.length >= 10, "plan harus punya minimal 10 step");
	assert.ok(plan.steps.some((s) => s.includes("PROJECT=qoin")), "step 5 fix cicd.json PROJECT");
	assert.ok(plan.steps.some((s) => s.includes("hw-dev")), "step 9 apply context hw-dev");
});

test("buildPlan: be/Go production (tag v*) → cce/production-qoin, PR ke main", () => {
	const plan = buildPlan({
		repo: "plus-be-merchantpg-manager",
		branch: "v1.2.0",
		type: "be",
		port: "3011",
		lang: "go",
	});
	assert.equal(plan.env, "production");
	assert.equal(plan.namespace, "production-qoin");
	assert.equal(plan.context, "hw-pro-q");
	assert.equal(plan.gitopsBranch, "main");
	assert.equal(plan.gitopsMode, "pr");
	assert.ok(plan.steps.some((s) => s.includes("PR ke main")), "production wajib PR");
});

test("buildPlan: web/Node staging → web/staging, secret .env", () => {
	const plan = buildPlan({
		repo: "pay-fe-merchantplatform",
		branch: "staging",
		type: "web",
		port: "80",
		lang: "node",
	});
	assert.equal(plan.project, "payout");
	assert.equal(plan.env, "staging");
	assert.equal(plan.gitopsPath, "web/staging/pay-fe-merchantplatform/docker-compose.yaml");
	assert.equal(plan.secretKey, ".env");
});

test("buildPlan: dotnet production → appsettings.production.json mount", () => {
	const plan = buildPlan({
		repo: "ngenwal-be-asset-module",
		branch: "main",
		type: "be",
		port: "7003",
		lang: "dotnet",
	});
	assert.equal(plan.project, "ngenwal");
	assert.equal(plan.env, "production");
	assert.equal(plan.gitopsMode, "pr");
	assert.equal(plan.secretKey, "appsettings.production.json");
	assert.equal(plan.secretMountPath, "/app/appsettings.production.json");
});

// ── 3. checkPrereq ──────────────────────────────────────────────────────────

test("checkPrereq: mendeteksi tools yang tersedia di mesin", async () => {
	const missing = await checkPrereq();
	// git/gh/kubectl/docker harus ada di mesin DevOps ini (tidak wajib semua ada)
	assert.ok(Array.isArray(missing), "harus return array");
	assert.ok(!missing.includes("git"), "git harus tersedia");
});

// ── 4. Dry-run mode (tanpa LLM) ─────────────────────────────────────────────

test("main --dry-run: menghasilkan plan + prereq tanpa agent", async () => {
	const out = await main(["--repo", "plus-be-merchantpg-manager", "--branch", "develop", "--dry-run", "true"]);
	assert.ok(out.plan, "harus ada plan");
	assert.equal(out.plan.namespace, "develop-qoin");
	assert.ok(Array.isArray(out.prereq), "harus ada prereq list");
	assert.ok(out.plan.steps.length >= 10);
});

test("CLI script --dry-run exit 0 dan output plan", async () => {
	const { stdout } = await execFileP("npx", ["tsx", SCRIPT, "--repo", "plus-be-merchantpg-manager", "--dry-run", "true"], {
		cwd: path.resolve(here, ".."),
	});
	assert.match(stdout, /DRY-RUN/);
	assert.match(stdout, /develop-qoin/);
	assert.match(stdout, /cce\/develop-qoin\/plus-be-merchantpg-manager_deployment\.yaml/);
	assert.match(stdout, /Prereq/);
});

// ── 5. Live agent mode (opsional, butuh auth model) ─────────────────────────

test("agent mode (LIVE, opsional): session + reasoning + system prompt", { skip: process.env.CI_RUN_LIVE !== "1" }, async () => {
	// Impor SDK (lazy agar test lain tidak butuh model)
	const {
		createAgentSession,
		DefaultResourceLoader,
		getAgentDir,
		ModelRuntime,
		SessionManager,
		SettingsManager,
	} = await import("@earendil-works/pi-coding-agent");

	const plan: PlanResult = buildPlan({
		repo: "plus-be-merchantpg-manager",
		branch: "develop",
		type: "be",
		port: "3011",
		lang: "go",
	});

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		systemPromptOverride: () => buildSystemPrompt(plan, {
			repo: "plus-be-merchantpg-manager",
			branch: "develop",
			type: "be",
			port: "3011",
			lang: "go",
		}),
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();

	const modelRuntime = await ModelRuntime.create();
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime,
		resourceLoader: loader,
		tools: ["read", "bash"],
		sessionManager: SessionManager.inMemory(cwd),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
	});

	let reply = "";
	try {
		session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				reply += event.assistantMessageEvent.delta;
			}
		});
		await session.prompt(
			"JANGAN jalankan perintah bash apa pun. Jawab singkat: " +
				"untuk repo plus-be-merchantpg-manager @ branch develop, namespace & kube context tujuan berapa?",
		);
	} finally {
		session.dispose();
	}

	assert.match(reply, /develop-qoin/i, "agent harus menyebut namespace develop-qoin");
	assert.match(reply, /hw-dev/i, "agent harus menyebut context hw-dev");
});
