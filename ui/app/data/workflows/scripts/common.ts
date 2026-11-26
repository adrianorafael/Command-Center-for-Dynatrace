/**
 * Shared pieces of the workflow "Run JavaScript" task sources.
 *
 * These are STRINGS executed by the Dynatrace workflow runtime, not by the app. Runtime facts:
 *  - "Every script must export a default async function"; 120 s timeout, 256 MB
 *    (docs.dynatrace.com/docs/analyze-explore-automate/workflows/default-workflow-actions/run-javascript-workflow-action)
 *  - relative URLs (e.g. /apps/<appId>/api/<fn>) get platform auth attached — VERIFIED live on a
 *    trial tenant 2026-11-26 (relative POST to the Events API returned 201 without an auth header);
 *    absolute URLs must be on the global allowlist (Settings → External requests)
 *  - @dynatrace-sdk/automation-utils 2.5.1: execution() → { params, input, triggerType, … },
 *    result('<task>') (dt-app-mcp get_sdk)
 *  - Credential Vault: credentialVaultEntriesClient.getCredentialVaultEntryDetails({ entryId })
 *    from @dynatrace-sdk/client-credential-vault, then `credential.token` (same docs page).
 *    ⚠️ UNVERIFIED: the only published npm types (client-credential-vault 1.0.0) do NOT declare
 *    getCredentialVaultEntryDetails (only get/list/create/update/delete CredentialVaultEntry);
 *    the scripts feature-detect it and fail with a clear message. Field names other than `token`
 *    (username/user, password) are also UNVERIFIED.
 *  - globals btoa, AbortSignal.timeout, URLSearchParams, fetch are declared in
 *    node_modules/@dynatrace/js-runtime/types/runtime/runtime.d.ts (l.1996, l.2184, l.4016).
 *
 * Generated JS uses no template literals so it can live inside TS template strings safely.
 */

/** Overall budget per send task (the action hard limit is 120 s). */
export const TASK_BUDGET_MS = 100_000;
/** Per-request timeout. */
export const REQUEST_TIMEOUT_MS = 10_000;

export const IMPORT_RESULT = `import { result } from "@dynatrace-sdk/automation-utils";`;
export const IMPORT_EXECUTION = `import { execution } from "@dynatrace-sdk/automation-utils";`;
export const IMPORT_VAULT = `import { credentialVaultEntriesClient } from "@dynatrace-sdk/client-credential-vault";`;

/**
 * Helpers shared by every sender: vault access, secret-free error text, the per-item loop.
 * `send(n, provider, cred)` is defined by each channel script and returns a provider reference.
 */
export const SENDER_RUNTIME = `
var TASK_BUDGET_MS = ${TASK_BUDGET_MS};
var REQUEST_TIMEOUT_MS = ${REQUEST_TIMEOUT_MS};

async function readCredential(provider) {
  if (!provider.credentialVaultId) throw new Error("provider " + provider.id + " has no credential vault entry");
  if (typeof credentialVaultEntriesClient.getCredentialVaultEntryDetails !== "function") {
    throw new Error("credential vault client has no getCredentialVaultEntryDetails in this runtime");
  }
  var c = await credentialVaultEntriesClient.getCredentialVaultEntryDetails({ entryId: provider.credentialVaultId });
  c = c || {};
  return { token: c.token, user: c.username || c.user, password: c.password };
}

function secretValues(cred) {
  return [cred && cred.token, cred && cred.user, cred && cred.password].filter(function (s) {
    return typeof s === "string" && s.length >= 4;
  });
}

// Error text without secrets: never include URLs (several embed the key) or credential values.
function safeError(e, secrets) {
  var m = e && e.name === "TimeoutError" ? "request timed out" : String((e && e.message) || e || "error");
  for (var i = 0; i < secrets.length; i++) m = m.split(secrets[i]).join("***");
  m = m.replace(/https?:\\/\\/\\S+/g, "<url>");
  return m.slice(0, 300);
}

async function httpError(res) {
  var detail = "";
  try { detail = (await res.text()).slice(0, 200); } catch (e) { detail = ""; }
  return new Error("HTTP " + res.status + (detail ? ": " + detail : ""));
}

function post(url, init) {
  init.method = "POST";
  init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(url, init);
}

// Links are only rendered as buttons when absolute (the engine may not know the environment URL).
function isAbsolute(url) {
  return typeof url === "string" && url.indexOf("https://") === 0;
}

function forUser(n) {
  return (n.to && (n.to.name || n.to.address)) || "";
}

async function runChannel(channel, send) {
  var tick = await result("tick");
  var items = (tick && tick.batches && tick.batches[channel]) || [];
  var results = [];
  if (!items.length) return { channel: channel, results: results };
  var providers = (tick && tick.providers) || [];
  var creds = {};
  var started = Date.now();
  for (var i = 0; i < items.length; i++) {
    var n = items[i];
    // Items not attempted are not reported; the engine times them out and retries next tick.
    if (Date.now() - started > TASK_BUDGET_MS - REQUEST_TIMEOUT_MS) break;
    var at = Date.now();
    var cred = null;
    try {
      var provider = providers.find(function (p) { return p.id === n.providerId; });
      if (!provider) throw new Error("provider " + n.providerId + " is not configured");
      if (provider.enabled === false) throw new Error("provider " + n.providerId + " is disabled");
      if (!creds[provider.id]) creds[provider.id] = await readCredential(provider);
      cred = creds[provider.id];
      var ref = await send(n, provider, cred);
      results.push({ key: n.key, status: "sent", providerRef: ref ? String(ref).slice(0, 100) : undefined, at: at });
    } catch (e) {
      results.push({ key: n.key, status: "failed", error: safeError(e, secretValues(cred)), at: at });
    }
  }
  return { channel: channel, results: results };
}
`;
