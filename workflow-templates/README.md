# Workflow templates

| File | What it is |
| --- | --- |
| `command-center-engine.workflow.json` | The **Command Center · Engine** workflow — the paging engine. Generated from `ui/app/data/workflows/definition.ts` by `node scripts/gen-workflow-templates.mjs`; a unit test fails if it drifts. Do not edit by hand. |
| `command-center-alert-simulator.workflow.json` | **For trial/test tenants only.** Posts 1–2 synthetic alerts (titles `[SIM] …`, properties `cc.service`, `cc.priority`, `cc.tags`, `cc.source=alert-simulator`) to the Events API v2 every 7 minutes, so the console has something to show. Never import it into a production tenant. |

## Preferred: install from the app

Command Center → **Integrations** → *Install / update engine workflow* creates or updates the workflow with a fixed
id (`settings.engine.workflowId`), restores it from the trash if it was deleted, and keeps it in sync with the
providers configured in Settings. Use the JSON file only if the app cannot write workflows (missing
`automation:workflows:write`) or you want to review the definition first.

## Importing the JSON manually

1. Replace the placeholders:
   - `my.command.center` → your app id if you changed it (it appears in the `tick` and `report` scripts:
     `/apps/<appId>/api/engine-tick`, `/apps/<appId>/api/delivery-report`).
   - `CREDENTIALS_VAULT-YOUR-…` in `input.providers` are informational only; the send tasks read the provider list
     (including the vault entry ids) from the engine's tick result, i.e. from Command Center → Settings → Providers.
2. Workflows → **Upload** (import) the JSON file.
3. Keep the workflow **private**: task results contain phone numbers and message text.

## Workflow actor

Every task runs as the workflow **actor**. A person who edits the workflow becomes its actor unless the actor is a
**service user**, so set a service user as actor (Workflow → Settings → Actor). The actor needs:

- `app-engine:apps:run` / `app-engine:functions:run` — to call this app's `engine-tick` and `delivery-report` functions
- `automation:workflows:read` — `execution()` / `result()` inside the tasks
- `credential-vault:entries:read` — to read the provider credentials
- the app's own data permissions used by the app functions (Grail read for `dt.davis.problems`, `dt.davis.events`,
  `events`; app state read/write/delete) — whether these are checked against the actor is **unverified**; if the engine
  heartbeat in the console goes stale, check the workflow's execution log first.

Also enable the needed permissions under Workflows → Settings → **Authorization settings**.

## Credential Vault entries

Create one entry per provider (Credential Vault → Add credential), with:

- scope **AppEngine** selected,
- **Allow access without app context** turned on (workflow tasks run without app context),
- access granted to the workflow actor.

| Provider kind | Credential type | Contents |
| --- | --- | --- |
| `twilio` (SMS, voice, WhatsApp) | Username and password | username = Account SID (or API Key SID + set `accountSid` in provider params), password = Auth Token (or API Key secret) |
| `ifttt` | Token | your IFTTT Webhooks key; set `eventName` in provider params |
| `slack-webhook` | Token | the full incoming-webhook URL (`https://hooks.slack.com/services/…`) |
| `teams-webhook` | Token | the full Teams **Workflows** webhook URL ("When a Teams webhook request is received"). Office 365 connector webhooks were retired by Microsoft in May 2026. |
| `telegram-bot` | Token | the bot token; contact address = chat id |
| `webhook` | Token (or username/password) | the full `https://` URL; optional `authHeader` param + password sent as that header |

Only the entry **id** (`CREDENTIALS_VAULT-…`) is stored in Command Center settings — never the secret. Scripts never
return secrets or URLs in their results.

## External requests allowlist

Settings → General → Environment management → **External requests**: allow the hosts of the providers you use.

| Provider | Host |
| --- | --- |
| Twilio | `api.twilio.com` |
| IFTTT | `maker.ifttt.com` |
| Slack | `hooks.slack.com` |
| Microsoft Teams | the host of your Teams Workflows webhook URL (a Power Automate / Logic Apps host — copy it from the URL; older connector URLs used `*.webhook.office.com`) |
| Telegram | `api.telegram.org` |
| Generic webhook | the host of your endpoint |

The app functions themselves make no external calls; only the workflow send tasks do.

## Task layout

`tick` → (`send_twilio_sms`, `send_twilio_voice`, `send_twilio_whatsapp`, `send_ifttt`, `send_slack`, `send_teams`,
`send_telegram`, `send_webhook`, each on `tick` = SUCCESS) → `report` (on every sender = ANY). Senders never retry
(a retry would page twice); a delivery that is not reported in time is retried by the engine through the ledger.
Interval trigger: every minute.
