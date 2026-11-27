import { describe, expect, it, vi } from "vitest";

vi.mock("@dynatrace-sdk/app-environment", () => ({ getEnvironmentUrl: () => "dt.missing", getAppId: () => "dt.missing" }));

import { SCHEMA_VERSION, type EscalationPolicy, type NotificationRecord, type NotificationRequest, type Settings, type UserContact } from "../../ui/app/domain/contracts";
import { KEY, PREFIX } from "../../ui/app/data/repository";
import { MemoryRepository } from "../../ui/app/data/memoryRepository";
import { defaultSettings } from "../../ui/app/data/domainPort";
import type { RunQuery } from "../../ui/app/data/grail";
import { runEngineCycle } from "../lib/cycle";
import { cardEscape, safeError, sendAll, slackEscape, vaultReader, type Credential } from "../lib/senders";
import type { ProviderView } from "../lib/engine";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const SID = `AC${"0".repeat(32)}`;

function note(over: Partial<NotificationRequest> = {}): NotificationRequest {
  return {
    key: "dp-p-1.1.0.abc.sms.1",
    incidentId: "dp-p-1",
    cycle: 1,
    step: 0,
    attempt: 1,
    channel: "sms",
    providerId: "p",
    to: { uid: "user-0001", address: "+15550000002", name: "Ana" },
    subject: "[P1] P-1 <!channel> outage",
    text: "P1 P-1: outage [click](https://evil.example)",
    priority: "P1",
    incidentUrl: "https://YOUR-ENVIRONMENT.apps.dynatrace.com/ui/apps/my.command.center/incidents/dp-p-1",
    ...over,
  };
}

const provider = (over: Partial<ProviderView> = {}): ProviderView => ({ id: "p", channel: "sms", kind: "twilio", enabled: true, credentialVaultId: "CREDENTIAL_VAULT_ENTRY-0000000000000001", params: { from: "+15550000001" }, ...over });

function okFetch(body: unknown = { sid: "SM1" }) {
  return vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify(body), { status: 200, headers: { "x-request-id": "r1" } }));
}

const deps = (fetchFn: ReturnType<typeof okFetch>, cred: Credential, now = () => NOW) => ({ fetch: fetchFn as unknown as typeof fetch, readCredential: vi.fn(async () => cred), now });

describe("senders", () => {
  it("Twilio SMS posts form data with Basic auth to the Messages resource", async () => {
    const f = okFetch();
    const r = await sendAll({ sms: [note()] }, [provider()], NOW + 60_000, deps(f, { user: SID, password: "secret-token" }));
    expect(r).toEqual([{ key: note().key, status: "sent", providerRef: "SM1", at: NOW }]);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa(`${SID}:secret-token`)}`);
    expect(String(init?.body)).toContain("To=%2B15550000002");
  });

  it("voice call sends XML-escaped TwiML", async () => {
    const f = okFetch();
    await sendAll({ voice: [note({ channel: "voice", speech: `Alert <Hangup/> & "quotes"` })] }, [provider({ channel: "voice" })], NOW + 60_000, deps(f, { user: SID, password: "secret-token" }));
    const body = new URLSearchParams(String(f.mock.calls[0][1]?.body));
    expect(body.get("Twiml")).toContain("Alert &lt;Hangup/&gt; &amp; &quot;quotes&quot;");
    expect(String(f.mock.calls[0][0])).toContain("/Calls.json");
  });

  it("Slack escapes mentions and links; refuses a non-Slack URL", async () => {
    expect(slackEscape("<!channel> <https://x|y> & z")).toBe("&lt;!channel&gt; &lt;https://x|y&gt; &amp; z");
    const f = okFetch({});
    await sendAll({ slack: [note({ channel: "slack" })] }, [provider({ channel: "slack", kind: "slack-webhook" })], NOW + 60_000, deps(f, { token: "https://hooks.slack.com/services/T/B/X" }));
    expect(String(f.mock.calls[0][1]?.body)).not.toContain("<!channel>");
    const g = okFetch({});
    const r = await sendAll({ slack: [note({ channel: "slack" })] }, [provider({ channel: "slack", kind: "slack-webhook" })], NOW + 60_000, deps(g, { token: "https://attacker.example/hook" }));
    expect(r[0].status).toBe("failed");
    expect(g).not.toHaveBeenCalled();
  });

  it("Teams escapes markdown so alert text cannot form links", () => {
    expect(cardEscape("[click](https://evil)")).toBe("\\[click\\]\\(https://evil\\)");
  });

  it("Telegram sends plain text (no parse_mode) and returns the message id", async () => {
    const f = okFetch({ ok: true, result: { message_id: 42 } });
    const r = await sendAll({ telegram: [note({ channel: "telegram", to: { uid: "u", address: "12345" } })] }, [provider({ channel: "telegram", kind: "telegram-bot" })], NOW + 60_000, deps(f, { token: "123:abc" }));
    expect(r[0]).toMatchObject({ status: "sent", providerRef: "42" });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).not.toHaveProperty("parse_mode");
  });

  it("generic webhook posts the full notification with the optional auth header", async () => {
    const f = okFetch({});
    await sendAll({ webhook: [note({ channel: "webhook" })] }, [provider({ channel: "webhook", kind: "webhook", params: { authHeader: "X-Api-Key" } })], NOW + 60_000, deps(f, { token: "https://receiver.example/in", password: "k3y-value" }));
    const init = f.mock.calls[0][1];
    expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe("k3y-value");
    expect(JSON.parse(String(init?.body))).toMatchObject({ source: "command-center", version: 1, notification: { key: note().key } });
  });

  it("generic webhook accepts a username/password entry (username = URL, password = header value)", async () => {
    const f = okFetch({});
    await sendAll({ webhook: [note({ channel: "webhook" })] }, [provider({ channel: "webhook", kind: "webhook", params: { authHeader: "Authorization" } })], NOW + 60_000, deps(f, { user: "https://receiver.example/in", password: "Bearer abc" }));
    expect(f.mock.calls[0][0]).toBe("https://receiver.example/in");
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)["Authorization"]).toBe("Bearer abc");
  });

  it("custom workflow runs the customer's workflow with the notification as params, without a vault entry", async () => {
    const f = okFetch({ id: "exec-1" });
    const d = deps(f, {});
    const wf = "00000000-0000-4000-8000-0000000000c1";
    const r = await sendAll({ webhook: [note({ channel: "webhook", providerId: "custom-workflow" })] }, [provider({ id: "custom-workflow", channel: "webhook", kind: "workflow", credentialVaultId: undefined, params: { workflowId: wf } })], NOW + 60_000, d);
    expect(f.mock.calls[0][0]).toBe(`/platform/automation/v1/workflows/${wf}/run`);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toMatchObject({ params: { source: "command-center", version: 1, notification: { key: note().key } } });
    expect(d.readCredential).not.toHaveBeenCalled();
    expect(r[0]).toMatchObject({ status: "sent", providerRef: "exec-1" });
  });

  it("custom workflow without a valid workflow id fails without calling anything", async () => {
    const f = okFetch({});
    const r = await sendAll({ webhook: [note({ channel: "webhook", providerId: "cw" })] }, [provider({ id: "cw", channel: "webhook", kind: "workflow", params: { workflowId: "not-a-uuid" } })], NOW + 60_000, deps(f, {}));
    expect(f).not.toHaveBeenCalled();
    expect(r[0].status).toBe("failed");
  });

  it("a built-in provider linked to its own workflow is handed to that workflow (no result yet)", async () => {
    const f = okFetch({ id: "exec-2" });
    const handed: string[] = [];
    const wf = "00000000-0000-4000-8000-0000000000c2";
    const d = { ...deps(f, { user: SID, password: "tok" }), onHandOff: (k: string) => handed.push(k) };
    const r = await sendAll({ sms: [note()] }, [provider({ params: { from: "+15550000001", workflowId: wf } })], NOW + 60_000, d);
    expect(f.mock.calls[0][0]).toBe(`/platform/automation/v1/workflows/${wf}/run`);
    expect(r).toEqual([]);
    expect(handed).toEqual([note().key]);
    expect(d.readCredential).not.toHaveBeenCalled();
  });

  it("falls back to a direct send when the integration's workflow cannot be run", async () => {
    let call = 0;
    const f = vi.fn(async () => (call++ === 0 ? new Response("gone", { status: 404 }) : new Response(JSON.stringify({ sid: "SM9" }), { status: 201 })));
    const r = await sendAll({ sms: [note()] }, [provider({ params: { from: "+15550000001", workflowId: "00000000-0000-4000-8000-0000000000c2" } })], NOW + 60_000, { fetch: f as unknown as typeof fetch, readCredential: async () => ({ user: SID, password: "tok" }), now: () => NOW });
    expect(r[0]).toMatchObject({ status: "sent", providerRef: "SM9" });
  });

  it("never leaks secrets or URLs in error text", async () => {
    expect(safeError(new Error("bad token secret-token at https://api.twilio.com/x"), ["secret-token"])).toBe("bad token *** at <url>");
    const f = vi.fn(async () => new Response("echo secret-token", { status: 401 }));
    const r = await sendAll({ sms: [note()] }, [provider()], NOW + 60_000, { fetch: f as unknown as typeof fetch, readCredential: async () => ({ user: SID, password: "secret-token" }), now: () => NOW });
    expect(r[0].status).toBe("failed");
    expect(r[0].error).not.toContain("secret-token");
  });

  it("reads each provider credential once and stops before the deadline", async () => {
    const f = okFetch();
    const d = deps(f, { user: SID, password: "secret-token" });
    let t = NOW;
    d.now = () => (t += 30_000);
    const r = await sendAll({ sms: [note({ key: "a" }), note({ key: "b" }), note({ key: "c" })] }, [provider()], NOW + 75_000, d);
    expect(r.map((x) => x.key)).toEqual(["a"]);
    expect(d.readCredential).toHaveBeenCalledTimes(1);
  });

  it("fails items whose provider is unknown, disabled or has no vault entry", async () => {
    const f = okFetch();
    const r = await sendAll(
      { sms: [note({ key: "x", providerId: "nope" }), note({ key: "y" })] },
      [provider({ enabled: false })],
      NOW + 60_000,
      deps(f, {}),
    );
    expect(r.map((x) => x.status)).toEqual(["failed", "failed"]);
    expect(f).not.toHaveBeenCalled();
  });

  it("vault reader calls the platform details endpoint and validates the id", async () => {
    const f = vi.fn(async (_u: unknown) => new Response(JSON.stringify({ token: "t0ken", username: "u", password: "p" }), { status: 200 }));
    const read = vaultReader(f as unknown as typeof fetch);
    expect(await read("CREDENTIAL_VAULT_ENTRY-0000000000000002")).toEqual({ token: "t0ken", user: "u", password: "p" });
    expect(String(f.mock.calls[0][0])).toBe("/platform/credential-vault/v1/entries/CREDENTIAL_VAULT_ENTRY-0000000000000002/details");
    await expect(read("../../etc")).rejects.toThrow("invalid credential vault entry id");
  });
});

describe("engine cycle (tick → send → report in one invocation)", () => {
  const problem = {
    timestamp: "2026-11-26T11:59:00.000000000Z",
    "event.id": "P-00001",
    display_id: "P-00001",
    "event.name": "Checkout latency high",
    "event.category": "CUSTOM_ALERT",
    "event.status": "ACTIVE",
    "event.start": "2026-11-26T11:58:00.000000000Z",
    "event.end": null,
    "dt.davis.event_ids": [],
    "maintenance.is_under_maintenance": false,
  };
  const policy: EscalationPolicy = { schemaVersion: SCHEMA_VERSION, id: "pol-1", name: "Default", rev: 1, repeat: 0, steps: [{ delayMinutes: 0, targets: [{ type: "user", uid: "user-0001" }] }] };
  const contact: UserContact = { schemaVersion: SCHEMA_VERSION, uid: "user-0001", rev: 1, displayName: "Ana", methods: [{ id: "m1", channel: "sms", address: "+15550000002" }], rules: [{ maxPriority: "P5", methodId: "m1", delayMinutes: 0 }] };
  function repo() {
    const s: Settings = defaultSettings();
    s.defaults.policyId = "pol-1";
    s.providers = s.providers.map((p) => (p.id === "twilio-sms" ? { ...p, enabled: true, credentialVaultId: "CREDENTIAL_VAULT_ENTRY-0000000000000001", params: { from: "+15550000001", accountSid: SID } } : p));
    return new MemoryRepository([{ key: KEY.settings, value: s }, { key: KEY.policy("pol-1"), value: policy }, { key: KEY.contact("user-0001"), value: contact }], { now: () => NOW });
  }
  const grail = vi.fn(async (q: string) => (q.startsWith("fetch dt.davis.problems") ? [problem] : [])) as unknown as RunQuery;

  it("pages the on-call person and records 'sent' in the ledger, all in one run", async () => {
    const r = repo();
    const f = okFetch();
    const res = await runEngineCycle({ reason: "schedule" }, { repo: r, runQuery: grail, now: () => NOW, fetch: f as unknown as typeof fetch, readCredential: async () => ({ user: SID, password: "secret-token" }) });
    expect(res).toMatchObject({ ok: true, sent: 1, failed: 0, deferred: 0 });
    const ledger = (await r.list<NotificationRecord>(PREFIX.notification)).map((x) => x.value);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ status: "sent", providerRef: "SM1" });
    // A second run plans nothing new (idempotent).
    const again = await runEngineCycle({ reason: "schedule" }, { repo: r, runQuery: grail, now: () => NOW + 1000, fetch: f as unknown as typeof fetch, readCredential: async () => ({ user: SID, password: "secret-token" }) });
    expect(again.sent).toBe(0);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
