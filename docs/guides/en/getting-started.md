# Getting started — install, permissions and the paging engine

🌐 **English** · [Português (BR)](../pt-BR/getting-started.md) · [Español](../es/getting-started.md)

This guide takes you from an empty environment to a first test page. Allow about 30 minutes. Each step tells you
what is verified and what is not, so you know what to check yourself.

## What you need

- A Dynatrace SaaS environment (latest Dynatrace) with Grail, AppEngine and Workflows.
- Node.js 22 or later and npm, to build and deploy the app.
- Permission to deploy apps. For paging you also need an administrator for the Credential Vault, the External
  requests allowlist and the Workflows authorization settings.
- Accounts at the providers you will use: Twilio and IFTTT are the defaults. Slack, Microsoft Teams, Telegram and a
  generic webhook are built in too.

## Step 1 — Deploy the app

```bash
npm install
# app.config.json → "environmentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/"
npx dt-app deploy
```

- The app ID must start with `my.` for an unsigned app. The default is `my.command.center`.
- Every deploy needs a higher `app.version` than the version installed in that environment.
- On first open, every user is asked to consent to the app's permissions (next section).

## Step 2 — Understand the permissions

The app asks only for what it uses. Every scope below was accepted when the app was deployed to a trial
environment and was exercised there by the feature in the second column.

| App scope | What it is used for | Where Dynatrace documents it |
| --- | --- | --- |
| `storage:buckets:read` | Any Grail read (required together with the table permission) | [Grail permissions](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail) |
| `storage:events:read` | The engine reads `dt.davis.problems`, `dt.davis.events` and `events` | [Grail permissions](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail) |
| `state:app-states:read` / `:write` / `:delete` | Configuration, incidents, operator actions, notification ledger (App State) | SDK reference `@dynatrace-sdk/client-state` ("Required scope" of each call), [State management API](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-state-management-v1) |
| `iam:users:read` | Team member search and display names | [IAM API: get users](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-iam-v1/organizational-levels-level-type-level-id-users-get) |
| `automation:workflows:read` | Integrations → Workflows: install status of the engine workflow | [Workflows security](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/security) |
| `document:documents:read` | War rooms: list notebooks to attach | [Document SDK](https://developer.dynatrace.com/develop/sdks/client-document/) |
| `document:documents:write` | War rooms: create the post-mortem notebook | SDK reference `@dynatrace-sdk/client-document` ("Required scope" of `createDocument`) |
| `credential-vault:entries:read` | The engine reads provider secrets when it sends | [Credential Vault API](https://docs.dynatrace.com/docs/dynatrace-api/platform-api/platform-credential-vault-v1/entries-entry-id-get) |

**Not requested, and why**

- `automation:workflows:write`: the platform rejected it when we deployed the app. The deploy reported that only apps
  provided by Dynatrace can use this scope. So the app **cannot create its workflow itself**. Step 5 shows the
  one-click alternative.
- No ingest scope: the app never writes to Grail. Your tools send events with their own token (see the
  [alerts reference](alerts-reference.md)).
- `automation:workflows:run`: no longer needed. Manual engine runs call the app's own function `engine-run`.

**User permissions.** An app scope is not enough on its own. The app acts with each **user's** permissions, so users
also need IAM policies that grant the same permissions (Grail read, App State, documents, IAM user read).

**User search shows only active users.** Team member search uses the IAM endpoint that returns *active* users of the
account that owns the environment. Someone who was invited but has not accepted the invitation yet is **not found**.
Ask them to sign in once, then search again.

## Step 3 — Store provider secrets in the Credential Vault

Create one entry per provider in **Credential Vault** (latest Dynatrace) and note the entry ID
(`CREDENTIAL_VAULT_ENTRY-…`). Command Center stores **only the ID**, never the secret.

| Provider | Credential type | Contents |
| --- | --- | --- |
| Twilio (SMS, voice, WhatsApp) | Username and password | Account SID / auth token, or API key SID / API key secret (then also fill *Account SID* in the provider) |
| IFTTT Webhooks | Token | Your IFTTT Webhooks key |
| Slack | Token | The full incoming-webhook URL `https://hooks.slack.com/…` |
| Microsoft Teams | Token | The full Teams **Workflows** webhook URL ("When a Teams webhook request is received") |
| Telegram | Token | The bot token (the person's contact address is their chat ID) |
| Generic webhook | Token, or username and password | Token: the endpoint `https://` URL. Username/password: username = URL, password = the value of the auth header |

Entry settings:

- Select the **AppEngine** scope.
- Keep **Owner access only** on (recommended) and make the **workflow actor** (step 5) the owner, as on the trial
  environment. The Dynatrace documentation states
  that a credential is usable in an app only when *both* the user and the app have access to it.
- *Allow access without app context* is **not** needed: the engine runs as an app action. On the trial environment
  an entry without it was read successfully by the engine.

## Step 4 — Allow the provider hosts

**Settings → General → Environment management → External requests**: add only the hosts you use.

| Provider | Host |
| --- | --- |
| Twilio | `api.twilio.com` |
| IFTTT | `maker.ifttt.com` |
| Slack | `hooks.slack.com` |
| Microsoft Teams | The host of your Teams Workflows webhook URL (copy it from the URL) |
| Telegram | `api.telegram.org` |
| Generic webhook | The host of your endpoint |

## Step 5 — Install the engine workflow

The engine is one **simple workflow** named **Command Center · Engine**. It has a single task, the app's own action
**Run Command Center engine**, on an interval trigger. Simple workflows consume no workflow hours
([Create a simple workflow](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/build/simple-workflow)).
The [operations guide](operations.md) explains the cost.

Open **Command Center → Integrations → Workflows**, choose **Run every** 1, 2 or 5 minutes, then use one of these
three options:

| Option | How | Status |
| --- | --- | --- |
| **A. Install in Workflows** | Opens the Workflows app with the workflow filled in (Workflows "create workflow" intent). Review it, save it and deploy it. | The intent payload documented by Dynatrace has title, tasks and trigger, but **no workflow type**. If the new workflow comes out as a *standard* workflow, the Workflows tab shows a warning. Then delete it and use B or C. |
| **B. Download JSON** | Workflows app → **Upload** → the downloaded file. The file contains `"type": "SIMPLE"`. | It is the same definition that was created through the Automation API and ran on the trial environment. The upload button itself was not exercised. |
| **C. Admin script** | `DT_ENVIRONMENT=https://YOUR-ENVIRONMENT.apps.dynatrace.com DT_PLATFORM_TOKEN=… node scripts/install-workflow.mjs --interval 1` (token with `automation:workflows:read` and `automation:workflows:write`). Idempotent; `--dry-run` prints the JSON. | Verified on the trial environment: a simple workflow, running every minute, every execution successful. |

Then:

1. **Actor.** The workflow runs as its actor, which is the person who deploys it unless you set a service user. The
   engine's action reads Grail, App State and the Credential Vault with the actor's permissions.
2. **Authorization settings.** In the Workflows app → **Settings → Authorization settings**, enable for the actor the
   permissions the engine uses: `storage:buckets:read`, `storage:events:read`, `state:app-states:read`,
   `state:app-states:write`, `state:app-states:delete` and `credential-vault:entries:read`. On the trial environment
   all permissions were enabled for the actor, so the minimal set was not isolated.
3. Back in Command Center select **Refresh**. If the workflow was found by its title, select **Save this ID**. The
   status turns green (**Installed · simple workflow**) and **Last engine run** updates within one interval.

**Run engine now** runs one full cycle immediately through the app function `engine-run`, with your own permissions.
Use it to test without waiting for the schedule.

## Step 6 — Configure the providers

**Integrations → Outbound** → open a provider. Paste the vault entry ID, fill the non-secret parameters and turn it
on. Then use **Send test notification** to one address.

| Provider | Parameters |
| --- | --- |
| Twilio SMS / Voice / WhatsApp | *Sender number* in E.164 (WhatsApp: the approved sender). *Account SID* only with an API key. *Messaging service SID* (optional, SMS). *Voice* and *Voice language* (optional, calls). |
| IFTTT | *Event name* (default `command_center_alert`) |
| Slack, Microsoft Teams, Telegram | none |
| Generic webhook | *Auth header name* (optional). The header value is the password of a username/password entry. |

## Step 7 — People, schedules, policies and routing

1. **Teams** → create a team → **Add people** (type at least 3 characters of a name or email) → set roles.
2. For each person: **Contact methods** (phone in E.164, Telegram chat ID, a label for Slack/Teams/IFTTT, a routing key
   for the webhook) and **notification rules**, for example "P1–P2: voice now, SMS after 5 minutes".
3. **On-call → Schedules** → layers, rotation, handoff time and time zone. The coverage preview shows gaps.
4. **Escalations** → a policy, for example: step 1 the schedule's on-call person after 0 minutes, step 2 the whole team
   after 10 minutes, repeat once. **Simulate** shows who is notified when.
5. **Services** → a service with an owning team, a policy and a default priority. Then add **routing rules** and
   **Test a rule**.
6. **Settings → Routing defaults** → the team and policy used when nothing else decides.

Details for every screen: [user guide](user-guide.md).

## Step 8 — Send a test event

```bash
curl -X POST "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest" \
  -H "Authorization: Bearer <PLATFORM-TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"CUSTOM_ALERT","title":"Test from Command Center setup","timeout":15,
       "properties":{"cc.service":"<your service name>","cc.priority":"P3"}}'
```

The token needs `openpipeline:events.davis:ingest`. Within one engine interval the incident appears in the Console.
The on-call person is then paged according to the policy. Acknowledge it in the Console to stop the escalation.

On a **trial or test environment only**, `workflow-templates/command-center-alert-simulator.workflow.json` posts one or
two synthetic `[SIM] …` alerts every 7 minutes. It is a standard workflow, so it consumes workflow hours, and it must
never be imported into production.

## Demo mode

**Settings → General → Demo mode → Show sample data** switches **this browser** to sample incidents, teams, schedules,
war rooms and reports. While it is on, nothing is read from or written to the environment and no notification is
sent. When it is off, everything shown is real data from the environment: the app never mixes the two. The switch is
per browser on purpose, so that a presenter's demo never replaces the real console of the operators on call. Outside
Dynatrace (the offline preview) the app always runs in demo mode.
