# Changelog

All notable changes to **Command Center for Dynatrace** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/), where "breaking" means breaking for the person running the
app — see `references/release-and-docs-sync.md` in
[Development Pattern for Dynatrace](https://github.com/adrianorafael/development-pattern-for-Dynatrace).

The version here must match `app.config.json` → `app.version`, which is the single source of truth.

## [Unreleased]

## [2.0.0] - 2026-11-26

A full rebuild: from a problem list with acknowledgements to a NOC event console with on-call teams and escalation
through Dynatrace Workflows, aimed at replacing tools such as Splunk On-Call (VictorOps), Opsgenie or a Moogsoft-style
console.

### Added
- **Incidents** built from Davis problems, with optional Davis events and a generic-events convention as extra sources.
  Lifecycle triggered → acknowledged → resolved, plus snooze, reassign (user or team), escalate now, priority P1–P5,
  tags, append-only notes and a full audit timeline.
- **Console** with KPI strip, URL-based filters, free-text search, bulk actions, keyboard shortcuts, incident detail
  (timeline, escalation, notification ledger, entities, notes) and an engine-health banner.
- **Teams** whose members are users of the Dynatrace environment (picked from IAM), with roles, contact methods and
  personal notification rules.
- **On-call schedules** with layers, daily/weekly/custom rotations, handoff time, time zones, restrictions and overrides;
  "on call now" view and coverage preview.
- **Escalation policies** with delayed steps, targets (schedule, user, team), forced channels, repeats and a simulation.
- **Services and routing rules** (first match wins) with a rule tester and a priority mapping by severity and category.
  Events sent to the Events API can route with `cc.service`, `cc.priority` and `cc.tags`.
- **Outbound notifications** only through the **Command Center · Engine** workflow (every minute): Twilio SMS, voice
  and WhatsApp and IFTTT by default, plus Slack, Microsoft Teams (Workflows webhooks), Telegram and a generic JSON
  webhook. Credentials stay in the Credential Vault; the app stores only entry IDs. Notification ledger with retries.
- **Integrations** page: inbound snippets, provider configuration with test notifications, workflow download, status
  and recent executions, External requests checklist.
- **Reports**: MTTA/MTTR, volume, noisy services, delivery success, on-call load, from daily rollups.
- **Settings**: sources, defaults, engine limits, retention, export/import of the configuration, demo mode.
- **Demo mode** with synthetic data, an offline preview server and a screenshot script.
- `scripts/install-workflow.mjs` for admins to install or update the engine workflow through the Automation API.
- `workflow-templates/`: the engine workflow and a trial-only alert simulator (`[SIM]` alerts every 7 minutes).
- Unit tests (vitest), type-check and lint scripts.

### Changed
- **Scopes changed — every user must re-consent on first load.** Now requested: `storage:buckets:read`,
  `storage:events:read`, `state:app-states:read`, `state:app-states:write`, `state:app-states:delete`,
  `iam:users:read`, `automation:workflows:read`, `automation:workflows:run`.
- **Cost profile changed.** The UI no longer runs DQL. The engine runs 1–8 Grail queries per minute (default 2),
  around the clock, independent of how many people have the app open; plus ~1,440 workflow executions per day.
  See the README's cost section before installing.
- **New persisted data format.** State is split across per-entity App State keys (`cfg.*`, `team.*`, `sched.*`,
  `pol.*`, `svc.*`, `contact.*`, `inc.*`, `act.*`, `ntf.*`, `arc.*`, `rpt.*`, `hb.engine`, `lock.engine`).
- The engine workflow must be imported in the Workflows app (third-party apps cannot hold
  `automation:workflows:write`), and its actor needs Workflows authorization settings enabled.
- Strato components updated to 3.x subpath imports; the deprecated preview package is no longer used. New app icon.

### Removed
- `storage:logs:read` scope (unused).
- The 1.x "Send message" and "Escalation call" modals and the single-key acknowledgement store.
  Acknowledgements made in 1.x (`problem-ack-states`) are not migrated; Settings offers to delete them.

### Security
- Phone numbers and chat IDs entered as contact methods are readable by every user of the app, and appear in the
  engine workflow's execution results. Keep the workflow private.

## [1.1.3] - 2026-07

Summary of the 1.x line (no separate changelog was kept before 2.0.0):

### Added
- Problems view over `dt.davis.problems` with status cards (all, open, closed, acknowledged, maintenance), timeframe
  selector, assignee filter, pagination and links to the Dynatrace problem.
- Acknowledge / unacknowledge persisted in App State (`problem-ack-states`), shared by all users.
- History modal combining Grail start/close events with acknowledgements.
- Placeholder "Send message" and "Escalation call" modals.
- Auto-refresh every minute (one Grail query per minute per open tab).
- GitHub Pages project page.
