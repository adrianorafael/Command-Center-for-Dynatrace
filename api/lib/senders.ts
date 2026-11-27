/**
 * Notification senders, run inside the app (custom workflow action and app functions).
 *
 * Port of the former workflow "Run JavaScript" sender scripts. Vendor APIs (unchanged):
 *  - Twilio Messages / Calls: POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/{Messages|Calls}.json,
 *    form-encoded, HTTP Basic (SID + auth token); WhatsApp uses the "whatsapp:" address prefix; voice uses TwiML <Say>.
 *  - IFTTT Webhooks: POST https://maker.ifttt.com/trigger/{event}/with/key/{key} with value1..value3.
 *  - Slack incoming webhook: POST {text, blocks} to https://hooks.slack.com/…
 *  - Microsoft Teams Workflows webhook: POST {type: "message", attachments: [Adaptive Card]}.
 *  - Telegram Bot API: POST https://api.telegram.org/bot{token}/sendMessage (plain text, no parse_mode).
 *  - Generic webhook: POST {source, version, notification} JSON to any https URL.
 *
 * Secrets come from the Credential Vault through the platform API
 * GET /platform/credential-vault/v1/entries/{id}/details (scope credential-vault:entries:read) — verified on a
 * tenant from a custom action: the plain entry endpoint returns metadata only, /details returns the secret.
 * Secrets are never returned, logged or stored: errors are redacted before they leave this module.
 */

import { EXTERNAL_REQUESTS_PATH, HOST_NOT_ALLOWED } from "../../ui/app/domain/outboundHosts";
import type { Channel, DeliveryResult, NotificationRequest } from "../../ui/app/domain/contracts";
import type { ProviderView } from "./engine";

/** Timeout of one provider HTTP request; sendAll also stops this long before its deadline. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Secret fields of a Credential Vault entry (token entry, or username/password entry). Never persisted. */
export interface Credential {
  token?: string;
  user?: string;
  password?: string;
}

/** Injected I/O for the senders (real fetch and vault reader in production, fakes in tests). */
export interface SenderDeps {
  fetch: typeof fetch;
  readCredential: (vaultId: string) => Promise<Credential>;
  now?: () => number;
  /** Called for each notification handed to an integration's own workflow (no result yet). */
  onHandOff?: (key: string) => void;
}

type SendFn = (n: NotificationRequest, provider: ProviderView, cred: Credential, deps: SenderDeps) => Promise<string | undefined>;

/**
 * Per-integration workflow: a built-in provider whose params.workflowId is set is sent by its own simple workflow
 * ("Command Center · <provider>", one task: this app's send-notification action). The engine runs that workflow
 * with the notification as params; the action sends and records the result in the ledger itself. If the run is
 * refused, the engine sends directly so nobody misses a page.
 */
export const PROVIDER_WORKFLOW_PARAM = "workflowId";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function secretValues(cred: Credential | null): string[] {
  return [cred?.token, cred?.user, cred?.password].filter((s): s is string => typeof s === "string" && s.length >= 4);
}

/**
 * The Dynatrace JavaScript runtime refuses hosts that are not on the environment's allowlist with an error named
 * "NotCapable" and this message (observed on a trial tenant, 2026-11-27):
 *   Blocked request to 'example.org' (host not in allowlist). To find out about how to manage allowed domains …
 */
const BLOCKED_HOST_RE = /Blocked request to '([^']+)' \(host not in allowlist\)/;

/** Error text without secrets: credential values and every URL (several embed keys) are removed, then truncated. */
export function safeError(e: unknown, secrets: string[]): string {
  const err = e as { name?: string; message?: string } | undefined;
  let m = err?.name === "TimeoutError" ? "request timed out" : typeof err?.message === "string" ? err.message : typeof e === "string" ? e : "error";
  // Say exactly what to do: the host name is not a secret, the rest of the URL may be.
  const blocked = BLOCKED_HOST_RE.exec(m);
  if (blocked) m = `${HOST_NOT_ALLOWED}: ${blocked[1]}. Add it in ${EXTERNAL_REQUESTS_PATH}.`;
  for (const s of secrets) m = m.split(s).join("***");
  m = m.replace(/https?:\/\/\S+/g, "<url>");
  return m.slice(0, 300);
}

async function httpError(res: Response): Promise<Error> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 65536);
  } catch {
    detail = "";
  }
  return new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
}

function post(deps: SenderDeps, url: string, init: RequestInit): Promise<Response> {
  return deps.fetch(url, { ...init, method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

const isAbsolute = (url: string | undefined): url is string => typeof url === "string" && url.startsWith("https://");

/** Slack mrkdwn escaping (&, <, >): also neutralises <!channel>, <@U…> mentions and <url|text> links. */
export const slackEscape = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Adaptive Card markdown: backslash-escape markdown syntax so alert text cannot form links or emphasis. */
export const cardEscape = (s: string) => String(s).replace(/([\\[\]()*_`~#>!|])/g, "\\$1");

/** XML escaping for text placed inside TwiML. */
export const xmlEscape = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const forUser = (n: NotificationRequest) => n.to?.name || n.to?.address || "";

// ─── Twilio ──────────────────────────────────────────────────────────────────

function twilioAccount(provider: ProviderView, cred: Credential): string {
  const sid = provider.params?.accountSid || cred.user || "";
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) throw new Error("Twilio account SID missing or malformed (params.accountSid)");
  return sid;
}

function twilioSender(provider: ProviderView, prefix: string): Record<string, string> {
  const p = provider.params ?? {};
  if (p.messagingServiceSid && !prefix) return { MessagingServiceSid: p.messagingServiceSid };
  if (!p.from) throw new Error("Twilio provider needs params.from");
  return { From: prefix && !p.from.startsWith(prefix) ? prefix + p.from : p.from };
}

async function twilioPost(deps: SenderDeps, provider: ProviderView, cred: Credential, resource: string, form: Record<string, string>) {
  if (!cred.user || !cred.password) throw new Error("Twilio credential needs username (SID) and password (token)");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccount(provider, cred)}/${resource}.json`;
  const res = await post(deps, url, {
    headers: { Authorization: `Basic ${btoa(`${cred.user}:${cred.password}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) throw await httpError(res);
  const json = (await res.json()) as { sid?: string };
  return json?.sid;
}

const sendSms: SendFn = (n, provider, cred, deps) =>
  twilioPost(deps, provider, cred, "Messages", { To: n.to.address, Body: n.text.slice(0, 1600), ...twilioSender(provider, "") });

const sendWhatsapp: SendFn = (n, provider, cred, deps) =>
  twilioPost(deps, provider, cred, "Messages", {
    To: n.to.address.startsWith("whatsapp:") ? n.to.address : `whatsapp:${n.to.address}`,
    Body: n.text.slice(0, 1600),
    ...twilioSender(provider, "whatsapp:"),
  });

const sendVoice: SendFn = (n, provider, cred, deps) => {
  const p = provider.params ?? {};
  let attrs = "";
  if (p.voice && /^[A-Za-z0-9._-]{1,60}$/.test(p.voice)) attrs += ` voice="${p.voice}"`;
  if (p.language && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(p.language)) attrs += ` language="${p.language}"`;
  const say = xmlEscape((n.speech || n.text).slice(0, 1000));
  const twiml = `<Response><Say${attrs}>${say}</Say><Pause length="1"/><Say${attrs}>${say}</Say></Response>`;
  const form = { To: n.to.address, Twiml: twiml, ...twilioSender(provider, "") };
  if ("MessagingServiceSid" in form) throw new Error("Twilio voice needs params.from (a voice-capable number)");
  return twilioPost(deps, provider, cred, "Calls", form);
};

// ─── IFTTT, Slack, Teams, Telegram, webhook ──────────────────────────────────

const sendIfttt: SendFn = async (n, provider, cred, deps) => {
  const event = provider.params?.eventName || provider.params?.event || "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(event)) throw new Error("IFTTT provider needs params.eventName ([A-Za-z0-9_-])");
  if (!cred.token) throw new Error("IFTTT credential needs a token (Webhooks key)");
  const res = await post(deps, `https://maker.ifttt.com/trigger/${event}/with/key/${encodeURIComponent(cred.token)}`, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value1: n.subject, value2: n.text, value3: n.incidentUrl }),
  });
  if (!res.ok) throw await httpError(res);
  return undefined;
};

const sendSlack: SendFn = async (n, _provider, cred, deps) => {
  const url = cred.token || "";
  if (!url.startsWith("https://hooks.slack.com/")) throw new Error("Slack credential must hold an https://hooks.slack.com/ webhook URL");
  const who = forUser(n);
  const text = slackEscape((who ? `${who}: ` : "") + n.text);
  const link = isAbsolute(n.incidentUrl) ? `<${n.incidentUrl.replace(/[<>|]/g, "")}|Open in Command Center> · ` : "";
  const res = await post(deps, url, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text.slice(0, 3000),
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${slackEscape(n.subject)}*\n${text}`.slice(0, 3000) } },
        { type: "context", elements: [{ type: "mrkdwn", text: link + slackEscape(n.priority) }] },
      ],
    }),
  });
  if (!res.ok) throw await httpError(res);
  return undefined;
};

const sendTeams: SendFn = async (n, _provider, cred, deps) => {
  const url = cred.token || "";
  if (!url.startsWith("https://")) throw new Error("Teams credential must hold an https webhook URL");
  const who = forUser(n);
  const card: Record<string, unknown> = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      { type: "TextBlock", text: cardEscape(n.subject.slice(0, 300)), weight: "Bolder", size: "Medium", wrap: true },
      { type: "TextBlock", text: cardEscape(((who ? `${who}: ` : "") + n.text).slice(0, 4000)), wrap: true },
    ],
  };
  if (isAbsolute(n.incidentUrl)) card.actions = [{ type: "Action.OpenUrl", title: "Open in Command Center", url: n.incidentUrl }];
  const res = await post(deps, url, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }] }),
  });
  if (!res.ok) throw await httpError(res);
  return undefined;
};

const sendTelegram: SendFn = async (n, _provider, cred, deps) => {
  if (!cred.token) throw new Error("Telegram credential needs a token (bot token)");
  // Plain text on purpose: no parse_mode, so alert text can never be interpreted as markup.
  const res = await post(deps, `https://api.telegram.org/bot${cred.token}/sendMessage`, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: n.to.address, text: `${n.subject}\n${n.text}\n${n.incidentUrl}`.slice(0, 4096), link_preview_options: { is_disabled: true } }),
  });
  type TelegramReply = { ok?: boolean; description?: string; result?: { message_id?: number } };
  const json = (await res.json().catch(() => null)) as TelegramReply | null;
  if (!res.ok || !json || json.ok !== true) throw new Error(`HTTP ${res.status}${json?.description ? `: ${json.description}` : ""}`);
  return json.result?.message_id !== undefined ? String(json.result.message_id) : undefined;
};

const sendWebhook: SendFn = async (n, provider, cred, deps) => {
  // Token entry: the URL. Username/password entry: username = URL, password = auth header value.
  const url = cred.token || cred.user || "";
  if (!url.startsWith("https://")) throw new Error("Webhook credential must hold an https URL");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const h = provider.params?.authHeader;
  if (h && /^[A-Za-z0-9-]{1,60}$/.test(h) && cred.password) headers[h] = cred.password;
  const res = await post(deps, url, { headers, body: JSON.stringify({ source: "command-center", version: 1, notification: n }) });
  if (!res.ok) throw await httpError(res);
  return res.headers.get("x-request-id") ?? undefined;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Custom workflow: runs a workflow the customer owns, passing the notification as run params
 * (POST /platform/automation/v1/workflows/{id}/run, scope automation:workflows:run). The prefilled example
 * workflow reads them with the expression {{ execution().params | to_json }} (verified on a trial tenant).
 * "Sent" means the run was accepted; what the workflow does afterwards is the customer's.
 * sendAll uses the same call for the opt-in hand-off to an integration's own workflow.
 */
async function runWorkflow(deps: SenderDeps, id: string, n: NotificationRequest): Promise<string | undefined> {
  const res = await post(deps, `/platform/automation/v1/workflows/${id}/run`, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params: { source: "command-center", version: 1, notification: n } }),
  });
  if (!res.ok) throw await httpError(res);
  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return json?.id;
}

const sendViaWorkflow: SendFn = async (n, provider, _cred, deps) => {
  const id = (provider.params?.workflowId ?? "").trim();
  if (!UUID.test(id)) throw new Error("Custom workflow provider needs params.workflowId (the workflow UUID)");
  return runWorkflow(deps, id, n);
};

/** Sends one notification directly through its provider (vault secret + provider API). */
export async function deliverDirect(n: NotificationRequest, provider: ProviderView, deps: SenderDeps, creds = new Map<string, Credential>()): Promise<DeliveryResult> {
  const now = deps.now ?? Date.now;
  const at = now();
  let cred: Credential | null = null;
  try {
    if (!provider.enabled) throw new Error(`provider ${provider.id} is disabled`);
    let ref: string | undefined;
    if (provider.kind === "workflow") {
      ref = await sendViaWorkflow(n, provider, {}, deps);
    } else {
      if (!provider.credentialVaultId) throw new Error(`provider ${provider.id} has no credential vault entry`);
      if (!creds.has(provider.id)) creds.set(provider.id, await deps.readCredential(provider.credentialVaultId));
      cred = creds.get(provider.id) ?? null;
      ref = await SENDERS[n.channel](n, provider, cred ?? {}, deps);
    }
    return { key: n.key, status: "sent", ...(ref ? { providerRef: String(ref).slice(0, 100) } : {}), at };
  } catch (e) {
    return { key: n.key, status: "failed", error: safeError(e, secretValues(cred)), at };
  }
}

/** Sender per channel for built-in providers; its key order is also the order in which sendAll walks the channels. */
export const SENDERS: Record<Channel, SendFn> = {
  sms: sendSms,
  voice: sendVoice,
  whatsapp: sendWhatsapp,
  ifttt: sendIfttt,
  slack: sendSlack,
  teams: sendTeams,
  telegram: sendTelegram,
  webhook: sendWebhook,
};

/**
 * Sends every notification of every channel, one request at a time, until `deadline` (epoch ms). A provider with a
 * linked workflow (params.workflowId) gets a hand-off instead of a direct send (see PROVIDER_WORKFLOW_PARAM).
 * Items not attempted before the deadline are not reported: the ledger times them out and the engine
 * retries them with a new attempt number on a later cycle.
 */
export async function sendAll(
  batches: Partial<Record<Channel, NotificationRequest[]>>,
  providers: readonly ProviderView[],
  deadline: number,
  deps: SenderDeps,
): Promise<DeliveryResult[]> {
  const now = deps.now ?? Date.now;
  const creds = new Map<string, Credential>();
  const results: DeliveryResult[] = [];
  for (const channel of Object.keys(SENDERS) as Channel[]) {
    for (const n of batches[channel] ?? []) {
      if (now() > deadline - REQUEST_TIMEOUT_MS) return results;
      const provider = providers.find((p) => p.id === n.providerId);
      if (!provider) {
        results.push({ key: n.key, status: "failed", error: `provider ${n.providerId} is not configured`, at: now() });
        continue;
      }
      const ownWorkflow = provider.kind !== "workflow" && provider.enabled ? (provider.params?.[PROVIDER_WORKFLOW_PARAM] ?? "").trim() : "";
      if (UUID.test(ownWorkflow)) {
        try {
          // Handed to the integration's own workflow: its action records the result in the ledger.
          await runWorkflow(deps, ownWorkflow, n);
          deps.onHandOff?.(n.key);
          continue;
        } catch {
          // The workflow could not be run (deleted, no permission): send directly so nobody misses a page.
        }
      }
      results.push(await deliverDirect(n, provider, deps, creds));
    }
  }
  return results;
}

/** Reads a Credential Vault entry's secret through the platform API (relative URL: platform auth is attached). */
export function vaultReader(fetchFn: typeof fetch): (vaultId: string) => Promise<Credential> {
  return async (vaultId) => {
    if (!/^[A-Z_]+-[0-9A-F]{16}$/.test(vaultId)) throw new Error("invalid credential vault entry id");
    const res = await fetchFn(`/platform/credential-vault/v1/entries/${encodeURIComponent(vaultId)}/details`);
    if (!res.ok) throw new Error(`credential vault returned HTTP ${res.status}`);
    const c = (await res.json()) as { token?: string; username?: string; user?: string; password?: string };
    return { token: c.token, user: c.username ?? c.user, password: c.password };
  };
}
