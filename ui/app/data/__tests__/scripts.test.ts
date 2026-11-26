import { describe, expect, it } from "vitest";
import type { NotificationRequest, ProviderConfig } from "../../domain/contracts";
import { reportScript, tickScript } from "../workflows/scripts/engine";
import {
  SENDER_TASKS,
  SEND_IFTTT,
  SEND_SLACK,
  SEND_TEAMS,
  SEND_TELEGRAM,
  SEND_TWILIO_SMS,
  SEND_TWILIO_VOICE,
  SEND_TWILIO_WHATSAPP,
  SEND_WEBHOOK,
} from "../workflows/scripts/senders";
import { compileScript, runScript, type FetchCall } from "./test-utils";

// Obviously fake test credentials, assembled at runtime so no literal looks like a secret.
const FAKE = (tag: string) => ["fake", tag, "0000"].join("-");
const ACCOUNT_SID = "AC" + "0".repeat(32);
const TOKEN = FAKE("token");
const SLACK_URL = "https://hooks.slack.com/services/" + FAKE("slack");
const TEAMS_URL = "https://example.invalid/workflows/" + FAKE("teams");
const HOOK_URL = "https://example.invalid/hook/" + FAKE("hook");

function req(channel: NotificationRequest["channel"], providerId: string, address: string): NotificationRequest {
  return {
    key: `inc-1.0.0.abc.${channel}.1`,
    incidentId: "inc-1",
    cycle: 0,
    step: 0,
    attempt: 1,
    channel,
    providerId,
    to: { uid: "user-0001", address, name: "Ana Example" },
    subject: "[P1] Checkout latency <high> & rising",
    text: "P-00001 Checkout latency high on checkout-service",
    speech: "Priority one. Checkout latency high.",
    priority: "P1",
    incidentUrl: "https://YOUR-ENVIRONMENT.apps.dynatrace.com/ui/apps/my.command.center/incidents/inc-1",
    displayId: "P-00001",
  };
}

function provider(id: string, channel: ProviderConfig["channel"], kind: ProviderConfig["kind"], params: Record<string, string> = {}): ProviderConfig {
  return { id, name: id, channel, kind, enabled: true, credentialVaultId: `CREDENTIALS_VAULT-${id.toUpperCase()}`, params };
}

const credentials = {
  "CREDENTIALS_VAULT-TWILIO": { username: ACCOUNT_SID, password: TOKEN },
  "CREDENTIALS_VAULT-IFTTT": { token: TOKEN },
  "CREDENTIALS_VAULT-SLACK": { token: SLACK_URL },
  "CREDENTIALS_VAULT-TEAMS": { token: TEAMS_URL },
  "CREDENTIALS_VAULT-TELEGRAM": { token: TOKEN },
  "CREDENTIALS_VAULT-HOOK": { token: HOOK_URL, password: TOKEN },
};

const providers: ProviderConfig[] = [
  provider("twilio", "sms", "twilio", { from: "+15550000001" }),
  provider("ifttt", "ifttt", "ifttt", { eventName: "cc_page" }),
  provider("slack", "slack", "slack-webhook"),
  provider("teams", "teams", "teams-webhook"),
  provider("telegram", "telegram", "telegram-bot"),
  provider("hook", "webhook", "webhook", { authHeader: "X-Api-Key" }),
];

function tick(channel: NotificationRequest["channel"], n: NotificationRequest[]) {
  return { ok: true, batches: { [channel]: n }, providers };
}

type SenderOutput = { channel: string; results: { key: string; status: string; providerRef?: string; error?: string }[] };

function assertNoSecrets(output: unknown) {
  const s = JSON.stringify(output);
  for (const secret of [TOKEN, SLACK_URL, TEAMS_URL, HOOK_URL, FAKE("slack"), FAKE("teams"), FAKE("hook")]) {
    expect(s).not.toContain(secret);
  }
}

function form(call: FetchCall) {
  return Object.fromEntries(new URLSearchParams(call.init.body ?? ""));
}

describe("workflow task sources compile", () => {
  const all = [
    ["tick", tickScript("my.command.center")],
    ["report", reportScript("my.command.center")],
    ...SENDER_TASKS.map((t) => [t.name, t.script]),
  ] as const;
  it.each(all)("%s is valid JS with a default export", (_name, src) => {
    expect(src).toMatch(/export default async function/);
    expect(() => compileScript(src)).not.toThrow();
  });
  it("rejects a malformed app id", () => {
    expect(() => tickScript("bad id'; drop")).toThrow();
  });
});

describe("Twilio senders", () => {
  it("SMS posts form data with Basic auth to the Messages resource", async () => {
    const { output, calls } = await runScript(SEND_TWILIO_SMS, {
      tickResult: tick("sms", [req("sms", "twilio", "+15550000002")]),
      credentials,
      respond: () => ({ status: 201, body: { sid: "SM" + "1".repeat(32) } }),
    });
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
    expect(c.init.method).toBe("POST");
    expect(c.init.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(c.init.headers?.Authorization).toBe("Basic " + Buffer.from(`${ACCOUNT_SID}:${TOKEN}`).toString("base64"));
    expect(c.init.signal).toBeDefined();
    expect(form(c)).toMatchObject({ To: "+15550000002", From: "+15550000001", Body: expect.stringContaining("P-00001") });
    const out = output as SenderOutput;
    expect(out.results[0]).toMatchObject({ status: "sent", providerRef: "SM" + "1".repeat(32) });
    assertNoSecrets(out);
  });

  it("WhatsApp prefixes both numbers with whatsapp:", async () => {
    const { calls } = await runScript(SEND_TWILIO_WHATSAPP, {
      tickResult: { ok: true, batches: { whatsapp: [req("whatsapp", "twilio", "+15550000002")] }, providers },
      credentials,
      respond: () => ({ status: 201, body: { sid: "SM1" } }),
    });
    expect(form(calls[0])).toMatchObject({ To: "whatsapp:+15550000002", From: "whatsapp:+15550000001" });
  });

  it("voice call sends XML-escaped TwiML <Say>", async () => {
    const n = { ...req("voice", "twilio", "+15550000002"), speech: "Alert <b> & 'x'" };
    const { calls } = await runScript(SEND_TWILIO_VOICE, {
      tickResult: { ok: true, batches: { voice: [n] }, providers },
      credentials,
      respond: () => ({ status: 201, body: { sid: "CA1" } }),
    });
    expect(calls[0].url).toMatch(/\/Calls\.json$/);
    const twiml = form(calls[0]).Twiml;
    expect(twiml).toContain("<Response><Say>Alert &lt;b&gt; &amp; &apos;x&apos;</Say>");
    expect(twiml).not.toContain("<b>");
  });

  it("reports an HTTP failure without leaking the token", async () => {
    const { output } = await runScript(SEND_TWILIO_SMS, {
      tickResult: tick("sms", [req("sms", "twilio", "+15550000002")]),
      credentials,
      respond: () => ({ status: 401, body: { code: 20003, message: `Authenticate ${TOKEN}` } }),
    });
    const out = output as SenderOutput;
    expect(out.results[0].status).toBe("failed");
    expect(out.results[0].error).toMatch(/HTTP 401/);
    assertNoSecrets(out);
  });
});

describe("webhook-style senders", () => {
  it("IFTTT triggers maker.ifttt.com with value1..3 and never returns the key", async () => {
    const { output, calls } = await runScript(SEND_IFTTT, {
      tickResult: tick("ifttt", [req("ifttt", "ifttt", "user-0001")]),
      credentials,
      respond: () => ({ status: 200, body: "Congratulations!" }),
    });
    expect(calls[0].url).toBe(`https://maker.ifttt.com/trigger/cc_page/with/key/${TOKEN}`);
    expect(JSON.parse(calls[0].init.body ?? "{}")).toEqual({
      value1: expect.stringContaining("Checkout"),
      value2: expect.stringContaining("P-00001"),
      value3: expect.stringContaining("/incidents/inc-1"),
    });
    assertNoSecrets(output);
  });

  it("Slack posts {text, blocks} to the vault-held webhook URL", async () => {
    const { calls, output } = await runScript(SEND_SLACK, {
      tickResult: tick("slack", [req("slack", "slack", "@ana")]),
      credentials,
      respond: () => ({ status: 200, body: "ok" }),
    });
    expect(calls[0].url).toBe(SLACK_URL);
    const body = JSON.parse(calls[0].init.body ?? "{}") as { text: string; blocks: unknown[] };
    expect(body.text).toContain("P-00001");
    expect(body.blocks.length).toBeGreaterThan(0);
    expect((output as SenderOutput).results[0].status).toBe("sent");
    assertNoSecrets(output);
  });

  it("Slack refuses a non-Slack URL", async () => {
    const { output, calls } = await runScript(SEND_SLACK, {
      tickResult: tick("slack", [req("slack", "slack", "@ana")]),
      credentials: { ...credentials, "CREDENTIALS_VAULT-SLACK": { token: HOOK_URL } },
    });
    expect(calls).toHaveLength(0);
    expect((output as SenderOutput).results[0].status).toBe("failed");
    assertNoSecrets(output);
  });

  it("Teams posts an Adaptive Card message", async () => {
    const { calls } = await runScript(SEND_TEAMS, {
      tickResult: tick("teams", [req("teams", "teams", "ana")]),
      credentials,
      respond: () => ({ status: 202, body: "" }),
    });
    const body = JSON.parse(calls[0].init.body ?? "{}") as {
      type: string;
      attachments: { contentType: string; content: { type: string } }[];
    };
    expect(calls[0].url).toBe(TEAMS_URL);
    expect(body.type).toBe("message");
    expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(body.attachments[0].content.type).toBe("AdaptiveCard");
  });

  it("Telegram calls sendMessage with chat_id and returns message_id", async () => {
    const { calls, output } = await runScript(SEND_TELEGRAM, {
      tickResult: tick("telegram", [req("telegram", "telegram", "123456")]),
      credentials,
      respond: () => ({ status: 200, body: { ok: true, result: { message_id: 42 } } }),
    });
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(calls[0].init.body ?? "{}")).toMatchObject({ chat_id: "123456" });
    const out = output as SenderOutput;
    expect(out.results[0]).toMatchObject({ status: "sent", providerRef: "42" });
    assertNoSecrets(out);
  });

  it("Telegram error description is reported, URL/token redacted", async () => {
    const { output } = await runScript(SEND_TELEGRAM, {
      tickResult: tick("telegram", [req("telegram", "telegram", "123456")]),
      credentials,
      respond: () => {
        throw new Error(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
      },
    });
    const out = output as SenderOutput;
    expect(out.results[0].status).toBe("failed");
    assertNoSecrets(out);
  });

  it("generic webhook posts the full notification with the optional auth header", async () => {
    const { calls } = await runScript(SEND_WEBHOOK, {
      tickResult: tick("webhook", [req("webhook", "hook", "routing-key-1")]),
      credentials,
      respond: () => ({ status: 200, body: {} }),
    });
    expect(calls[0].url).toBe(HOOK_URL);
    expect(calls[0].init.headers?.["X-Api-Key"]).toBe(TOKEN);
    const body = JSON.parse(calls[0].init.body ?? "{}") as { notification: NotificationRequest };
    expect(body.notification.key).toBe("inc-1.0.0.abc.webhook.1");
  });
});

describe("sender runtime", () => {
  it("returns no results and makes no calls for an empty batch", async () => {
    const { output, calls, vaultCalls } = await runScript(SEND_SLACK, { tickResult: { ok: true, batches: {} }, credentials });
    expect(calls).toHaveLength(0);
    expect(vaultCalls).toHaveLength(0);
    expect(output).toEqual({ channel: "slack", results: [] });
  });

  it("reads each provider credential once per run", async () => {
    const { vaultCalls } = await runScript(SEND_SLACK, {
      tickResult: tick("slack", [req("slack", "slack", "@a"), { ...req("slack", "slack", "@b"), key: "k2" }]),
      credentials,
      respond: () => ({ status: 200, body: "ok" }),
    });
    expect(vaultCalls).toEqual(["CREDENTIALS_VAULT-SLACK"]);
  });

  it("fails items for unknown or disabled providers", async () => {
    const disabled = providers.map((p) => (p.id === "slack" ? { ...p, enabled: false } : p));
    const { output } = await runScript(SEND_SLACK, {
      tickResult: {
        ok: true,
        batches: { slack: [req("slack", "slack", "@a"), { ...req("slack", "nope", "@b"), key: "k2" }] },
        providers: disabled,
      },
      credentials,
    });
    const out = output as SenderOutput;
    expect(out.results.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(out.results[0].error).toMatch(/disabled/);
    expect(out.results[1].error).toMatch(/not configured/);
  });

  it("feature-detects getCredentialVaultEntryDetails", async () => {
    const { output } = await runScript(SEND_SLACK, {
      tickResult: tick("slack", [req("slack", "slack", "@a")]),
      noVaultDetails: true,
    });
    expect((output as SenderOutput).results[0].error).toMatch(/getCredentialVaultEntryDetails/);
  });
});

describe("tick and report", () => {
  it("tick forwards reason/testRequest to the engine-tick app function (relative URL)", async () => {
    const testRequest = { providerId: "slack", channel: "slack", address: "@a" };
    const { calls, output } = await runScript(tickScript("my.command.center"), {
      execution: { params: { reason: "test", testRequest }, triggerType: "Manual" },
      respond: () => ({ status: 200, body: { ok: true, batches: {} } }),
    });
    expect(calls[0].url).toBe("/apps/my.command.center/api/engine-tick");
    expect(calls[0].init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(calls[0].init.body ?? "{}")).toEqual({ reason: "test", testRequest });
    expect(output).toEqual({ ok: true, batches: {} });
  });

  it("tick derives the reason from the trigger type", async () => {
    const { calls } = await runScript(tickScript("my.command.center"), {
      execution: { params: {}, triggerType: "Schedule" },
    });
    expect(JSON.parse(calls[0].init.body ?? "{}")).toEqual({ reason: "schedule" });
  });

  it("tick throws on a non-2xx so the senders are skipped", async () => {
    await expect(
      runScript(tickScript("my.command.center"), { respond: () => ({ status: 403, body: "forbidden" }) }),
    ).rejects.toThrow(/HTTP 403/);
  });

  it("report gathers every sender's results and tolerates skipped senders", async () => {
    const results: Record<string, unknown> = {};
    for (const t of SENDER_TASKS) results[t.name] = new Error("skipped");
    results.send_slack = { channel: "slack", results: [{ key: "a", status: "sent", at: 1 }] };
    results.send_twilio_sms = { channel: "sms", results: [{ key: "b", status: "failed", error: "x", at: 2 }] };
    const { calls, output } = await runScript(reportScript("my.command.center"), {
      results,
      respond: () => ({ status: 200, body: { applied: 2, unknown: 0 } }),
    });
    expect(calls[0].url).toBe("/apps/my.command.center/api/delivery-report");
    const body = JSON.parse(calls[0].init.body ?? "{}") as { results: { key: string }[] };
    expect(body.results.map((r) => r.key).sort()).toEqual(["a", "b"]);
    expect(output).toMatchObject({ reported: 2, applied: 2 });
  });

  it("report makes no call when nothing was sent", async () => {
    const { calls, output } = await runScript(reportScript("my.command.center"), { results: {} });
    expect(calls).toHaveLength(0);
    expect(output).toMatchObject({ reported: 0 });
  });
});
