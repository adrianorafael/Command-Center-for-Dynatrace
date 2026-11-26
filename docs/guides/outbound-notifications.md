# Outbound notifications — the engine workflow and providers

Every page, SMS, call and chat message leaves Dynatrace through **one workflow**: **Command Center · Engine**. The app
itself never calls an external host and never sees a secret.

```
every minute ─▶ tick ──▶ send_twilio_sms ─────┐
                     ├─▶ send_twilio_voice ───┤
                     ├─▶ send_twilio_whatsapp ┤
                     ├─▶ send_ifttt ──────────┤
                     ├─▶ send_slack ──────────┼─▶ report
                     ├─▶ send_teams ──────────┤
                     ├─▶ send_telegram ───────┤
                     └─▶ send_webhook ────────┘
```

| Task | Runs when | Does |
| --- | --- | --- |
| `tick` | every minute, or on demand | `POST /apps/my.command.center/api/engine-tick` → returns the planned notifications grouped by channel, plus the provider list |
| `send_*` (8) | `tick` succeeded | Reads the provider's Credential Vault entry, calls the provider for each item, returns one result per item. **Never retries.** |
| `report` | after all senders (any state) | `POST /apps/my.command.center/api/delivery-report` with the results → ledger and incident timeline |

All tasks are **Run JavaScript** tasks (`dynatrace.automations:run-javascript`). The definition is generated from
`ui/app/data/workflows/definition.ts`; the checked-in copy is
[`workflow-templates/command-center-engine.workflow.json`](../../workflow-templates/command-center-engine.workflow.json).

## 1. Choose the actor

Tasks run as the workflow **actor**, and the app functions they call run with the actor's permissions. A person who
edits a workflow becomes its actor unless the actor is a **service user** — so create a service user for the engine and
keep it as actor.

The actor needs:

| Permission | Why |
| --- | --- |
| `app-engine:apps:run`, `app-engine:functions:run` | Call `engine-tick` and `delivery-report` |
| `automation:workflows:read` | `execution()` / `result()` inside the tasks |
| `credential-vault:entries:read` | Read provider credentials |
| `storage:buckets:read`, `storage:events:read` | Engine DQL (Q1–Q4) |
| `state:app-states:read`, `state:app-states:write`, `state:app-states:delete` | Engine App State access |

This set works end to end; whether every item is strictly needed was not isolated.

## 2. Enable Workflows authorization settings

**Workflows app → Settings → Authorization settings**: enable the permissions above. Without them `tick` fails on every
run and the console shows the stale-engine banner.

## 3. Install the workflow

Custom apps cannot hold `automation:workflows:write`, so Command Center cannot create the workflow.

**Import (any user who may create workflows)**

1. Command Center → **Integrations → Workflows** → **Download workflow JSON**. The file is generated for this app's ID
   and settings; if no workflow ID was set yet, one is assigned and saved first.
2. **Workflows** app → upload the file.
3. Set the actor (service user), keep the workflow **private**, make sure it is deployed and the schedule is active.
4. Back in Command Center: **Refresh status**. If the upload created a different ID, select **Save this ID** so that
   *Escalate now* and test notifications run the right workflow.

**Admin script**

```bash
DT_ENVIRONMENT=https://YOUR-ENVIRONMENT.apps.dynatrace.com \
DT_PLATFORM_TOKEN=YOUR-PLATFORM-TOKEN \
node scripts/install-workflow.mjs --app-id my.command.center --actor <service-user-uid> [--workflow-id <uuid>] [--dry-run]
```

Needs a platform token with `automation:workflows:read` and `automation:workflows:write`. Idempotent: update if it
exists, restore and update if it is in the trash, otherwise create with the fixed ID. The token is read from the shell
and never printed.

**Upgrades.** The workflow description carries a `[command-center-engine vN]` marker. When the app ships a newer
definition, the Workflows tab shows **Update available** — download and upload again (or re-run the script).

## 4. Credential Vault

One entry per provider, created in the platform **Credential Vault** (entry IDs look like `CREDENTIAL_VAULT_ENTRY-…`;
classic `CREDENTIALS_VAULT-…` IDs are also accepted). Required settings on each entry:

- scope **AppEngine**;
- **Allow access without app context** on (workflow tasks run without app context);
- **Owner access only** on — mandatory, because the platform rejects an entry that is both public and usable without
  app context;
- consequently the entry's **owner must be the workflow actor** (only the owner can read it). Verified with a person as
  actor and owner; how to make a service user the owner of an entry was not verified.

| Provider kind | Credential type | Username / token | Password |
| --- | --- | --- | --- |
| `twilio` | Username and password | Account SID, or an API key SID (then set *Account SID* in the provider params) | Auth token, or the API key secret |
| `ifttt` | Token | IFTTT Webhooks key | — |
| `slack-webhook` | Token | Full Slack incoming-webhook URL | — |
| `teams-webhook` | Token | Full Teams **Workflows** webhook URL ("When a Teams webhook request is received") | — |
| `telegram-bot` | Token | Bot token | — |
| `webhook` | Token, or username and password | Full `https://` URL of your endpoint | Optional value for the auth header |

Paste only the **entry ID** (`CREDENTIAL_VAULT_ENTRY-…` or `CREDENTIALS_VAULT-…`) into Command Center. Webhook URLs that embed a key (Slack, Teams,
IFTTT) are secrets — they belong in the vault, not in settings.

## 5. External requests allowlist

**Settings → General → Environment management → External requests** (settings schema
`builtin:dt-javascript-runtime.allowed-outbound-connections`; verified):

| Provider | Host |
| --- | --- |
| Twilio | `api.twilio.com` |
| IFTTT | `maker.ifttt.com` |
| Slack | `hooks.slack.com` |
| Microsoft Teams | the host of your Teams Workflows webhook URL (copy it from the URL; it depends on your Power Automate environment) |
| Telegram | `api.telegram.org` |
| Generic webhook | the host of your endpoint |

## 6. Configure providers in the app

**Integrations → Outbound → Configure**. Default slots (all disabled until configured):

| ID | Channel | Kind | Parameters |
| --- | --- | --- | --- |
| `twilio-sms` | sms | twilio | `from` (E.164) or `messagingServiceSid` |
| `twilio-voice` | voice | twilio | `from` (voice-capable number), optional `voice`, `language` (e.g. `en-US`) |
| `twilio-whatsapp` | whatsapp | twilio | `from` — the approved WhatsApp sender (the `whatsapp:` prefix is added) |
| `ifttt` | ifttt | ifttt | `eventName` (default `command_center_alert`) |
| `slack` | slack | slack-webhook | — |
| `teams` | teams | teams-webhook | — |
| `telegram` | telegram | telegram-bot | `parseMode` (`HTML` default, or `MarkdownV2`) |
| `webhook` | webhook | webhook | optional `authHeader` (header name; value = vault password) |

Then **Send test notification** to an address of your choice. Test runs go through the same workflow (reason `test`).

## What each provider receives

| Provider | Request |
| --- | --- |
| Twilio SMS / WhatsApp | `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json` (form: `To`, `From` or `MessagingServiceSid`, `Body`), HTTP Basic auth |
| Twilio voice | `POST …/Accounts/{AccountSid}/Calls.json` with `To`, `From` and TwiML `<Say>` of the spoken text |
| IFTTT | `POST https://maker.ifttt.com/trigger/{eventName}/with/key/{key}` with `value1` = subject, `value2` = text, `value3` = incident link |
| Slack | JSON message to the incoming webhook |
| Microsoft Teams | Adaptive Card message to the Teams Workflows webhook |
| Telegram | `sendMessage` to `https://api.telegram.org/bot{token}/` with the user's chat ID |
| Generic webhook | `POST {url}` with `{ "source": "command-center", "version": 1, "notification": { … } }` |

The generic webhook's `notification` object:

```json
{
  "key": "<incident>.<cycle>.<step>.<user hash>.<channel>.<attempt>",
  "incidentId": "…", "displayId": "P-00001",
  "cycle": 1, "step": 0, "attempt": 1,
  "channel": "webhook", "providerId": "webhook",
  "to": { "uid": "user-0001", "address": "<routing key>", "name": "…" },
  "priority": "P2",
  "subject": "…", "text": "…", "speech": "…",
  "incidentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/ui/apps/my.command.center/…"
}
```

Use `key` as an idempotency key: a duplicate delivery has the identical key; a retry has the same key except the last
segment (`attempt` + 1). Any 2xx counts as sent.

| Provider | Status |
| --- | --- |
| Generic webhook | ✅ **verified live** end to end: Events API → Davis problem → engine → routing by `cc.service` → schedule on-call → webhook via vault entry → delivered (`sent`) → `report` updated the ledger |
| Twilio SMS / voice / WhatsApp, IFTTT, Slack, Microsoft Teams, Telegram | Implemented per vendor documentation, **not exercised live** — test every channel you enable |

## Delivery, retries and the ledger

Every planned notification is a ledger entry `ntf.<key>` with status `planned` → `sent` / `failed`, or `timeout` when
no report arrives within `reportTimeoutSec` (default 180 s). A timed-out or failed entry is re-planned with
`attempt + 1` up to `maxAttempts` (default 3); after that the timeline gets a `notification_failed` entry and escalation
continues with the next step. At most `maxNotificationsPerTick` (default 100) are sent per run. All of these are in
**Settings → Paging engine**.

The ledger is visible per incident under **Notifications**; totals are on **Reports → Notification delivery**.

## Privacy

Task results (visible in the workflow's execution log) contain recipients' phone numbers and message texts. Keep the
workflow **private**. Consequence: only its owner can see it, so the immediate runs behind **Run engine now**, **Send test
notification** and **Escalate now** work only for users who can see the workflow. An *Escalate now* by anyone else is
still recorded and sent by the next scheduled run (within about a minute).
