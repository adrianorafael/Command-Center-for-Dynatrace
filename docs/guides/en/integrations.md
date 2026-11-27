# Integrations — how notifications go out

🌐 **English** · [Português (BR)](../pt-BR/integrations.md) · [Español](../es/integrations.md)

Inbound events are covered in the [alerts reference](alerts-reference.md). This page covers the outbound side: the
eight channels, what each provider receives, the custom workflow integration, and how to test them.

![Integrations — Outbound](../../screenshots/integrations-outbound.png)

## How a notification is sent

1. The engine runs on its schedule (simple workflow, one action). It decides who must be notified now: the escalation
   step that is due, the people on call for its targets, and each person's notification rules.
2. It writes one **ledger entry** (`planned`) per person, step, channel and attempt.
3. Right after planning, the same run reads the provider's secret from the Credential Vault and calls the provider
   over HTTPS (or runs your custom workflow).
4. The result is written back: `sent` (with the provider's reference when one is returned) or `failed` (with the
   provider's error; secrets and URLs are masked as `***` and `<url>`).
5. A notification that failed, or got no result within *Delivery report timeout* (`timeout`), is retried with a new
   attempt while the incident is still triggered, up to *Delivery attempts* (default 3).

Each HTTP call has a 10-second timeout. A run starts no new send later than about 90 seconds after it began; what is
left is sent on the next run. Paging is **at least once**: in rare races (a run that overlaps a slow previous run) a person can be notified
twice.

## Channels and providers

| Channel | Provider (default ID) | Contact address of a person | Vault entry |
| --- | --- | --- | --- |
| SMS | Twilio SMS (`twilio-sms`) | Phone in E.164, for example `+5511999990000` | Username/password: Account SID (or API key SID) / auth token (or API key secret) |
| Voice call | Twilio Voice (`twilio-voice`) | Phone in E.164 | same |
| WhatsApp | Twilio WhatsApp (`twilio-whatsapp`) | Phone in E.164 (the `whatsapp:` prefix is added) | same |
| IFTTT | IFTTT Webhooks (`ifttt`) | Any label: the applet decides where it goes | Token: your Webhooks key |
| Slack | Slack (`slack`) | Any label: the webhook decides the channel; the message shows the person's name | Token: the incoming-webhook URL |
| Microsoft Teams | Microsoft Teams (`teams`) | Any label: the webhook decides the chat; the card shows the person's name | Token: the Teams Workflows webhook URL |
| Telegram | Telegram (`telegram`) | The chat ID | Token: the bot token |
| Webhook | Generic webhook (`webhook`) | A routing key for your endpoint | Token: the endpoint URL. Or username/password: username = URL, password = auth header value |
| Webhook | Custom workflow (`custom-workflow`) | A routing key, passed as `notification.to.address` | none: the workflow ID of a workflow you own |

Every provider starts **turned off** and has an **On/Off** switch on its card. A provider is used only while it is on
and configured (a vault entry ID; for the custom workflow, a workflow ID). One provider per channel can be on: the
generic webhook and the custom workflow share the *webhook* channel. Providers that are off cost nothing and need no
workflow: the built-in providers are all sent by the single engine workflow.

## What each provider receives

| Provider | Request | Content |
| --- | --- | --- |
| Twilio SMS | `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json` (form, HTTP Basic) | `To`, `Body` (the SMS text, at most 1,600 characters), `From` or `MessagingServiceSid` |
| Twilio WhatsApp | same endpoint | `To` and `From` with the `whatsapp:` prefix, `Body` |
| Twilio Voice | `POST …/Calls.json` | `To`, `From`, `Twiml`: the message is spoken twice with `<Say>` (optional `voice` and `language`) |
| IFTTT | `POST https://maker.ifttt.com/trigger/{event}/with/key/{key}` | `value1` = subject, `value2` = text, `value3` = incident link |
| Slack | `POST` the webhook URL | A message with the subject, the text and the incident link. Slack markup is escaped, so an alert title cannot mention `@channel`. |
| Microsoft Teams | `POST` the webhook URL | An Adaptive Card with the subject, the text and an **Open in Command Center** button |
| Telegram | `POST https://api.telegram.org/bot{token}/sendMessage` | `chat_id`, `text` = subject + text + link, as plain text (no markup), link previews off |
| Generic webhook | `POST` your URL, `Content-Type: application/json`, optional auth header | `{"source":"command-center","version":1,"notification":{…}}` (below) |

Microsoft Teams: only **Teams Workflows** webhooks are supported. Microsoft retired the old Office 365 connector
webhooks.

### Generic webhook payload

```json
{
  "source": "command-center",
  "version": 1,
  "notification": {
    "key": "dp-p-26112716.1.0.1a2b3c4d.webhook.1",
    "incidentId": "dp-p-26112716",
    "displayId": "P-26112716",
    "cycle": 1,
    "step": 0,
    "attempt": 1,
    "channel": "webhook",
    "providerId": "webhook",
    "priority": "P2",
    "to": { "uid": "<IAM user id>", "address": "<routing key>", "name": "Ana Lima" },
    "subject": "[P2] P-26112716 Checkout latency above 2 s · Command Center",
    "text": "P2 P-26112716: Checkout latency above 2 s …",
    "incidentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/ui/apps/my.command.center/incidents/dp-p-26112716"
  }
}
```

| Field | Meaning |
| --- | --- |
| `key` | Unique per incident, escalation cycle, step, person, channel and attempt. Use it to de-duplicate on your side. |
| `cycle` | Escalation cycle, starting at 1. It increases when the incident is re-triggered, reopened, un-snoozed or un-acknowledged; *Escalate now* increases it only after the policy is exhausted. |
| `step` | Escalation ordinal: pass × number of steps + step index (0 = first step of the first pass) |
| `attempt` | 1 for the first try, then 2, 3… for retries after a timeout |
| `to` | The person: IAM user ID, the address from their contact method, display name |
| `subject`, `text` | Pre-rendered texts (limits below) |
| `speech` | Only for voice: the text to speak |

This is the way out to any tool without a built-in sender: an ITSM, an email gateway, a chat bot, another paging
service. If you prefer to build that call in Dynatrace Workflows, use the custom workflow below.

## Custom workflow

The **Custom workflow** provider hands each notification to a workflow **you own and edit**, so you can reach any
system with any Workflows action (HTTP request, email, ITSM, chat) without changing Command Center.

1. **Integrations → Outbound → Custom workflow → Configure → Create example workflow.** The Workflows app opens with
   a simple workflow named *Command Center · Custom integration*: one **HTTP request** task, method POST, an example
   URL `https://example.com/command-center/notifications`, an example header, and the body
   `{{ execution().params | to_json }}`. Or select **Download example JSON** and upload it in the Workflows app.
2. In the Workflows app, replace the URL and headers with your endpoint's, or replace the task with any action. The
   notification is available in expressions, for example `{{ execution().params.notification.subject }}`,
   `{{ execution().params.notification.priority }}` or `{{ execution().params.notification.to.address }}`. Save it.
3. Back in Command Center select **Find my workflow** → **Use** (or paste the workflow ID), **Save**, switch the
   provider **On** and **Send test**.
4. Add your endpoint's host to *External requests*. In the Workflows **Authorization settings**, the engine
   workflow's actor needs `automation:workflows:run`, and your workflow's actor needs the permissions its task uses.

The run params are the same JSON as the generic webhook body: `{"source":"command-center","version":1,
"notification":{…}}`. *Sent* means the workflow run was accepted. What your workflow does afterwards is not tracked
by Command Center: check its executions in the Workflows app. Each notification is one workflow run. As a simple
workflow it consumes no workflow hours; its task is billed like any workflow task. The example has no trigger of its
own (on demand), and the same caveat as for the engine applies: if the intent creates it as a *standard* workflow,
**Find my workflow** says so, and the uploaded JSON creates a simple one.

## Message texts

- **Subject:** `[P2] P-26112716 <title> · Command Center`, at most 150 characters.
- **SMS and voice:** `P2 P-26112716: <title> <service> Ack: <incident link>`, at most 300 characters. The title is
  shortened first.
- **Other channels:** priority, ID, title, service, team, description (as plain text) and up to five affected
  entities, then the link. Limits: WhatsApp 1,000, IFTTT 1,000, Slack 3,000, Teams 3,000, Telegram 3,500, webhook
  4,000 characters.
- On a repeat of the policy the text says `(repeat N)`.

Message texts include the alert title and description. Don't put secrets or personal data in event titles if they are
sent to third parties.

## Notification rules and urgency

Each person has **contact methods** and **notification rules** (Teams → person → Contact methods). A rule says:
"for incidents of priority Px or more urgent, use this method after N minutes from when the step fires". An
escalation step can also **force channels**, which replaces the personal rules for that step.

During a team's **quiet hours** in *low urgency* mode, only Slack, Teams, Telegram, IFTTT and webhook are used. SMS,
voice and WhatsApp are skipped.

## Testing a provider

**Integrations → Outbound → provider → Send test** sends one message to the address you type, through
the same code the engine uses (app function `engine-run` with `reason: "test"`). The result (sent or the provider
error) is shown right away. Test every channel you turn on, end to end, before you rely on it.

## What has been verified

| Provider | Status |
| --- | --- |
| Generic webhook | ✅ Verified live on a trial environment: escalations and tests delivered, results written to the ledger |
| Custom workflow | ✅ Verified live on a trial environment: a test and a scheduled escalation ran the workflow, which delivered the full notification JSON to the receiver |
| Twilio SMS, voice, WhatsApp, IFTTT, Slack, Microsoft Teams, Telegram | Implemented from each vendor's API documentation, **not exercised live** (no accounts in the test environment). Unit tests cover the Twilio SMS and voice, Slack and Telegram requests. Test every provider with *Send test*. |

Two-way replies (acknowledging by answering an SMS or a chat message) are not implemented. Acknowledge in the Console.
