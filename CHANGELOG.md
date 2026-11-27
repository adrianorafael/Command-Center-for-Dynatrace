# Changelog

All notable changes to **Command Center for Dynatrace** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/), where "breaking" means breaking for the person running the
app — see `references/release-and-docs-sync.md` in
[Development Pattern for Dynatrace](https://github.com/adrianorafael/development-pattern-for-Dynatrace).

The version here must match `app.config.json` → `app.version`, which is the single source of truth.

## [Unreleased]

## [2.1.1] - 2026-11-27

### Fixed
- Settings → About shows the installed app version instead of a fixed number.

## [2.1.0] - 2026-11-27

### Added
- **Integration workflows**: switching a built-in integration on opens the Workflows app with its own simple workflow
  (*Command Center · <provider>*, one task: the new app action *Send Command Center notification*). Command Center
  links it by title; the engine then runs it once per notification of that integration, and the action sends and
  records the result in the ledger. If the workflow can't be run, the engine sends directly. Switching off stops
  using it (the app cannot delete workflows). Verified on a trial tenant with the generic webhook.

## [2.0.0] - 2026-11-27

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
- **Outbound notifications** only through the **Command Center · Engine** workflow: a **simple workflow** (no workflow
  hours) whose single task is the app's custom action *Run Command Center engine*, every 1, 2 or 5 minutes. Twilio
  SMS, voice and WhatsApp and IFTTT by default, plus Slack, Microsoft Teams (Workflows webhooks), Telegram and a
  generic JSON webhook (token, or username/password for an auth header). Credentials stay in the Credential Vault; the
  app stores only entry IDs. Notification ledger with retries.
- **Integrations** page: inbound snippets, provider configuration with test notifications, engine install through the
  Workflows create-workflow intent (with a warning when the result is a standard workflow), JSON download, *Run engine
  now*, heartbeat, External requests checklist.
- **Custom workflow integration**: hands each notification to a customer-owned simple workflow (run with the
  notification as params, scope `automation:workflows:run`); the app prefills an example workflow with one HTTP
  request task. Every provider card has an On/Off switch; one provider per channel can be on.
- **War rooms**: meeting link, related incidents (same root cause, or same service within 30 minutes), notebooks
  (generated post-mortem notebook named after the first incident, existing notebooks, links), open/close by people,
  count in the navigation.
- **Notifications**: bottom-right pop-ups, a header bell with unread count, silence and per-category choice.
- **On-call switch** in the header: leave or take on-call now through a schedule override.
- **Team quiet hours** editor (hold, or low-urgency channels only).
- **Created-item highlight**: a one-second pulse on anything created in a list with a button.
- App functions `engine-run`, `status`, `incidents` and `directory`, besides `config`.
- Documentation in English, Portuguese (BR) and Spanish: getting started with a permissions ledger, user guide,
  alerts reference, integrations, configuration and operations.
- **Reports**: MTTA/MTTR, volume, noisy services, delivery success, on-call load, from daily rollups.
- **Settings**: sources, defaults, engine limits, retention, export/import of the configuration, demo mode.
- **Demo mode** with synthetic data, an offline preview server and a screenshot script.
- `scripts/install-workflow.mjs` for admins to install or update the engine workflow through the Automation API.
- `config` app function for configuration as code: export, and validated import with dry run.
- Platform Credential Vault entry IDs (`CREDENTIAL_VAULT_ENTRY-…`) accepted besides classic `CREDENTIALS_VAULT-…`.
- `workflow-templates/`: the engine workflow and a trial-only alert simulator (`[SIM]` alerts every 7 minutes).
- Unit tests (vitest), type-check and lint scripts.

### Changed
- **Scopes changed — every user must re-consent on first load.** Now requested: `storage:buckets:read`,
  `storage:events:read`, `state:app-states:read`, `state:app-states:write`, `state:app-states:delete`,
  `iam:users:read`, `automation:workflows:read`, `automation:workflows:run`, `document:documents:read`,
  `document:documents:write`, `credential-vault:entries:read`.
- **Cost profile changed.** The UI no longer runs DQL. The engine runs around the clock, independent of how many
  people have the app open: one function invocation and 1–8 Grail queries per run (≈ 43,200 runs a month at the
  1-minute interval), and no workflow hours. Measured on a trial tenant against an earlier standard-workflow design:
  ≈ 690 function invocations per hour plus one workflow hour per hour, down to 60 invocations per hour. See the cost
  section before installing.
- **New persisted data format.** State is split across per-entity App State keys (`cfg.*`, `team.*`, `sched.*`,
  `pol.*`, `svc.*`, `contact.*`, `war.*`, `inc.*`, `act.*`, `ntf.*`, `arc.*`, `rpt.*`, `hb.engine`, `lock.engine`).
- The engine workflow is confirmed once in the Workflows app (apps not provided by Dynatrace cannot hold
  `automation:workflows:write`), and its actor needs Workflows authorization settings enabled.
- Strato components updated to 3.x subpath imports; the deprecated preview package is no longer used. New app icon.

### Removed
- `storage:logs:read` scope (unused).
- The 1.x "Send message" and "Escalation call" modals and the single-key acknowledgement store.
  Acknowledgements made in 1.x (`problem-ack-states`) are not migrated; Settings offers to delete them.

### Security
- Phone numbers and chat IDs entered as contact methods are readable by every user of the app. They do not appear in
  the engine workflow's executions (simple workflows keep metadata only; the action returns counts).

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
