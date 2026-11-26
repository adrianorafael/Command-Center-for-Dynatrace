# Operations runbook

For the people who keep Command Center for Dynatrace running: daily checks, what to do when paging stops, upgrades,
backups and cost control.

## Daily and weekly checks

| Check | Where | Healthy |
| --- | --- | --- |
| Engine heartbeat | Console banner; Integrations → Workflows → *Engine heartbeat* | Less than 3 minutes old, no *Last error* |
| Workflow executions | Integrations → Workflows → *Recent executions*, or the Workflows app | `SUCCESS` every minute |
| Inbound sources | Integrations → Inbound | *Receiving*; *Quiet > 1 h* is normal only for calm environments |
| Delivery | Reports → Notification delivery; incident → Notifications | No growing number of `failed` / `timeout` |
| On-call coverage | On-call → Now | No gaps in the next shifts |
| Storage | Settings → Data retention (estimated App State usage) | Well below 50 MB |
| Backup | Settings → Export and import → Export | A recent export exists (weekly, and before every change) |

## Paging stopped — triage in this order

1. **Is the workflow running?** Workflows app → *Command Center · Engine* → executions. No executions: the schedule is
   off, the workflow is not deployed, or the hourly execution limit (240) was hit by manual runs.
2. **Does `tick` fail?** Open the failed execution:
   - HTTP 403 / permission error → the actor lacks a permission, or **Workflows → Settings → Authorization settings**
     are not enabled for it.
   - HTTP 404 → the workflow was generated for another app ID; download and import it again.
   - Timeout → Grail or App State were slow; check the next runs. Persistent timeouts: lower the lookback, disable
     optional sources.
   - `skipped: "locked"` in the result → a previous run still holds the lease (90 s); normal if it happens rarely.
   - `skipped: "disabled"` → **Settings → Paging engine** is switched off.
3. **Does `tick` succeed but nothing is sent?** Look at its result: `counts.notificationsPlanned`. Zero means the
   incidents were acknowledged, snoozed, in maintenance, suppressed by a rule, or have no policy/targets. Check the
   incident's **Escalation** tab.
4. **Are senders failing?** Open the `send_*` task result: each item has `status` and `error`.
   - Host not allowed → add it to **External requests**.
   - Credential errors → the vault entry is missing **Allow access without app context**, is not accessible to the
     actor, or has the wrong type (Twilio needs username and password; the others a token).
   - Provider 4xx → wrong sender number, unverified recipient on a Twilio trial account, wrong IFTTT event name,
     revoked webhook.
5. **Is `report` failing?** Notifications stay `planned`, then become `timeout` and are retried (up to 3 attempts).

While the engine is down, nobody is paged. Use your fallback (phone tree, the providers' own consoles) and announce it.

## Changing the actor

If a person edited the workflow, they may have become its actor. Workflows app → the workflow → settings → set the
service user back as actor, then check that the next run succeeds.

## Upgrading Command Center

1. Read `CHANGELOG.md` for the target version — scope changes force every user to re-consent; workflow changes need a
   re-import.
2. **Export the configuration** (Settings → Export and import).
3. Bump `app.version` if you build it yourself (versions must increase per environment), then `npx dt-app deploy`.
4. Integrations → Workflows: if it shows **Update available**, download the workflow JSON and upload it over the
   existing workflow (or run `scripts/install-workflow.mjs`). Re-check the actor.
5. Watch one successful run and the heartbeat.

## Backups and restore

- **Export** writes settings, teams, schedules, policies, services, routing rules and contact methods to one JSON
  file. It does not include incidents, the notification ledger or reports.
- The file contains phone numbers and chat IDs — store it as personal data.
- **Import** overwrites the settings and every team, schedule, policy, service and contact with the same ID (you are
  asked to confirm). Items that exist only in the environment are kept; incidents are not touched.
- App State is per environment and can be cleared by an AppEngine admin or lost on uninstall. Export before either.

## Data growth

| Data | Bounded by |
| --- | --- |
| Open incidents | Your alert volume. Each incident keeps at most 200 timeline entries. |
| Resolved incidents | Visible for `resolvedVisibleHours` (default 24), then archived for `archiveDays` (default 30, max 90) |
| Operator actions | Folded and deleted by the engine; expire after 7 days otherwise |
| Notification ledger | Expires after 14 days |
| Daily rollups | ~2 KB per day, kept |

App State allows 50 MB per app and 10 MB per value. A storm of thousands of open incidents is the realistic way to run
into limits — use routing rules with **suppress** for known noise.

## Cost control

- The engine runs 1,440 times a day whether or not anyone has the app open. Each run executes 1–8 Grail queries (default
  2). See the README's cost section for the formula.
- Keep Davis events and generic events off unless you need them; keep the problem lookback as short as your longest
  normal problem.
- Every open browser tab polls App State every 30 seconds by default; wall screens can use a longer interval (Settings
  → General → Auto-refresh default).
- Measure: run the queries in a Notebook and read the scanned bytes; check **Account Management → Cost & usage** after a
  day, including the workflow and AppEngine lines.

## Trial and test environments

`workflow-templates/command-center-alert-simulator.workflow.json` creates one or two `[SIM] …` alerts every 7 minutes
through the Events API (as the workflow actor). Import it **only** in trial or test environments, and disable it when
you are done — it creates real Davis problems and, if your policies are active, real pages.

## Removing Command Center

1. Export the configuration if you may come back.
2. Disable or delete the *Command Center · Engine* workflow (and the simulator, if imported).
3. Delete the Credential Vault entries and the External requests hosts you added for it.
4. `npx dt-app uninstall`.
5. Optionally clear the app's App State (AppEngine admin).
