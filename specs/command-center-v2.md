# Spec — Command Center for Dynatrace v2.0.0

| | |
| --- | --- |
| Status | **Approved** — the owner asked for the full rebuild to be carried to the end without stopping at gates ("work until the end and make the best decisions"). This approval covers the spec gate and the publish gate. No deploy is performed (no tenant connected). |
| Version | 2.0.0 (major: data model, scopes and UI replaced) |
| Binding contracts | `ui/app/domain/contracts.ts`, `ui/app/data/repository.ts` (these files win over the abridged types below) |
| DQL | Q1–Q4 executed on a trial tenant (Q3 with data since the generic-events test) |

## Amendment A1 (2026-11-27) — engine as a simple workflow

This amendment supersedes every part of this spec that describes the engine as a standard workflow with the tasks
`tick` → 8 senders → `report`, the app functions `engine-tick` / `delivery-report`, the scope
`automation:workflows:run`, and the private-workflow / owner-only manual-run behaviour.

- **Engine:** one SIMPLE workflow (`ui/app/data/workflows/definition.ts`, definition version 3) with a single task, the
  app's custom action `run-engine` (`actions/run-engine.action.ts`), on an interval trigger of 1, 2 or 5 minutes. The
  action runs the whole cycle in one invocation (`api/lib/cycle.ts`: tick → send → delivery report). Reason: simple
  workflows consume no workflow hours, and a simple workflow's task cannot be Run JavaScript.
- **Senders** moved from workflow task scripts to `api/lib/senders.ts`; secrets are read with
  `credential-vault:entries:read` from the action.
- **On-demand runs** (Run engine now, test notifications, Escalate now) call the app function `engine-run` with the
  caller's permissions.
- **Install:** the Workflows create-workflow intent (one confirmation), the JSON upload, or
  `scripts/install-workflow.mjs`. The intent payload has no type property, so the Workflows tab flags a standard result.
- **Scopes:** add `document:documents:read|write` (war rooms) and `credential-vault:entries:read`.
  `automation:workflows:run` stays, now only for the custom workflow provider (kind `workflow`), which runs a
  customer-owned workflow with the notification as params.
- **Workflow visibility:** not private; simple workflows keep execution metadata only and the action returns counts.
- **Measured** (trial tenant billing events): ≈ 690 function invocations per hour plus one workflow hour per hour for
  the standard design; one `ACTION` invocation per run for this design.
- The user documentation (`docs/guides/en`; translations in `ui/app/pages/help/guides/{pt-BR,es}`, shown in the
  in-app Help) describes the current behaviour and wins over this spec where
  they differ.

## Amendment A2 (2026-11-27, 2.1.0) — one workflow per integration

At the owner's request, each built-in integration switched on gets its own simple workflow
(`buildProviderWorkflow`, task = app action `send-notification`), created through the create-workflow intent and
linked by title. The engine keeps reading alerts and escalating, and hands each notification of a linked integration
to that workflow (`automation:workflows:run`); the action sends and writes the ledger result. Unlinked or unrunnable
workflows fall back to a direct send.

## Amendment A3 (2026-11-27, 2.2.0) — first-time setup that ends in a page

A usability pass at the owner's request (configuration should be as simple and intuitive as possible), walked through
from an empty app in the offline preview. It supersedes what this spec and `design/DESIGN.md` say about the team form,
the *Ready to page?* checklist, the contact sheet, the schedule and policy editors, the routing rules tab and Help's
*Get started*.

- **Default team:** the team form (*New team*, *Edit team*) sets `settings.defaults.teamId`; it is ticked for a new
  team while no default team exists, and deleting the default team clears it. Reason: a problem that Davis detects on
  its own carries no `cc.service`, so without a default team or a routing rule it gets no team and pages nobody.
- **Ready to page?** (`ui/app/pages/teams/readiness.ts`, pure and unit-tested): five steps in setup order (people,
  contact methods, schedule, policy, routing). Step 5 is done only when the team is the default team or an enabled,
  non-suppressing rule targets the team or one of its services; owning a service is not enough. The next open step
  has the primary button; steps that need people first have none. What stops delivery outside the team (a channel in
  use without an enabled provider; no engine heartbeat outside demo mode) is listed even when all five steps are
  done, and says whether everything or only some channels are affected.
- **Contact sheet:** opens with one empty row; rows without an address are dropped on save; the address label follows
  the channel; *Save and next* walks through the people without a method. Notification rules are an optional section;
  a new rule covers all priorities (`maxPriority: "P5"`), and the sheet names the priorities a person's rules leave
  out.
- **New schedule:** named `<team> on-call`, the team's paged members as participants, `startsAt` at the start of the
  current day in the schedule's time zone, so coverage starts at once. The handoff weekday on screen comes from
  `firstHandoff(layer, timeZone)`. Layer name and layer controls appear only with more than one layer; the preview
  adds a list of the next handoffs.
- **New escalation policy:** named `<team> escalation`; step 1 is the on-call person of the team's schedule after 0
  minutes, step 2 the whole team after 10 minutes (without a schedule: the whole team at once). *Add step* adds a team
  target after 5 minutes. Step channels are edited only after *Force channels*.
- **Routing rules tab:** no separate Enabled column; the default row warns when no default team exists; a rule opened
  from a team's checklist is prefilled with a name and the team; the tester evaluates only the alert it is given.
- **Help → Get started:** five steps; the team steps are one link to the team's checklist, ticked when one team has
  all five steps done.
- **Demo:** `?demo=empty` (offline preview only) starts the in-memory repository without fixtures. The demo settings
  switch on a provider for every channel the demo people use.
- No change to `contracts.ts` (schemaVersion 1), no new scope, no new query.
- **Not verified on a tenant:** the flow was exercised in the offline preview only; see *Verified and not verified*
  in `docs/guides/en/operations.md`.

## Amendment A4 (2026-11-27, 2.3.0) — the engine sends; optional Problem trigger

At the owner's request (lowest running cost; an event-based trigger where it fits). Measured first: every workflow
task execution is one billed function call whatever the trigger (Dynatrace licensing documentation; billing events of
this app's actions and of Dynatrace's own HTTP request action on a trial tenant). This amendment supersedes A2's
default and what this spec says about how notifications are handed to workflows.

- **Delivery:** the engine sends built-in integrations itself, in the run it is already doing (no extra call). One
  workflow per integration (A2) becomes opt-in per integration: the UI records the choice in
  `provider.params.delivery = "workflow"` and links a workflow only then. The engine is unchanged: it hands off when
  `params.workflowId` is set and otherwise sends directly. No contract change (`params` is a free string map).
- **Engine on problem (optional):** a second SIMPLE workflow, `buildOnProblemWorkflow`, with a Problem trigger
  (`davis-problem`, `triggerOn: "open-and-close"`, every category, `analysisReady: false`) and the same action
  `run-engine`, with the input `problemId` / `problemStatus` from `event()`. It never replaces the interval workflow:
  escalation steps, snooze ends, retries and the other sources need the clock.
- **Problem-triggered run** (`api/lib/problemTrigger.ts`): one success test, "the incident of this problem is in the
  state the trigger reported". The run checks it, polls one small query (Q5, the problem's newest status) every 5 s
  for up to 40 s, runs a normal cycle once the problem is readable (at most two, 10 s apart), and ends when the test
  passes or the wait runs out (the scheduled run then takes over). Sending is bound to the start of the invocation (`deadlineAt`).
  Reason: on the trial tenant the trigger fired 1–12 s after the problem event, but the record was queryable only
  30–40 s after its timestamp.
- **Sources:** a problem younger than 90 s none of whose Davis events is readable yet is held back
  (`HOLD_UNREADABLE_MS`), because routing happens once, at incident creation, and needs the events' `cc.*` properties.
- **Q5** (`buildProblemStatusQuery`) executed on the trial tenant: ACTIVE, CLOSED and unknown-id cases.
- No new scope. `contracts.ts` unchanged (`reason: "problem-trigger"` was already part of `EngineTickRequest`).
- **Verified on the trial tenant:** the trigger, the wait, incident creation with the right team, resolution on
  close, one billed invocation per firing (workflow created through the Automation API and updated with
  `scripts/install-workflow.mjs --on-problem`). **Not verified:** installing this workflow through the intent or the
  JSON upload; the Delivery choice in a signed-in session; a notification sent by a problem-triggered run (no provider
  was switched on in those tests).

## Goal

Replace dedicated event consoles (Splunk On-Call / VictorOps, Atlassian Opsgenie, Moogsoft) for a NOC team, natively on
Dynatrace AppEngine:

- **Inbound** only through Dynatrace APIs: Davis problems, plus events posted to the Events API v2 / OpenPipeline, read from Grail.
- **Console** for operators: triage, ack, assign, snooze, resolve, notes, priority, full timeline/audit.
- **On-call**: teams whose members are **tenant IAM users**, rotating schedules, overrides, escalation policies.
- **Outbound** only through a **Dynatrace Workflow**: Twilio (SMS, voice, WhatsApp) and IFTTT by default, plus Slack, Teams,
  Telegram and a generic webhook "for anything else".
- Strato-only UI, settings panel, documentation.

## Legacy data

v1 stored acknowledgements in one app-state key `problem-ack-states`. v2 does not read it (incompatible model, single-key
read-modify-write race). The Settings page offers to delete it.

---

# Architecture research and plan (architect report)

# Command Center for Dynatrace v2 — architecture hinges and full plan

Nothing was edited or committed. All Dynatrace claims are tagged **VERIFIED (source)** or **UNVERIFIED**. Doc pages were read through a summarising fetcher, so "VERIFIED (URL)" means read this session, not tenant-validated. No tenant was available: every DQL is **UNVALIDATED**.

Abbreviations: `NM` = `/home/user/Command-Center-for-Dynatrace/node_modules`, `AUTO` = `NM/@dynatrace-sdk/client-automation/types/index.d.ts`, `DEV` = `https://developer.dynatrace.com`, `DOCS` = `https://docs.dynatrace.com/docs`.

---

## STEP 1 — Hinges

### H1. Workflow → app logic / App State

| Claim | Status |
|---|---|
| App State is reachable only from this app's own code (UI or its app functions); not from other apps or ad-hoc functions | VERIFIED (`DEV/develop/platform-services/services/state-service/`) |
| A workflow **Run JavaScript** task can call an app function with `fetch('/apps/<appId>/api/<function-name>')` ("URL follows the same pattern as calls from the app UI") | VERIFIED (`DEV/develop/guides/workflows/automate-app-function-runs/`) |
| External absolute form: `https://<env>.apps.dynatrace.com/platform/app-engine/app-functions/v1/apps/<appId>/api/<fn>`; `app-engine:apps:run` "is always needed to access any function of your custom app" | VERIFIED (`DEV/develop/guides/app-functions/create-consume/`, `DEV/develop/guides/access-platform-apis-from-outside/`) |
| App functions: every TS file in `/api` is an endpoint; default export receives the body as `payload`; 120 s timeout, 256 MB, 5 MB in/out, no binary responses, 429 on concurrency, "Functions can't call functions of other apps", external hosts must be allowlisted | VERIFIED (`DEV/develop/app-functions/`, `DEV/develop/reference/javascript-runtime/`) |
| `functions.call(name,{data})` only calls this app's functions; UI hook `useAppFunction({name,data,responseType})` | VERIFIED (`NM/@dynatrace-sdk/app-utils/types/packages/util/app-utils/src/lib/functions.d.ts`; `NM/@dynatrace-sdk/react-hooks/types/index.d.ts:469`) |
| Run JavaScript: signature `export default async function ({ executionId, actionExecutionId })`; relative URLs get platform auth attached (do not set `Authorization`); absolute URLs need own token and allowlisting; 120 s / 256 MB; result ≤ 6 MB; `app-environment` and `navigation` SDKs are NOT available there | VERIFIED (`DOCS/analyze-explore-automate/workflows/default-workflow-actions/run-javascript-workflow-action`) |
| In a JS task: `execution()` → `ex.params`, `ex.input`, `ex.params.event`; `result('<predecessor>')`; `getExecutionLink()` | VERIFIED (dt-app-mcp `get_sdk @dynatrace-sdk/automation-utils` 2.5.1; same docs page) |
| Tasks run as the **workflow actor**; default actor = creator; **a user who updates a workflow becomes its actor** unless the actor is a service user; permissions are gated by Workflows → Settings → Authorization settings (primary/secondary) | VERIFIED (`DOCS/analyze-explore-automate/workflows/security`) |
| Actor permissions listed there: `app-engine:apps:run`, `app-engine:functions:run`, `automation:workflows:*` | VERIFIED (same) |
| Whether the app function invoked from a workflow runs with actor permissions ∩ app scopes, and whether `state:app-states:read/write` must be enabled in the Workflows authorization settings | **UNVERIFIED** (tenant-only) |
| Custom workflow actions: `dt-app action create [name]` generates `actions/<name>.action.ts` + `<name>.widget.tsx` + a settings schema; needs `@dynatrace-sdk/automation-action-utils` and `@dynatrace/automation-action-components` (**not installed**) and jest/ts-jest (**not installed**); runs with the actor's permissions; connections are app-settings objects with `"type":"secret"`; config key `app.actions[] {name,title,description}` | VERIFIED (`npx dt-app action create --help`; `NM/dt-app/lib/src/action/template/*`; `.dt-app/app.config.schema.json` → `Action`; `DEV/develop/guides/workflows/create-custom-action/`) |
| An app function may use `@dynatrace-sdk/client-automation` (`workflowsClient.runWorkflow`, scope `automation:workflows:run`) | VERIFIED (`AUTO:4362-4395`) |

**Decision.** Smallest confirmed path: workflow Run JavaScript task → `fetch('/apps/<appId>/api/<fn>', {method:'POST', body})`. All state access goes through app functions. No custom actions in v2.0 (two missing packages, a jest toolchain, untestable here) — listed as a v2.1 option. The UI triggers on-demand work (escalate now, test notification) with `workflowsClient.runWorkflow`, so every outbound message still leaves through a workflow.

### H2. App State (`@dynatrace-sdk/client-state` 1.11.1)

| Claim | Status |
|---|---|
| Methods: `getAppStates({addFields?, filter?})`, `getAppState({key})`, `setAppState({key, body:{value, validUntilTime?}})`, `deleteAppState({key})`, `deleteAppStates()`, plus user-app-state equivalents | VERIFIED (`NM/@dynatrace-sdk/client-state/types/index.d.ts`) |
| Scopes: `state:app-states:read|write|delete`, `state:user-app-states:read|write|delete` | VERIFIED (same) |
| List returns only `key` by default; `addFields: "value,modificationInfo"`; filter on `key` with `=`, `!=`, `contains`, `starts-with`, `ends-with` (those three are **case-insensitive**), `modificationInfo.lastModifiedTime`, `modificationInfo.lastModifiedBy`, `validUntilTime`; `and/or/not`; single-quoted strings; ≤ 256 chars; nesting ≤ 2 | VERIFIED (same) |
| No paging parameters on `getAppStates` | VERIFIED (same). Whether large lists are capped: **UNVERIFIED** |
| **No version/etag/If-Match anywhere** → last write wins | VERIFIED (same; state-service page makes no concurrency statement) |
| `modificationInfo {lastModifiedBy, lastModifiedTime}` is set by the server | VERIFIED (same) |
| TTL: `validUntilTime` allowed `now+1m` … `now+90d` | VERIFIED (same, `PersistenceState`) |
| Limits: app state value ≤ 10 MB; sum per app ≤ 50 MB; key ≤ 200 chars; user app state ≤ 1 MB per user per app | VERIFIED (`DEV/develop/platform-services/services/state-service/`; error codes in the `.d.ts`) |
| App state is readable by all app users; "AppEngine - Admin" can clear all states | VERIFIED (same page) |
| Allowed key characters (e.g. `:`) | **UNVERIFIED** → use only `[a-z0-9._-]` |
| React hooks `useAppState`, `useAppStates`, `useSetAppState`, `useDeleteAppState` exist | VERIFIED (`NM/@dynatrace-sdk/react-hooks/types/index.d.ts`) |

**Design consequences** (key schema in Step 2 §4): per-entity keys, lower-case; split incident state by writer because there is no optimistic locking; TTL-based archive; explicit size budget.

### H3. Inbound

| Claim | Status |
|---|---|
| `fetch dt.davis.problems`; filter `not(dt.davis.is_duplicate)`; `event.status` is `ACTIVE` or `CLOSED` (never `OPEN`); fields `event.id`, `display_id`, `event.name`, `event.description`, `event.category`, `event.start`, `event.end`, `dt.davis.affected_users_count`, `dt.davis.event_ids`, `affected_entity_ids` | VERIFIED (dt-app-mcp DQL KB entry `application-observability/problems/Problems`) |
| Semantic dictionary: `event.kind` = `DAVIS_PROBLEM` / `DAVIS_EVENT`; `event.severity` long 1–5 (may be absent); `event.status_transition`; `dt.davis.mute.status`; `maintenance.is_under_maintenance`; `duplicate_problem_ids`; `dt.davis.last_reopen_timestamp`; `resolved_problem_duration`; `root_cause.smartscape_entity`, `smartscape.affected_entities` (records: id, type, name); history tables `dt.davis.problems.snapshots`, `dt.davis.events.snapshots` | VERIFIED (`DOCS/discover-dynatrace/references/semantic-dictionary/model/davis`) |
| `affected_entity_ids`, `affected_entity_names`, `root_cause_entity_id`, `root_cause_entity_name`, `entity_tags` are **deprecated** in favour of `smartscape.*` / `primary_tags.*` | VERIFIED (same) |
| Category values conflict: KB says `RESOURCE`, `CUSTOM`; dictionary says `RESOURCE_CONTENTION`, `CUSTOM_ALERT`, `MONITORING_UNAVAILABLE`, `INFO` (events) | Both read; **prefer the dictionary**, map unknown values to "OTHER" |
| v1 query filters on `startTime`/`endTime` — these are not documented problem fields | VERIFIED (`ui/app/hooks/useProblems.ts` vs. dictionary). Do not carry over |
| Events API v2 `POST /api/v2/events/ingest` (SaaS: `https://{env}.live.dynatrace.com/api/v2/events/ingest`); token scope `events.ingest`; platform/OAuth `openpipeline:events.davis:ingest` (legacy `storage:events:write`); body `eventType` (`AVAILABILITY_EVENT`, `CUSTOM_ALERT`, `CUSTOM_ANNOTATION`, `CUSTOM_CONFIGURATION`, `CUSTOM_DEPLOYMENT`, `CUSTOM_INFO`, `ERROR_EVENT`, `MARKED_FOR_TERMINATION`, `PERFORMANCE_EVENT`, `RESOURCE_CONTENTION_EVENT`, `WARNING`), `title`, `entitySelector`, `properties` (≤100 keys), `startTime`, `endTime`, `timeout` (default 15, max 360 min); "problem-opening events can be refreshed… by sending the same payload again" | VERIFIED (`DOCS/discover-dynatrace/references/dynatrace-api/environment-api/events-v2/post-event`) |
| That endpoint is the "Davis events" OpenPipeline source → `dt.davis.events` (`event.kind == "DAVIS_EVENT"`, `event.type` e.g. `CUSTOM_ALERT`, `event.provider`) | VERIFIED (`DOCS/platform/openpipeline/reference/api-ingestion-reference` + dictionary) |
| Which `eventType`s open a problem | **UNVERIFIED** (page only says "problem-opening events") |
| Generic events: `POST /platform/ingest/v1/events` (scope `openpipeline:events:ingest`), custom endpoint `/platform/ingest/custom/events/<name>` (`openpipeline:events.custom:ingest`); bizevents `/api/v2/bizevents/ingest` | VERIFIED (same reference). Landing table `events`: **UNVERIFIED** on that page |
| Read permissions: `events` → `storage:events:read`; `bizevents` → `storage:bizevents:read`; `dt.system.events` → `storage:system:read`; all need `storage:buckets:read` | VERIFIED (`DOCS/platform/grail/organize-data/assign-permissions-in-grail`) |
| `storage:events:read` covers `dt.davis.problems` / `dt.davis.events` | **UNVERIFIED in docs**; attested only by the v1 `app.config.json` comment |

**Decision.** Three sources, one `Alert` model:
1. `davis-problem` — always on, primary.
2. `davis-event` — optional (off by default), for events posted to Events API v2 that do not raise a problem. Suppressed when the event id is in any fetched problem's `dt.davis.event_ids`, or when `dt.davis.is_frequent_event`.
3. `generic-event` — optional, `fetch events` with a documented convention (`event.type == "command_center.alert"`, `cc.dedup_key`, `cc.action` = `trigger|resolve`, `cc.priority`, `cc.service`, `cc.tags`).

Dedup key = `<source>.<sanitised source id>` (problem `event.id`, Davis `event.id`, or `cc.dedup_key`). **An incident is resolved only on an explicit CLOSED/resolve record, never because it disappeared from a result set.**

### H4. Workflows

| Claim | Status |
|---|---|
| `WorkflowCreate {id?, title, description?, isDeployed?, tasks?, actor?, owner?, ownerType?, isPrivate?, schemaVersion?, trigger?, result?, type?: 'STANDARD'|'SIMPLE', input?, hourlyExecutionLimit? (default 1000), guide?, throttle?}` | VERIFIED (`AUTO:3674`) |
| `Task {name?, action, description?, input?, active?, position?{x,y}, predecessors?, conditions?{states?, custom?, else?: 'SKIP'|'STOP'}, withItems?, concurrency?, retry?{count, delay?, failedLoopIterationsOnly?}, timeout?, waitBefore?}`; state values `SUCCESS|ERROR|ANY|OK|NOK` | VERIFIED (`AUTO:2469-2512`) |
| Triggers: `trigger.schedule.trigger` = `{type:'interval', intervalMinutes ≥ 1, betweenStart?, betweenEnd?}` / `{type:'cron', cron}` / time / once; `trigger.eventTrigger.triggerConfiguration` = `{type:'davis-problem', value:{categories:{…}, triggerOn?: 'open'|'open-and-close'|'close', customFilter?, analysisReady?, severityThreshold?, …}}` / `{type:'davis-event', …}` / `{type:'event', value:{query, eventType?: 'events'|'bizevents'|…}}` | VERIFIED (`AUTO:522-860, 1592, 1908-1978`) |
| Action ids `dynatrace.automations:run-javascript` (input `script`) and `dynatrace.automations:http-function` (inputs `url`, `method`) | VERIFIED (`DEV/develop/workflows/use-intents/`, summarised fetch). The http action's header/payload input key names: **UNVERIFIED** → not used |
| `withItems` JSON string syntax | **UNVERIFIED** → not used; each task iterates inside its script |
| Custom condition example `{{ result("task_1").foo == "bar" }}`; retry defaults 2 × 30 s; `waitBefore` ≤ 86400 s | VERIFIED (`DOCS/analyze-explore-automate/workflows/building`) |
| Workflow methods and scopes: `getWorkflows`/`getWorkflow` (`automation:workflows:read`), `createWorkflow`/`updateWorkflow`/`deleteWorkflow`/`getTrashedWorkflows`/`restoreTrashedWorkflow` (`automation:workflows:write`), `runWorkflow({id, body:{input?, params?, uniqueQualifier?}})` (`automation:workflows:run`; returns "No execution created" if the qualifier was used before), `exportWorkflow`, `getExecutions` | VERIFIED (`AUTO:3822-4450`) |
| Credential Vault in a JS task: `credentialVaultEntriesClient.getCredentialVaultEntryDetails({entryId})` from `@dynatrace-sdk/client-credential-vault`; actor needs `credential-vault:entries:read`; credential must have the AppEngine scope, "Allow access without app context" on, and be accessible to the actor | VERIFIED (run-javascript docs page). This replaces the older `client-classic-environment-v2` / `environment-api:credentials:read` approach in the brief and in `security-and-secrets.md`. The shape of the returned details object: **UNVERIFIED** |
| Outbound allowlist: Settings → General → Environment management → **External requests**; wildcards allowed for DNS names with ≥ 3 segments; no API documented; "all HTTP calls are checked against the global allowlist" | VERIFIED (`DEV/develop/guides/app-functions/allow-outbound-connections/`, run-javascript and HTTP-request docs pages) |
| Service users as actor: `usersAndGroupsClient.getAvailableServiceUsers` (`iam:service-users:use`) | VERIFIED (`NM/@dynatrace-sdk/client-iam/types/index.d.ts`) |
| Intent to open Workflows with a definition (`title`, `tasks`, `trigger`) | VERIFIED (use-intents page); exact intent id **UNVERIFIED** → not used in v2.0 |

**Decision.** One deployable engine workflow, a fixed UUID, an idempotent installer (get → update, else check trash → restore+update, else create), plus the same definition as importable JSON. Vault access stays inside workflow scripts, so the app declares no vault scope and never sees a secret.

### H5. IAM users

| Claim | Status |
|---|---|
| `usersAndGroupsClient.getActiveUsersForOrganizationalLevel({levelType, levelId, partialString? (min 3, max 320), uuid?: string[] (≤25), pageSize? ≤1000})` → `{results: RestUserPublic{uid, email, name?, surname?, description?}[], nextPageKey?, totalCount?}`; scope `iam:users:read`; POST variant for bulk uuids | VERIFIED (`NM/@dynatrace-sdk/client-iam/types/index.d.ts`) |
| `partialString` or `uuid` is required — no "list all" | VERIFIED (same) |
| Groups: `getVisibleGroupsForAccount({levelType, levelId, partialGroupName? (min 3), uuid? ≤10})`, scope `iam:groups:read` | VERIFIED (same) |
| `levelType: "environment"` with `levelId = getEnvironmentId()` | VERIFIED (`NM/@dynatrace-sdk/react-hooks/types/index.d.ts`: `useUser`/`useUsers` options default to `"environment"` and auto-detect via `getEnvironmentId()`; `NM/@dynatrace-sdk/app-environment/types/index.d.ts`) |
| Hooks `useUser(uuid)`, `useUsers(uuids)` (bulk, cached) | VERIFIED (same) |
| `getCurrentUserDetails()` → `{id, name, email}`; outside the platform returns `dt.missing.*` placeholders | VERIFIED (app-environment `.d.ts`) |
| No phone numbers in IAM | VERIFIED (`RestUserPublic` shape) |

**Decision.** Members are stored as IAM `uid` only. Contact methods live in app state `contact.<uid>` — not user app state, because the engine runs as the workflow actor and could not read it.

### H6. Strato user picker
None exists. `list_strato_components "user"` returns only charts; `"avatar"` returns `Avatar`, `AvatarGroup` (VERIFIED, dt-app-mcp). No schedule/gantt/timeline component either (`"schedule"` → empty). Build `UserPicker` from a Strato search input/select plus `Avatar`, and render rotation timelines from Strato layout primitives (designer to confirm each component and prop through `get_strato_component`).

### Toolchain facts
- `dt-app` 1.21.0; Node here is 22.23.5 and dt-app warns it wants Node 24 (VERIFIED, CLI output).
- `dt-app build` works offline and emits `dist/ui/{index.html,main.js,main.css}` (VERIFIED, `.dt-app/logs`). `index.html` has `<base href="/ui/">` and loads `/platform/runtime/runtime-loader.js` (VERIFIED, `dist/ui/index.html`).
- jest, ts-jest, vitest, playwright are not installed; vite 8.4.0 and esbuild 0.28.2 are (transitively). `/usr/bin/google-chrome` exists. `npm view` works. vitest 5.1.2 peer-accepts vite `^8` (VERIFIED). Node reports `process.features.typescript === "strip"`.
- `ui/tsconfig.json` has `rootDir: "."`; `build.sourceRoot` resolves `<sourceRoot>/{ui,api,actions,settings,documents}` (VERIFIED, schema).

---

## STEP 2 — Plan (source for `specs/command-center-v2.md`)

### 1. Product scope

- **Alerts → incidents.** Lifecycle `triggered → acknowledged → resolved`, plus `snoozed` (until a time, then re-triggers), reassign (user or team), escalate now, notes, priority P1–P5, tags, full timeline. Dedup by key; re-open if the source reopens.
- **Services and routing rules.** Ordered rules; first match wins; a catch-all default. Conditions on source, title (contains/regex), category, severity, entity name/type/id, tags, management zone (free-text field match; the Grail field for management zone is UNVERIFIED, so it is a generic "field equals" condition), custom field. Result: service, team, escalation policy, priority, tags, or suppress.
- **Teams.** Members are IAM uids with role `admin|responder|observer`. Roles are UI guidance only (see Risks).
- **On-call schedules.** Layers with rotations (daily, weekly, custom N hours/days), handoff time, IANA time zone, optional weekday/time restrictions, overrides. Final schedule = top layer wins, overrides on top.
- **Escalation policies.** Ordered steps; each has a delay in minutes and targets (on-call of schedule, user, whole team); repeat N times; channels come from each user's notification rules, optionally forced per step.
- **Contact methods and notification rules.** SMS, voice, WhatsApp, Telegram, Slack, Teams, email-via-webhook, generic webhook; per-user rules "priority ≤ Px → channel after N minutes".
- **Maintenance / quiet hours.** Davis `maintenance.is_under_maintenance` → status shown and paging suppressed (configurable). In-app quiet-hours windows per team or service (hold or downgrade to low-urgency channels).
- **Reports.** MTTA, MTTR, volume by team/service/priority/source, on-call load per user, notifications sent/failed.

### 2. Architecture

```
External tools ──Events API v2 / OpenPipeline──▶ Grail (dt.davis.problems, dt.davis.events, events)
                                                     │ DQL (client-query, inside app function)
Workflow "Command Center · Engine" (interval 1 min, or runWorkflow from UI)
  tick (run-javascript) ─POST /apps/<id>/api/engine-tick─▶ app function
        ▲                                                   ├─ ingest + dedup + route          (pure domain)
        │ result: {batches by channel}                      ├─ fold operator actions           (pure domain)
  send_* (8 run-javascript tasks, Credential Vault)         ├─ escalation state machine        (pure domain)
        │                                                   └─ plan notifications + ledger     (App State)
  report (run-javascript) ─POST /apps/<id>/api/delivery-report─▶ app function updates ledger + timeline
UI (Strato) ── stateClient: read everything, write config + append-only operator actions
            ── workflowsClient: install / runWorkflow
```

- **Pure domain core** (no Dynatrace or React imports, all time passed in as `now: number`): routing, schedule resolution, escalation state machine, dedup, action folding, notification planning, reporting maths.
- **Repository port** `Repository` with two adapters: `AppStateRepository` (client-state) and `MemoryRepository` (demo/tests). Both the UI and app functions use the port.
- **Guarantee: at-least-once paging.** The notification ledger is the correctness mechanism; the engine lease only reduces overlap.

**Engine tick algorithm** (`domain/engine/tick.ts`, pure: `tick(snapshot, sourceRecords, now) → {writes, deletes, batches}`):
1. Acquire lease `lock.engine` (skip if another holder's lease is younger than 90 s). Write `hb.engine` heartbeat at the end, including error counts.
2. Query enabled sources; normalise to `Alert[]`; suppress Davis events contained in a problem.
3. For each alert: find or create `inc.<id>`; update the alert snapshot; if the source says CLOSED → resolve (`resolvedBy: "source"`); if a resolved incident's source is ACTIVE again with a newer reopen timestamp → re-trigger.
4. Fold `act.<incId>.*` records in key order into the incident using `applyAction`; append to the timeline with the actor taken from `modificationInfo.lastModifiedBy`; delete folded keys.
5. Un-snooze incidents whose `snoozedUntil ≤ now`.
6. For each triggered incident (not acknowledged, snoozed, in maintenance or quiet hours): compute due steps from `escalation.startedAt`, step delays and repeat count; resolve targets (schedule on-call at `now`, users, team); expand through notification rules to `(user, channel, address)`; create one `NotificationRequest` per key `incId.cycle.step.uid.channel.attempt` not already in the ledger.
7. Ledger failure path: an `ntf` entry still `planned` after `settings.engine.reportTimeoutSec` (default 180 s) → mark `timeout`, and if `attempt < maxAttempts` (default 3) plan the same target with `attempt+1`; otherwise write a `notification_failed` timeline entry and let escalation continue to the next step.
8. Archive incidents resolved for longer than `settings.retention.resolvedVisibleHours` into `arc.*` with `validUntilTime`; update the day's `rpt.*` rollup.
9. Return batches grouped by channel, capped at `settings.engine.maxNotificationsPerTick` (default 100).

### 3. Directory layout

```
app.config.json                       (lead)
package.json, tsconfig*.json, vitest.config.ts, eslint.config.mjs   (lead)
specs/command-center-v2.md            (lead)
ui/
  main.tsx
  app/
    App.tsx, routes.tsx
    domain/                           (agent A — pure TS, no React/SDK imports)
      contracts.ts                    (lead-owned; frozen before fan-out)
      ids.ts  keys.ts  time/tz.ts
      alerts/normalize.ts  alerts/dedup.ts
      routing/match.ts
      schedule/resolve.ts  schedule/timeline.ts
      escalation/machine.ts  escalation/targets.ts
      incidents/actions.ts            (applyAction, effectiveIncident)
      notifications/plan.ts  notifications/templates.ts
      engine/tick.ts
      reports/metrics.ts
      validation/*.ts
      demo/fixtures.ts                (synthetic data only)
      __tests__/*.test.ts
    data/                             (agent B)
      repository.ts                   (port)
      appStateRepository.ts  memoryRepository.ts  demoMode.ts
      dql.ts                          (query builders, each labelled UNVALIDATED)
      workflows/definition.ts         (builds WorkflowCreate from settings)
      workflows/scripts/*.ts          (script sources as template strings)
      workflows/installer.ts
      __tests__/*.test.ts
    hooks/  components/  pages/       (agent C)
api/                                  (agent B)
  engine-tick.ts  delivery-report.ts  incident-action.ts (optional server-side action writer)
workflow-templates/                   (agent B, generated + checked in)
  command-center-engine.workflow.json
  command-center-problem-intake.workflow.json   (optional, davis-problem trigger → tick)
scripts/                              (agent B) preview-server.mjs, gen-workflow-templates.mjs
docs/                                 (agent E) index.html + guides
design/                               (agent D) guidance notes
```

**Spike 0 (lead, before fan-out):** prove that `api/engine-tick.ts` can import `../ui/app/domain/...` and that `ui/` compiles it, via `npx dt-app build` plus `tsc --noEmit`. If the api build rejects the cross-root import, move the core to a top-level `shared/` and repeat. Both directions must pass before agents start.

### 4. App State key schema

Keys are lower-case, `[a-z0-9._-]`, ≤ 200 chars. Values are JSON with `schemaVersion`.

| Key | Writer | Content | TTL |
|---|---|---|---|
| `cfg.settings` | UI | `Settings` | none |
| `team.<id>` | UI | `Team` | none |
| `sched.<id>` | UI | `Schedule` | none |
| `pol.<id>` | UI | `EscalationPolicy` | none |
| `svc.<id>` | UI | `Service` | none |
| `rules.main` | UI | ordered `RoutingRule[]` (order must be atomic) | none |
| `contact.<uid>` | UI | `UserContact` | none |
| `inc.<incId>` | engine only | `Incident` (timeline capped at 200 entries) | none while open |
| `act.<incId>.<ts13>.<rand6>` | UI (append-only, never updated) | `IncidentAction` | `now+7d` |
| `ntf.<incId>.<cycle>.<step>.<uidHash>.<channel>.<attempt>` | engine only | `NotificationRecord` | `now+14d` |
| `arc.<yyyymmdd>.<incId>` | engine only | slim resolved `Incident` | `now+<retentionDays ≤ 90>d` |
| `rpt.<yyyy-mm-dd>` | engine only | `DailyRollup` | none (~2 KB/day) |
| `hb.engine` | engine only | `{lastTickAt, durationMs, counts, lastError?}` | none |
| `lock.engine` | engine only | `{holder, acquiredAt}` | `now+2m` |

- Lists: `getAppStates({filter: "key starts-with 'inc.'", addFields: "value,modificationInfo"})`.
- Config writes: read-before-write `rev` check (best effort; a small race window remains because there is no etag).
- UI effective incident = `effectiveIncident(inc, pendingActions)` using the same reducer the engine uses, so an ack shows immediately and survives a concurrent tick.
- Budget: incident ≤ ~20 KB; default cap 1,500 open incidents; Settings shows estimated usage against 50 MB.
- Config export/import (JSON download/upload in Settings) because admins can wipe app state.

### 5. Type contracts (`ui/app/domain/contracts.ts`, abridged but binding)

```ts
export type Priority = 'P1'|'P2'|'P3'|'P4'|'P5';
export type AlertSource = 'davis-problem'|'davis-event'|'generic-event';
export type Channel = 'sms'|'voice'|'whatsapp'|'telegram'|'slack'|'teams'|'ifttt'|'webhook';
export type IncidentStatus = 'triggered'|'acknowledged'|'snoozed'|'resolved';

export interface Alert {
  source: AlertSource; sourceId: string; dedupKey: string; displayId?: string;
  title: string; description?: string; category?: string; severity?: number; // 1..5
  sourceStatus: 'ACTIVE'|'CLOSED'; startedAt: number; endedAt?: number; reopenedAt?: number;
  entities: { id: string; name?: string; type?: string }[];
  rootCause?: { id?: string; name?: string };
  tags: string[]; underMaintenance: boolean; muted: boolean;
  affectedUsers?: number; fields: Record<string, string>; // extra matchable fields
}
export interface TimelineEntry { at: number; type: string; by: string; // uid | 'system' | 'source'
  detail?: string; data?: Record<string, string|number|boolean> }
export interface Incident {
  schemaVersion: 1; id: string; alert: Alert; status: IncidentStatus; priority: Priority;
  serviceId?: string; teamId?: string; policyId?: string; ruleId?: string;
  assignee?: { type: 'user'|'team'; id: string };
  createdAt: number; acknowledgedAt?: number; acknowledgedBy?: string;
  resolvedAt?: number; resolvedBy?: string; snoozedUntil?: number;
  tags: string[]; suppressed?: 'maintenance'|'quiet-hours'|'rule';
  escalation: { cycle: number; startedAt: number; lastStepIndex: number; repeatsDone: number; exhausted: boolean };
  timeline: TimelineEntry[]; lastSeenAt: number;
}
export type IncidentAction = { schemaVersion: 1; incidentId: string; at: number; clientId: string } & (
  | { type: 'ack' } | { type: 'unack' } | { type: 'resolve' } | { type: 'reopen' }
  | { type: 'snooze'; until: number } | { type: 'reassign'; assignee: { type: 'user'|'team'; id: string } }
  | { type: 'escalate' } | { type: 'priority'; priority: Priority }
  | { type: 'note'; text: string } | { type: 'tag'; add?: string[]; remove?: string[] });

export interface Team { schemaVersion: 1; id: string; name: string; description?: string; rev: number;
  members: { uid: string; role: 'admin'|'responder'|'observer' }[];
  defaultPolicyId?: string; quietHours?: QuietHours[] }
export interface QuietHours { timeZone: string; days: number[]; from: string; to: string; // 'HH:mm'
  minPriority: Priority; mode: 'hold'|'low-urgency' }
export interface Schedule { schemaVersion: 1; id: string; name: string; teamId?: string; timeZone: string; rev: number;
  layers: RotationLayer[]; overrides: { id: string; uid: string; from: number; to: number; note?: string }[] }
export interface RotationLayer { id: string; name: string; participants: string[]; // uids, in order
  rotation: { type: 'daily'|'weekly'|'custom'; lengthHours?: number };
  startsAt: number; handoffTime: string; // 'HH:mm' in schedule tz
  restrictions?: { days: number[]; from: string; to: string }[] }
export interface EscalationPolicy { schemaVersion: 1; id: string; name: string; teamId?: string; rev: number;
  repeat: number; steps: { delayMinutes: number; targets: EscalationTarget[]; channels?: Channel[] }[] }
export type EscalationTarget = { type: 'schedule'; scheduleId: string } | { type: 'user'; uid: string } | { type: 'team'; teamId: string };
export interface Service { schemaVersion: 1; id: string; name: string; teamId: string; policyId?: string; rev: number;
  defaultPriority?: Priority }
export interface RoutingRule { id: string; name: string; enabled: boolean;
  match: 'all'|'any'; conditions: { field: string; op: 'equals'|'contains'|'regex'|'in'|'exists'|'lte'|'gte'; value?: string }[];
  then: { serviceId?: string; teamId?: string; policyId?: string; priority?: Priority; addTags?: string[]; suppress?: boolean } }
export interface ContactMethod { id: string; channel: Channel; address: string; label?: string; verified?: boolean }
export interface UserContact { schemaVersion: 1; uid: string; rev: number; timeZone?: string;
  methods: ContactMethod[];
  rules: { maxPriority: Priority; methodId: string; delayMinutes: number }[] }

export interface NotificationRequest {            // payload handed to the workflow
  key: string; incidentId: string; cycle: number; step: number; attempt: number;
  channel: Channel; providerId: string;           // which Settings.providers entry
  to: { uid: string; address: string };           // phone / chat id / webhook key
  subject: string; text: string; speech?: string; // pre-rendered, length-limited
  priority: Priority; incidentUrl: string; displayId?: string;
}
export interface DeliveryResult { key: string; status: 'sent'|'failed'; providerRef?: string; error?: string; at: number }
export interface NotificationRecord extends NotificationRequest { status: 'planned'|'sent'|'failed'|'timeout'; plannedAt: number; reportedAt?: number; error?: string }

export interface ProviderConfig { id: string; channel: Channel; kind: 'twilio'|'ifttt'|'slack-webhook'|'teams-webhook'|'telegram-bot'|'webhook';
  enabled: boolean; credentialVaultId?: string;   // vault entry ID only — never a secret
  params: Record<string, string> }                // non-secret: from-number, IFTTT event name, base URL host
export interface Settings { schemaVersion: 1; rev: number;
  sources: { davisProblems: { enabled: true; lookbackHours: number; includeMaintenance: boolean };
             davisEvents: { enabled: boolean; eventTypes: string[] };
             genericEvents: { enabled: boolean; eventType: string } };
  defaults: { priorityBySeverity: Record<string, Priority>; priorityByCategory: Record<string, Priority>; policyId?: string; teamId?: string };
  engine: { workflowId: string; maxNotificationsPerTick: number; reportTimeoutSec: number; maxAttempts: number };
  retention: { resolvedVisibleHours: number; archiveDays: number };
  providers: ProviderConfig[]; demoMode: boolean }
```

Secrets policy: webhook URLs that embed a token (Slack, Teams, IFTTT key, Telegram bot token) count as secrets and live in the Credential Vault; Settings stores only the vault entry ID.

### 6. `app.config.json` scopes

| Scope | Why | Status of scope string |
|---|---|---|
| `storage:buckets:read` | required for any Grail read | VERIFIED (Grail permissions page) |
| `storage:events:read` | `events`, and (per v1) `dt.davis.problems` / `dt.davis.events` | VERIFIED for `events`; UNVERIFIED for the Davis tables |
| `state:app-states:read` / `:write` / `:delete` | all persistence; delete for folded actions and entity removal | VERIFIED (client-state `.d.ts`) |
| `iam:users:read` | user search, resolving uids | VERIFIED (client-iam `.d.ts`) |
| `iam:groups:read` | optional "import members from group" helper; drop if the feature is cut | VERIFIED |
| `automation:workflows:read` / `:write` / `:run` | installer, status, escalate-now and test runs | VERIFIED (`AUTO`) |
| `iam:service-users:use` | optional: choose a service user as workflow actor | VERIFIED (client-iam `.d.ts`); include only if the picker ships |

Remove `storage:logs:read`. No credential-vault scope, no ingest scope. `app.id` stays `my.command.center`; name `Command Center`; version `2.0.0`; `environmentUrl` stays the placeholder.

### 7. DQL — all UNVALIDATED (no tenant)

```
// Q1 problems (engine + console)  — UNVALIDATED
fetch dt.davis.problems, from: now() - 72h
| filter not(dt.davis.is_duplicate)
| filter event.status == "ACTIVE" or event.end >= now() - 2h
| fields event.id, display_id, event.name, event.description, event.category, event.severity,
         event.status, event.start, event.end, dt.davis.last_reopen_timestamp,
         dt.davis.event_ids, dt.davis.affected_users_count, dt.davis.mute.status,
         maintenance.is_under_maintenance, smartscape.affected_entities, root_cause.smartscape_entity,
         affected_entity_ids, affected_entity_names, root_cause_entity_name, entity_tags
| sort event.start desc
| limit 1000
```
```
// Q2 Davis events not owned by a problem (optional source)  — UNVALIDATED
fetch dt.davis.events, from: now() - 24h
| filter in(event.type, array("CUSTOM_ALERT", "ERROR_EVENT"))        // list comes from settings
| filter event.status == "ACTIVE" or event.end >= now() - 2h
| fields event.id, event.name, event.description, event.type, event.category, event.severity,
         event.status, event.start, event.end, event.provider, dt.davis.is_frequent_event,
         maintenance.is_under_maintenance, dt.source_entity, entity_tags
| limit 1000
```
```
// Q3 generic events convention (optional source)  — UNVALIDATED
fetch events, from: now() - 24h
| filter event.type == "command_center.alert"
| summarize { last_action = takeLast(cc.action), title = takeLast(event.name), priority = takeLast(cc.priority),
              service = takeLast(cc.service), first_seen = min(timestamp), last_seen = max(timestamp) },
            by: { cc.dedup_key }
| limit 1000
```
Function names used (`not`, `in`, `array`, `takeLast`, `summarize`, `min`, `max`) appear in the dt-app-mcp DQL KB or the dictionary examples; that is documentation, not execution. Open questions for the tenant pass: whether a problem ACTIVE for longer than the lookback is still returned by the `from:` window (hence the 72 h default and the "never resolve on absence" rule), whether `event.end` is null while ACTIVE, the record shape of `smartscape.affected_entities`, and whether Q3's fields survive OpenPipeline unchanged. The normaliser must read both `smartscape.*` and the deprecated fields and tolerate either being missing.

### 8. Engine workflow definition

`Command Center · Engine` — `type: 'STANDARD'`, `isPrivate: true`, `trigger.schedule.trigger = {type:'interval', intervalMinutes: 1}`, fixed `id` stored in `Settings.engine.workflowId`, `input: { appId, providers: ProviderConfig[] }` (non-secret).

| Task | Action | Predecessors / condition | Does |
|---|---|---|---|
| `tick` | `dynatrace.automations:run-javascript` | — | reads `execution()` params (`reason`, optional `testRequest`), POSTs to `/apps/<appId>/api/engine-tick`, returns `{sms:[], voice:[], whatsapp:[], telegram:[], slack:[], teams:[], ifttt:[], webhook:[]}` |
| `send_twilio_sms`, `send_twilio_voice`, `send_twilio_whatsapp` | run-javascript | `tick` SUCCESS | `result('tick')`, read vault entry, call Twilio REST per item with `AbortSignal.timeout`, return `DeliveryResult[]` (never the secret) |
| `send_ifttt`, `send_slack`, `send_teams`, `send_telegram` | run-javascript | `tick` SUCCESS | same pattern, provider-specific payload |
| `send_webhook` | run-javascript | `tick` SUCCESS | generic JSON POST of the full `NotificationRequest` to a vault-held URL — the "any other tool" exit |
| `report` | run-javascript | all `send_*` with state `ANY` | gathers results, POSTs to `/apps/<appId>/api/delivery-report` |

- No `withItems`, no http-function inputs, no custom condition expressions — only verified JSON fields.
- Provider endpoint shapes (Twilio, IFTTT, Slack, Teams, Telegram) are third-party APIs not researched this session: **UNVERIFIED**; agent B must cite each vendor's docs in the script header.
- Installer: `getWorkflow(id)` → `updateWorkflow`; on not-found check `getTrashedWorkflows` → `restoreTrashedWorkflow` then update; else `createWorkflow({body:{id,…}})`. Offer "actor = service user" (recommended) and warn that otherwise the installing person becomes the actor. Show a checklist: actor permissions, External requests hosts (e.g. the Twilio API host, IFTTT, Slack, Teams, Telegram hosts), vault entries with "Allow access without app context".
- UI manual runs: `runWorkflow({id, body:{params:{reason:'manual', …}, uniqueQualifier}})`.
- Console shows a "paging engine stale" banner when `hb.engine.lastTickAt` is older than 3 minutes.

### 9. Screens

| Route | Screen | Purpose |
|---|---|---|
| `/` | Console | live incident table (status, priority, team, assignee, age), filters, bulk ack/resolve/snooze, KPI strip, engine-health banner |
| `/incidents/:id` | Incident detail | alert facts, entities, link to the Dynatrace problem, actions, notes, timeline, notification ledger, escalation progress |
| `/on-call` | On-call now | who is on call per schedule/team now and next, with contact channels |
| `/teams` | Teams | CRUD, members via IAM `UserPicker`, roles, default policy |
| `/schedules` | Schedules | layers, rotation preview for 2 weeks, overrides |
| `/policies` | Escalation policies | step editor, repeat, simulation ("who is paged at T+n") |
| `/routing` | Services and routing | services, ordered rules, rule tester against recent alerts |
| `/integrations` | Integrations | inbound how-to (Events API v2, OpenPipeline convention, curl examples with placeholders); outbound: providers, vault IDs, install/update workflow, test notification, allowlist checklist |
| `/settings` | Settings | sources, defaults, retention, engine limits, demo mode, export/import, storage usage |
| `/reports` | Reports | MTTA/MTTR, volume by team/service/priority, on-call load, delivery success — varied visualisations per R8 |
| `/help` | Help | concepts, setup steps, troubleshooting |

### 10. Demo mode and offline preview
- `demoMode.ts`: demo is active when `getEnvironmentId() === 'dt.missing.environment.id'` (documented fallback) or `?demo=1` or `Settings.demoMode`. It swaps in `MemoryRepository` seeded from `domain/demo/fixtures.ts`, a fake user directory and a no-op workflow client. A visible "Demo data" indicator is mandatory.
- Fixtures must be synthetic and pass `scan-secrets.sh` (its regexes catch emails and real-looking entity IDs): `HOST-0000000000000000`, `P-00001`, `user-0001`, addresses on a reserved example domain.
- Preview harness (spike, agent B): `npx dt-app build`, then `scripts/preview-server.mjs` serves `dist/ui` under `/ui/` with SPA fallback and an empty stub for `/platform/runtime/runtime-loader.js`; screenshots with `/usr/bin/google-chrome --headless`. Whether `AppRoot` renders without the platform runtime is **UNVERIFIED**. Fallback: an esbuild/vite entry that mounts `<App/>` with the same demo adapter. `dt-app dev` needs a tenant login and is not an option here.

### 11. Testing
- Add `vitest` as a devDependency (peer-compatible with installed vite 8; registry reachable). Scripts: `test` = `vitest run`, `typecheck` = `tsc --noEmit -p ui` (+ api). Fallback with zero installs: `node --test` with native type stripping, which forces explicit `.ts` import extensions and erasable-only syntax.
- Mandatory domain tests: DST transitions (spring/autumn, two zones), handoff boundaries, layer + override precedence, restrictions; escalation delays/repeat/exhaustion; ack/snooze/reopen races via action folding in any order; idempotent tick (same input twice → zero new notifications); ledger timeout → retry → failed; dedup of problem-owned Davis events; "absent ≠ resolved"; routing precedence; key sanitising and ≤ 200 chars.
- Time-zone maths uses `Intl.DateTimeFormat` with `timeZone`. The runtime docs confirm Intl but not IANA zone data: **UNVERIFIED** in the function runtime.
- Gates: `eslint .`, typecheck, `vitest run`, `npx dt-app build`, headless render of every route in demo mode.

### 12. Work breakdown (disjoint ownership)

Lead first: Spike 0, `contracts.ts`, `app.config.json`, `package.json`, tsconfig/vitest config, spec. Only the lead touches those and commits.

| Agent | Owns | Delivers |
|---|---|---|
| A — domain | `ui/app/domain/**` except `contracts.ts` | all pure modules, fixtures, tests |
| B — platform | `api/**`, `ui/app/data/**`, `workflow-templates/**`, `scripts/**` | repository adapters, DQL builders, app functions, workflow definition + scripts, installer, preview server, tests with `MemoryRepository` |
| C — UI | `ui/app/{App.tsx,routes.tsx,pages,components,hooks}/**`, `ui/assets/**` | shell, 11 screens, `UserPicker`, demo indicator; consumes only `contracts.ts`, the `Repository` port and A's pure functions |
| D — designer | `design/**` (read-only elsewhere) | Strato component/prop choices per screen with `get_strato_component` evidence, experience-standard notes, dataviz choices for Reports |
| E — docs | `README.md`, `docs/**`, `AGENTS.md` update | setup guide, inbound/outbound guides, permissions checklist, cost note, screenshots from demo mode |

Sequence: lead (spike + contracts) → A, B, D in parallel → C (may start on shell with fixtures at once) → E → lead integration and review. `AGENTS.md` currently tells agents to use `strato-components-preview`; E must correct it.

### 13. Risks and tenant-only unknowns

1. **Actor permissions for the tick** (app-engine run, state read/write through an app function, Grail read) — unverified; a 403 means silent non-paging. Mitigated by the heartbeat banner and an install checklist.
2. **Workflow actor drift** — whoever edits the workflow becomes actor; recommend a service user.
3. **No optimistic locking** — config edits are last-write-wins; duplicate pages possible in a narrow race (at-least-once).
4. **App State limits** — 50 MB total, unknown list cap, 90-day TTL ceiling; long-term reporting is limited to daily rollups.
5. **Privacy** — phone numbers in `contact.*` are readable by every app user; any app user can write any key, so roles are not enforced server-side; audit identity is only trustworthy from `modificationInfo.lastModifiedBy`.
6. **PII in workflow monitor** — numbers and message text appear in the `tick` task result; keep the workflow private.
7. **DQL** — all three queries unvalidated; scope for Davis tables unverified; field shapes may differ.
8. **Problem-opening semantics** of Events API v2 types and the dedup against `dt.davis.event_ids` — unverified.
9. **Credential Vault** details-object shape and "without app context" behaviour — unverified.
10. **Provider APIs** — not researched; scripts need vendor citations and cannot be exercised here.
11. **Time zones in the function runtime** — IANA data unconfirmed.
12. **Cost** — at least 1,440 executions and up to 4,320 queries per day; workflow billing not researched.
13. **Minute granularity** — escalation delays are accurate to about a minute; the 120 s action limit bounds notifications per tick.
14. **Toolchain** — Node 22 here versus Node 24 expected by dt-app; cross-root import and offline `AppRoot` rendering are spikes.
15. **State loss** — admin "clear app states" or uninstall may wipe configuration; export/import mitigates.

### Critical Files for Implementation
- /home/user/Command-Center-for-Dynatrace/app.config.json
- /home/user/Command-Center-for-Dynatrace/node_modules/@dynatrace-sdk/client-automation/types/index.d.ts
- /home/user/Command-Center-for-Dynatrace/node_modules/@dynatrace-sdk/client-state/types/index.d.ts
- /home/user/Command-Center-for-Dynatrace/node_modules/@dynatrace-sdk/client-iam/types/index.d.ts
- /home/user/Command-Center-for-Dynatrace/ui/app/hooks/useProblems.ts (v1 reference to be replaced; new contract file will be /home/user/Command-Center-for-Dynatrace/ui/app/domain/contracts.ts)