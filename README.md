# Command Center for Dynatrace

🌐 **English** · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) — 🔗 **Project page:** https://adrianorafael.github.io/Command-Center-for-Dynatrace/

**Command Center for Dynatrace** is an app created and maintained by [@adrianorafael](https://github.com/adrianorafael) on GitHub.

It is a **NOC event console with on-call management**, built natively on Dynatrace AppEngine. It turns Davis problems
and events posted to Dynatrace into **incidents** that operators triage, acknowledge, assign, snooze and resolve. It
**pages the on-call people** of a team through Twilio (SMS, voice, WhatsApp) and IFTTT by default, plus Slack,
Microsoft Teams, Telegram and a generic webhook. It explores what it takes to replace a dedicated alerting console
such as **Splunk On-Call (VictorOps)**, **Atlassian Opsgenie** or a **Moogsoft-style NOC console** with an app that
lives inside Dynatrace.

This app is a **demonstration app**. It shows how far you can get building your own Dynatrace App through
**vibecoding**, following the official documentation at [developer.dynatrace.com](https://developer.dynatrace.com/)
and using **Strato**, the Dynatrace design system.

> ⚠️ **Disclaimer**
>
> This app is provided by the developer with **no affiliation with Dynatrace** and **no responsibility** for any failures, issues, or consumption of resources and licenses. It is a **study version with no official support**.
>
> Deciding to download and install it in your environment is **at the user's own risk**. You are equally free to improve and expand its features.

> **Paging is a safety-critical function.** Do not make this app the only way your team is woken up at night until
> you have tested every channel end to end in your own environment. Read
> [Verified and not verified](docs/guides/en/operations.md#verified-and-not-verified) first.

![Console](docs/screenshots/console.png)

## Overview

| | |
| --- | --- |
| **Inbound** | Only through Dynatrace: Davis problems, optionally Davis events and generic events, read from Grail with DQL. Your tools post events to the Dynatrace ingest APIs. |
| **Console** | Live incident table with KPI tiles, filters, bulk actions and keyboard shortcuts; incident details with timeline, escalation progress, notification ledger, entities and notes. |
| **On-call** | Teams of **Dynatrace users** (picked from IAM), layered rotating schedules with overrides, escalation policies with steps and repeats, personal contact methods, notification rules and team quiet hours. |
| **War rooms** | A meeting link plus the incidents it handles and its Dynatrace Notebooks, including a generated post-mortem notebook. |
| **Outbound** | One **simple workflow** (*Command Center · Engine*) runs the app's own action every 1, 2 or 5 minutes. It consumes no workflow hours. |
| **Storage** | Dynatrace App State. No external database. Provider secrets stay in the Credential Vault. |
| **Demo mode** | Per browser: sample data everywhere, nothing read or written, nothing sent. Off: only real data. |

Current version: **2.0.0** — see [CHANGELOG.md](CHANGELOG.md).

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/guides/en/getting-started.md) | Deploy, every permission with its Dynatrace documentation, Credential Vault, allowlist, engine install, first test |
| [User guide](docs/guides/en/user-guide.md) | Every screen and menu, icons, statuses, KPIs, notifications, war rooms, on-call switch |
| [Alerts reference](docs/guides/en/alerts-reference.md) | The three inbound paths, JSON formats, fields, `cc.*` properties, routing order |
| [Integrations](docs/guides/en/integrations.md) | The eight channels, what each provider receives, webhook payload, message texts, tests |
| [Configuration](docs/guides/en/configuration.md) | Every setting with its default, app functions for automation, stored data |
| [Operations](docs/guides/en/operations.md) | Architecture, the simple-workflow cost study with measurements, troubleshooting, security, what is verified |

Also in Portuguese (BR) in [docs/guides/pt-BR](docs/guides/pt-BR/) and Spanish in [docs/guides/es](docs/guides/es/).

## What it replaces

| Capability of a dedicated console | How Command Center does it |
| --- | --- |
| Alert intake API | Dynatrace event ingest through OpenPipeline. Davis turns events into problems; Command Center reads them from Grail. |
| Deduplication and correlation | Davis correlation into problems, plus a dedup key per source (`cc.dedup_key`) |
| Incident timeline and audit | Append-only timeline per incident: who, when, what |
| On-call schedules, rotations, overrides | Layers (daily, weekly, every N hours), handoff time, time zone, weekday/time restrictions, overrides, leave/take on-call from the header |
| Escalation policies | Ordered steps with delays, targets (schedule, user, whole team), optional forced channels, repeats; stops on acknowledgement |
| Contact methods and personal rules | SMS, voice, WhatsApp, Telegram, Slack, Teams, IFTTT, webhook, with "priority up to Px → this method after N minutes" |
| Routing / alert rules | Services plus ordered rules (first match wins), with a rule tester |
| Maintenance and quiet hours | Davis maintenance windows suppress paging (configurable); team quiet hours hold or downgrade less urgent pages |
| War rooms / bridges | Meeting link, linked incidents, notebooks, post-mortem template |
| Reports | MTTA, MTTR, volume, noise, delivery, on-call load |
| Outbound integrations | Built-in senders plus a generic JSON webhook for anything else |

Not implemented: two-way acknowledgement from SMS or chat replies, a mobile app, status pages, and per-user
permissions enforced on the server.

## Quick start

```bash
npm install
# app.config.json → "environmentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/"
npx dt-app deploy
```

Then, in the app:

1. **Integrations → Workflows** → choose the interval → **Install in Workflows** (or **Download JSON** and upload it).
   Enable the Workflows **Authorization settings** for the actor.
2. **Credential Vault** entries for your providers. Add their hosts to **External requests**.
3. **Integrations → Outbound** → configure a provider → **Send test notification**.
4. **Teams**, **On-call**, **Escalations**, **Services** → people, schedules, a policy, routing.
5. Send an event (the token needs `openpipeline:events.davis:ingest`):

```bash
curl -X POST "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest" \
  -H "Authorization: Bearer <PLATFORM-TOKEN>" -H "Content-Type: application/json" \
  -d '{"eventType":"CUSTOM_ALERT","title":"Checkout latency above 2 s","timeout":30,
       "properties":{"cc.service":"checkout","cc.priority":"P2"}}'
```

Every step in detail: [getting started](docs/guides/en/getting-started.md).

## Required OAuth scopes

| Scope | Purpose |
| --- | --- |
| `storage:buckets:read` | Any Grail read |
| `storage:events:read` | Read `dt.davis.problems`, `dt.davis.events`, `events` |
| `state:app-states:read` / `:write` / `:delete` | Configuration, incidents, actions, notification ledger |
| `iam:users:read` | Team member search and names |
| `automation:workflows:read` | Engine workflow install status |
| `document:documents:read` / `:write` | War rooms: attach notebooks, create the post-mortem notebook |
| `credential-vault:entries:read` | The engine reads provider secrets when it sends |

`automation:workflows:write` is **not** requested: the platform rejected it when we deployed, with the message that only
apps provided by Dynatrace can use it. That is why the workflow is installed with one confirmation in the Workflows
app. The documentation link for each scope is in [getting started](docs/guides/en/getting-started.md#step-2--understand-the-permissions).

## Query cost and consumption

> ⚠️ Read this before running the app in production. The engine runs all day, independently of how many people use
> the app.

| Item | 1-minute interval | 2 minutes | 5 minutes |
| --- | --- | --- | --- |
| Engine runs (one function invocation each) per month | ≈ 43,200 | ≈ 21,600 | ≈ 8,640 |
| Workflow hours | 0 | 0 | 0 |
| Grail queries per run | 1–8 | 1–8 | 1–8 |

Measured on a trial environment: the previous standard-workflow engine used about **690 function invocations per hour
plus one workflow hour per hour**. The simple-workflow engine uses **1 invocation per run** (60 per hour at a 1-minute
interval) and no workflow hours. The UI runs no DQL. The queries, the drivers and how to measure them in your own
environment are in the [operations guide](docs/guides/en/operations.md#cost-and-consumption).

## Development

```bash
npx dt-app dev        # open the link printed in the terminal (the app must run inside Dynatrace)
npm test              # vitest: domain, engine cycle, senders, lease, workflow definition
npm run typecheck     # tsc for ui/ and api/
npm run lint          # ESLint incl. security and secret rules
npm run check         # lint + typecheck + test + build
```

Offline preview in demo mode: `npx dt-app build && node scripts/preview-server.mjs --port 4173`, then open
`http://127.0.0.1:4173/ui/`. `node scripts/screenshot.mjs ./out` takes one screenshot per route.

| Script | Description |
| --- | --- |
| `node scripts/install-workflow.mjs [--interval 1\|2\|5] [--actor <uid>] [--dry-run]` | Admin install or update of the engine workflow through the Automation API (platform token with `automation:workflows:read` and `:write`) |
| `node scripts/gen-workflow-templates.mjs [--check]` | Regenerate or check `workflow-templates/command-center-engine.workflow.json` |
| `node scripts/preview-server.mjs` | Serve the built UI offline in demo mode |
| `node scripts/screenshot.mjs` | Screenshot every route of the offline preview |

Deploying to another environment: edit `environmentUrl`, `npx dt-app auth`, `npx dt-app deploy`, then repeat the
engine install, vault entries and allowlist. App State does not migrate: use **Settings → Export and import**.

## Relevant file structure

```
app.config.json                  app id, version, scopes, the run-engine action
actions/run-engine.action.ts     the workflow action: one engine cycle
api/                             app functions engine-run, config, status, incidents, directory
api/lib/                         engine cycle, sources (Q1–Q4), lease, senders, config as code
ui/app/domain/                   pure TypeScript core: routing, schedules, escalation, planning, reports
ui/app/data/                     App State, DQL builders, IAM directory, notebooks, workflow definition
ui/app/pages/                    console, war rooms, on-call, teams, escalations, services, integrations, reports, settings, help
workflow-templates/              generated engine workflow + trial-only alert simulator
docs/                            project page, guides in three languages, screenshots
specs/, design/                  specification and screen design
```

## Versioning and changelog

[Semantic Versioning](https://semver.org/), where "breaking" means breaking for the person running the app. MAJOR: a
scope changed (everyone re-consents), stored data changed without migration, a feature was removed or a default raises
cost. MINOR: a new view, chart, filter or setting. PATCH: fixes, copy, styling, dependency bumps.
`app.config.json → app.version` is the single source of truth, every release is in [CHANGELOG.md](CHANGELOG.md), and
Dynatrace rejects a deploy whose version is not higher than the installed one.

---

Built following [Development Pattern for Dynatrace](https://github.com/adrianorafael/development-pattern-for-Dynatrace).
