# Workflow templates

| File | What it is |
| --- | --- |
| `command-center-engine.workflow.json` | The **Command Center · Engine** workflow — the paging engine. Generated from `ui/app/data/workflows/definition.ts` by `node scripts/gen-workflow-templates.mjs`; a unit test fails if it drifts. Do not edit by hand. |
| `command-center-alert-simulator.workflow.json` | **For trial/test tenants only.** Posts 1–2 synthetic alerts (titles `[SIM] …`, properties `cc.service`, `cc.priority`, `cc.tags`, `cc.source=alert-simulator`) to the Events API v2 every 7 minutes, so the console has something to show. Never import it into a production tenant. |

## Installing

Custom apps cannot hold `automation:workflows:write` ("Only apps that are provided by Dynatrace can use the
'automation:workflows:write' scope" — observed on deploy), so Command Center cannot create the workflow itself. It can
read its status and run it (`automation:workflows:read` / `:run`). Two ways to install:

**A. Download + import (any user allowed to create workflows)**
Command Center → **Integrations** → *Download engine workflow* generates the JSON for your app id and settings
(`settings.engine.workflowId` as id). Then open the **Workflows** app → **Upload** and select the file. If the import
assigns a new id, Command Center finds the workflow by its title (`Command Center · Engine`) and offers to store that id.
The checked-in `command-center-engine.workflow.json` is the same definition with placeholders.

**B. Admin CLI**

```bash
DT_ENVIRONMENT=https://YOUR-ENVIRONMENT.apps.dynatrace.com \
DT_PLATFORM_TOKEN=YOUR-PLATFORM-TOKEN \
node scripts/install-workflow.mjs --app-id my.command.center [--actor <service-user-uid>] [--dry-run]
```

The platform token needs `automation:workflows:read` and `automation:workflows:write`. The script is idempotent:
existing workflow → update; in the trash → restore + update; otherwise create with the fixed id. Re-run it after
upgrading Command Center (the description carries a `[command-center-engine vN]` marker; the app flags outdated
definitions). `--dry-run` prints the JSON without calling the API.

Placeholders in the checked-in JSON:
- `my.command.center` → your app id if you changed it (it appears in the `tick` and `report` scripts:
  `/apps/<appId>/api/engine-tick`, `/apps/<appId>/api/delivery-report`).
- `CREDENTIALS_VAULT-YOUR-…` in `input.providers` are informational only; the send tasks read the provider list
  (including the vault entry ids) from the engine's tick result, i.e. from Command Center → Settings → Providers.

Keep the workflow **private** (`isPrivate: true`, the default): task results contain phone numbers and message text.
Note that a private workflow is only visible to its owner, so other users' *Escalate now* / *Test* buttons cannot run
it (the minute schedule still pages everyone); share it, or accept that on-demand runs are owner-only.

## Workflow actor

Every task runs as the workflow **actor**. A person who edits the workflow becomes its actor unless the actor is a
**service user**, so set a service user as actor (Workflow → Settings → Actor). The actor needs:

- `app-engine:apps:run` / `app-engine:functions:run` — to call this app's `engine-tick` and `delivery-report` functions
- `automation:workflows:read` — `execution()` / `result()` inside the tasks
- `credential-vault:entries:read` — to read the provider credentials
- the app's own data permissions used by the app functions (Grail read for `dt.davis.problems`, `dt.davis.events`,
  `events`; app state read/write/delete) — the app functions run with the actor's permissions (verified).

Also enable the needed permissions under Workflows → Settings → **Authorization settings** (verified: required — without
it `tick` fails). Verified live: the imported workflow runs `tick` → 8 senders → `report` every minute, all SUCCESS. The
minimal permission set was not isolated. If the engine heartbeat in the console goes stale, check the workflow's
execution log first.

## Credential Vault entries

Create one entry per provider in the platform Credential Vault (entry ids look like `CREDENTIAL_VAULT_ENTRY-…`; classic
`CREDENTIALS_VAULT-…` ids are also accepted), with:

- scope **AppEngine** selected,
- **Allow access without app context** turned on (workflow tasks run without app context),
- **Owner access only** turned on — required: the platform rejects entries that are public and usable without app
  context (verified),
- so the entry **owner must be the workflow actor**.

| Provider kind | Credential type | Contents |
| --- | --- | --- |
| `twilio` (SMS, voice, WhatsApp) | Username and password | username = Account SID (or API Key SID + set `accountSid` in provider params), password = Auth Token (or API Key secret) |
| `ifttt` | Token | your IFTTT Webhooks key; set `eventName` in provider params |
| `slack-webhook` | Token | the full incoming-webhook URL (`https://hooks.slack.com/services/…`) |
| `teams-webhook` | Token | the full Teams **Workflows** webhook URL ("When a Teams webhook request is received"). Office 365 connector webhooks were retired by Microsoft in May 2026. |
| `telegram-bot` | Token | the bot token; contact address = chat id |
| `webhook` | Token (or username/password) | the full `https://` URL; optional `authHeader` param + password sent as that header |

Only the entry **id** (`CREDENTIAL_VAULT_ENTRY-…` or `CREDENTIALS_VAULT-…`) is stored in Command Center settings — never the secret. Scripts never
return secrets or URLs in their results.

## External requests allowlist

Settings → General → Environment management → **External requests** (settings schema
`builtin:dt-javascript-runtime.allowed-outbound-connections`, verified): allow the hosts of the providers you use.

Delivery status: the **generic webhook** path is verified live end to end (Events API → Davis problem → engine →
routing by `cc.service` → schedule on-call → webhook via vault entry → `sent` → ledger updated). Twilio, IFTTT, Slack,
Teams and Telegram are implemented per vendor documentation and not exercised live.

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
