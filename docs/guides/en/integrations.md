# Integrations — how notifications go out

🌐 **English** · [Português (BR)](../pt-BR/integrations.md) · [Español](../es/integrations.md)

Inbound events are covered in the [alerts reference](alerts-reference.md). This page covers the outbound side: the
eight channels, what each provider receives, and how to test them.

![Integrations — Outbound](../../screenshots/integrations-outbound.png)

## How a notification is sent

1. The engine runs on its schedule (simple workflow, one action). It decides who must be notified now: the escalation
   step that is due, the people on call for its targets, and each person's notification rules.
2. It writes one **ledger entry** (`planned`) per person, step, channel and attempt.
3. In the same run it reads the provider's secret from the Credential Vault and calls the provider over HTTPS.
4. The result is written back: `sent` (with the provider's reference when one is returned) or `failed` (with the
   provider's error; secrets and URLs are masked as `***` and `<url>`).
5. A notification that has no result after *Delivery report timeout* becomes `timeout` and is retried, up to
   *Delivery attempts* (default 3).

Each HTTP call has a 10-second timeout. A run stops sending after about 100 seconds; what is left is sent on the next
run. Paging is **at least once**: in rare races (a run that overlaps a slow previous run) a person can be notified
twice.

## Channels and providers

| Channel | Provider (default ID) | Contact address of a person | Vault entry |
| --- | --- | --- | --- |
| SMS | Twilio SMS (`twilio-sms`) | Phone in E.164, for example `+5511999990000` | Username/password: Account SID (or API key SID) / auth token (or API key secret) |
| Voice call | Twilio Voice (`twilio-voice`) | Phone in E.164 | same |
| WhatsApp | Twilio WhatsApp (`twilio-whatsapp`) | Phone in E.164 (the `whatsapp:` prefix is added) | same |
| IFTTT | IFTTT Webhooks (`ifttt`) | A label (the applet decides where it goes) | Token: your Webhooks key |
| Slack | Slack (`slack`) | A label or handle, shown in the message | Token: the incoming-webhook URL |
| Microsoft Teams | Microsoft Teams (`teams`) | A label or handle, shown in the card | Token: the Teams Workflows webhook URL |
| Telegram | Telegram (`telegram`) | The chat ID | Token: the bot token |
| Webhook | Generic webhook (`webhook`) | A routing key for your endpoint | Token: the endpoint URL. Or username/password: username = URL, password = auth header value |

Every provider starts **turned off**. A provider is used only when it is turned on and has a vault entry ID.

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
    "key": "dp-p-26112716.0.0.1a2b3c4d.webhook.1",
    "incidentId": "dp-p-26112716",
    "displayId": "P-26112716",
    "cycle": 0,
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
| `cycle` | Escalation cycle, increased by *Escalate now* and by a re-trigger |
| `step` | Escalation step index (0 = first step) |
| `attempt` | 1 for the first try, then 2, 3… for retries after a timeout |
| `to` | The person: IAM user ID, the address from their contact method, display name |
| `subject`, `text` | Pre-rendered texts (limits below) |
| `speech` | Only for voice: the text to speak |

This is the way out to any tool without a built-in sender: an ITSM, an email gateway, a chat bot, another paging
service.

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

**Integrations → Outbound → provider → Send test notification** sends one message to the address you type, through
the same code the engine uses (app function `engine-run` with `reason: "test"`). The result (sent or the provider
error) is shown right away. Test every channel you turn on, end to end, before you rely on it.

## What has been verified

| Provider | Status |
| --- | --- |
| Generic webhook | ✅ Verified live on a trial environment: escalations and tests delivered, results written to the ledger |
| Twilio SMS, voice, WhatsApp, IFTTT, Slack, Microsoft Teams, Telegram | Implemented from each vendor's API documentation and covered by unit tests, **not exercised live** (no accounts in the test environment). Test them with *Send test notification*. |

Two-way replies (acknowledging by answering an SMS or a chat message) are not implemented. Acknowledge in the Console.
