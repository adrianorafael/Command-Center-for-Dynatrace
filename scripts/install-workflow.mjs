#!/usr/bin/env node
/**
 * Admin CLI: create or update the "Command Center · Engine" workflow through the Automation REST API.
 * (Custom apps cannot hold automation:workflows:write, so the app itself cannot install it.)
 *
 *   DT_ENVIRONMENT=https://YOUR-ENVIRONMENT.apps.dynatrace.com \
 *   DT_PLATFORM_TOKEN=<platform token with automation:workflows:read + automation:workflows:write> \
 *   node scripts/install-workflow.mjs [--app-id my.command.center] [--workflow-id <uuid>] [--actor <service-user-uid>] [--interval 1|2|5] [--dry-run]
 *
 * Endpoints (same as @dynatrace-sdk/client-automation 8.10 esm/index.js):
 *   GET  /platform/automation/v1/workflows/{id}            → 200 exists / 404
 *   PUT  /platform/automation/v1/workflows/{id}            update (body WorkflowUpdate, no id)
 *   GET  /platform/automation/v1/trash/workflows           trashed workflows
 *   POST /platform/automation/v1/trash/workflows/{id}/restore
 *   POST /platform/automation/v1/workflows                 create (body WorkflowCreate with fixed id)
 * The token is read from the environment only and never printed. Without DT_PLATFORM_TOKEN no
 * Authorization header is sent (for environments where a proxy injects credentials).
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const env = (process.env.DT_ENVIRONMENT ?? "").replace(/\/+$/, "");
const token = process.env.DT_PLATFORM_TOKEN;
const appId = opt("app-id", "my.command.center");
const actor = opt("actor", undefined);
const intervalMinutes = Number(opt("interval", "1"));
const dryRun = has("dry-run");

if (!dryRun && !/^https:\/\/[a-z0-9.-]+$/i.test(env)) {
  console.error("Set DT_ENVIRONMENT=https://YOUR-ENVIRONMENT.apps.dynatrace.com (or use --dry-run).");
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "cc-install-"));
let mod;
try {
  const outfile = join(dir, "def.mjs");
  await build({
    stdin: {
      contents: [
        'export { buildEngineWorkflowCreate, buildEngineWorkflowUpdate } from "./ui/app/data/workflows/definition";',
        'export { defaultSettings } from "./ui/app/data/domainPort";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "error",
  });
  mod = await import(pathToFileURL(outfile).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const settings = mod.defaultSettings();
settings.engine.workflowId = opt("workflow-id", settings.engine.workflowId);
const id = settings.engine.workflowId;
const def = { appId, settings, intervalMinutes, ...(actor ? { actor } : {}) };
const createBody = mod.buildEngineWorkflowCreate(def);
const updateBody = mod.buildEngineWorkflowUpdate(def);

if (dryRun) {
  console.log(JSON.stringify(createBody, null, 2));
  process.exit(0);
}

const headers = { "Content-Type": "application/json", Accept: "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

async function call(method, path, body) {
  const res = await fetch(`${env}/platform/automation/v1${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text: text.slice(0, 500) };
}

function fail(what, r) {
  console.error(`${what} failed: HTTP ${r.status} ${r.json?.error?.message ?? r.text}`);
  process.exit(1);
}

const existing = await call("GET", `/workflows/${id}`);
let outcome;
if (existing.status === 200) {
  const r = await call("PUT", `/workflows/${id}`, updateBody);
  if (r.status >= 300) fail("update", r);
  outcome = "updated";
} else if (existing.status === 404) {
  const trash = await call("GET", "/trash/workflows");
  const trashed = trash.status === 200 && (trash.json?.results ?? []).some((w) => w.id === id);
  if (trashed) {
    const r1 = await call("POST", `/trash/workflows/${id}/restore`, { isDeployed: true });
    if (r1.status >= 300) fail("restore", r1);
    const r2 = await call("PUT", `/workflows/${id}`, updateBody);
    if (r2.status >= 300) fail("update after restore", r2);
    outcome = "restored";
  } else {
    const r = await call("POST", "/workflows", createBody);
    if (r.status >= 300) fail("create", r);
    outcome = "created";
  }
} else {
  fail("lookup", existing);
}
console.log(`Command Center · Engine ${outcome} (workflow id ${id}, app ${appId}).`);
console.log("Next: enable the Workflows authorization settings for the actor, allowlist provider hosts, create vault entries (see docs/guides/en/getting-started.md).");
