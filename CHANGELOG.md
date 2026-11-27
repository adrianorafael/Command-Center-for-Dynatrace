# Changelog

All notable changes to **Command Center for Dynatrace** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/), where "breaking" means breaking for the person running the
app — see `references/release-and-docs-sync.md` in
[Development Pattern for Dynatrace](https://github.com/adrianorafael/development-pattern-for-Dynatrace).

The version here must match `app.config.json` → `app.version`, which is the single source of truth.

## [Unreleased]

## [2.3.0] - 2026-11-27

Lower running cost. Every workflow task execution is one billed function call, whatever starts the workflow, so this
release removes the call per notification by default and adds a way to run the engine less often without paging
later.

### Added
- **Command Center · Engine on problem** (optional): a second simple workflow with a **Problem trigger** that runs
  the engine action when Davis opens or closes a problem. The run waits until the problem can be read in Grail and
  then pages, so the first page no longer depends on the interval and a 5-minute interval becomes practical (about
  8,640 scheduled runs a month instead of 43,200, plus about two runs per problem). Install it from **Integrations →
  Workflows**, with the downloaded JSON, or with `node scripts/install-workflow.mjs --on-problem`. Measured on a trial
  tenant: the trigger fired 1–12 s after the problem event; the incident was created 34–40 s after the problem's
  timestamp (49–65 s after the test event was posted) and resolved within 30 s of the close; one billed invocation
  per firing. Compared with scheduled runs alone the gain is between nothing and one interval. No provider was switched on in those tests, so no notification was sent by such
  a run. The engine workflow stays installed: escalation steps, snooze ends and retries need its clock.
- **Configure → Delivery** for each built-in integration: *By the engine* (default) or *Through its own workflow*.

### Changed
- **The engine sends built-in integrations itself by default.** Switching an integration on no longer opens the
  Workflows app, and a workflow is linked only where you chose *Through its own workflow*. An integration that is
  already linked keeps its workflow until you choose *By the engine*. Sent by the engine, a notification costs no
  extra function call; through its own workflow it costs one (measured, failed sends included).
- **A new problem waits for its events.** A problem none of whose Davis events can be read yet is held back for up to
  90 seconds, because routing happens once and the `cc.*` properties are on those events. Before, such a problem
  could become an incident without its routing properties.
- The sends of a run that waited first (the problem-triggered run) are bound to the start of the invocation, so they
  never outlive the platform's time limit.

### Documentation
- Operations guide (three languages): why the integration workflows start on demand and not on an event trigger, and
  that a workflow's task is billed as one function call whatever started the workflow. Measured on a trial tenant:
  the app's notification action and Dynatrace's own *HTTP request* action, one invocation per run each, failed sends
  included. New section *Running on problems* with the measurements and the limits.
- README and project page: the cost tables list the optional invocations (per problem, per notification).

## [2.2.0] - 2026-11-27

A usability pass over Teams, On-call, Escalations and Services, walked through from an empty app in the offline
preview. A team of three that can be paged now takes 21 clicks and typed fields (about 39 before), and a problem that
Davis detects on its own reaches that team: before, it ended with no team and paged nobody even with every checklist
step done.

### Added
- **Default team from the team form**: *New team* and *Edit team* have a **Default team** checkbox. For a new team it
  is ticked while no default team exists; in *Edit team* it shows whether that team is the default. The default team
  receives every alert that no routing rule sends elsewhere. Deleting the default team clears the setting.
- **Ready to page?** names what still stops a message outside the team: a channel its people use that has no
  provider switched on, and an engine that has never run. The routing step offers *Receive all unrouted alerts* (one
  click) or *Add routing rule* (a rule already named and pointing to the team).
- **Save and next** in the contact sheet walks through the people who have no contact method yet.
- Schedule editor: *Add from the team* buttons, a sentence that says when people swap, and **Who is on call, from
  when** (the next handoffs as a list, in the schedule's time zone).
- Policy simulation: names the people who have no contact method and says when nothing follows the only step.
- **Add people** offers your own user first.
- Offline preview: `?demo=empty` starts with no data, to walk through the first-time setup.

### Changed
- **Ready to page? step 5** is done only when the team is the default team or an enabled routing rule sends alerts
  to it. A service alone no longer counts, because problems that Davis detects on its own carry no `cc.service`. Teams that only own services
  show this step as open after the upgrade. The next step has the highlighted button and steps that need people
  first show none.
- A **new schedule** opens ready to save: named after its team, with the team's paged people in the rotation,
  starting today. People come first; layer names and layer controls appear only with more than one layer.
- A **new escalation policy** opens ready to save: named after its team, the on-call person first and the whole team
  after 10 minutes. *Add step* adds a step with a target. The *Channels* field is behind **Force channels**.
- **Contact sheet**: opens with one row, the address field is named after the channel (*Phone number*, *Chat ID*,
  *Name in the message*, *Routing key*), rows left empty are ignored, and notification rules are an optional section
  with *For priorities*. A new rule covers all priorities (before: up to P3); the sheet says which priorities a
  person's rules leave out.
- **New team** asks for a name and a description only; the default policy is chosen when editing.
- **Routing rules**: the *Enabled* column is gone (the switch stays), the default row warns when there is no default
  team, the page button follows the open tab, the rule's priority is a single select, and the rule tester no longer
  adds sample values to the alert under test.
- **Help → Get started** has five steps; the team steps are one link to the team's checklist. Help also explains the
  default team and the "incident has no team" case.
- The policy list shows who is notified at each step and the wait in between.
- Demo mode: the Telegram provider is switched on, so every channel the demo people use has a provider and the demo
  teams show as ready to page.

### Fixed
- The schedule editor named the handoff weekday from the browser's time zone; it now comes from the schedule's own
  time zone and first handoff.
- A new schedule started at 09:00 of the current day, so one created earlier in the day had nobody on call until
  then. It now starts at the beginning of the day in the schedule's time zone.
- Coverage on the Schedules tab is shown as a percentage, and the header keeps its height when you go on call.

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
