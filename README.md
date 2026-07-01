# Command Center for Dynatrace

**Command Center for Dynatrace** is an app created and maintained by [@adrianorafael](https://github.com/adrianorafael) on GitHub.

It is an example of an **event console** that lets monitoring operations teams register an **"Ack"** to acknowledge problems, audit the status of acknowledge interactions, and explore the idea of having defined contacts for on-call activation or escalation.

This app is **not finished** — it is a **demonstration app** meant to show how easy it is to build your own Dynatrace App through **vibecoding**, following the official documentation at [developer.dynatrace.com](https://developer.dynatrace.com/) and using **Strato Design** to style it with Dynatrace's Design System.

> ⚠️ **Disclaimer**
>
> This app is provided by the developer with **no affiliation with Dynatrace** and **no responsibility** for any failures, issues, or consumption of resources and licenses. It is a **study version with no official support**.
>
> Deciding to download and install it in your environment is **at the user's own risk**. You are equally free to improve and expand its features.

## Overview

Command Center is a Dynatrace app built with React + TypeScript that provides a centralized and interactive view of all Problems in the environment, with features for triage, persistent acknowledgment, message sending, and contact escalation.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Installation and Configuration](#installation-and-configuration)
3. [Running in Development Mode](#running-in-development-mode)
4. [Publishing to Environment (Deploy)](#publishing-to-environment-deploy)
5. [Publishing to Another Environment](#publishing-to-another-environment)
6. [Required OAuth Scopes](#required-oauth-scopes)
7. [App Features](#app-features)
8. [Important Behaviors](#important-behaviors)
9. [Query Cost & Consumption (DPS)](#query-cost--consumption-dps)
10. [Relevant File Structure](#relevant-file-structure)
11. [Available Scripts](#available-scripts)

## Prerequisites

- Node.js >= 18 (recommended: version 24 as per dt-app)
- npm >= 9
- Dynatrace account with Grail enabled (dt.davis.problems table)
- Access to environment via dt-app CLI

Install project dependencies:

```bash
npm install
```

## Installation and Configuration

### Step 1: Configure the target environment in app.config.json:

```json
{
  "environmentUrl": "https://YOUR-ENVIRONMENT.apps.dynatrace.com/",
  "app": {
    "id": "my.command.center",
    ...
  }
}
```

Replace `YOUR-ENVIRONMENT` with your own Dynatrace tenant ID. The environment URL has the form `https://<tenant-id>.apps.dynatrace.com/` (production) — you can copy it from the address bar of your Dynatrace environment.

**IMPORTANT:** The app ID must start with "my." for unsigned apps. IDs without the "my." prefix require digital app signing.

### Step 1b (optional): Update the debug URL in .vscode/launch.json

If you use the VS Code "Debug Frontend" launch configuration, also update the `url` in [.vscode/launch.json](.vscode/launch.json) to point to your own environment. This file ships with a `YOUR-ENVIRONMENT` placeholder and is only used for in-IDE debugging — it does not affect `dt-app dev`/`deploy`.

### Step 2: Authenticate to the environment:

```bash
npx dt-app auth
```

This will open your browser for Dynatrace login. On first run, the user will need to grant the scopes listed in [Required OAuth Scopes](#required-oauth-scopes).

If authentication fails with "invalid scopes", verify that the tenant has the necessary permissions and that the user has the corresponding IAM grants.

## Running in Development Mode

```bash
npx dt-app dev
```

The local server runs on http://localhost:3000. The dt-app provides a reverse proxy that forwards all API calls to the configured environmentUrl, automatically injecting the authentication token.

The link to open the app within Dynatrace is displayed in the terminal after the server starts. Always use that link (don't access localhost directly), as the app needs to run within the Dynatrace context to function.

Any changes to files are automatically reflected (hot reload).

## Publishing to Environment (Deploy)

```bash
npx dt-app deploy
```

Executes the production build and publishes the app to the configured environment. After deployment, the app is available to all tenant users in:

```
Dynatrace → Apps → Command Center
```

The local server does not need to be running after deployment.

Complete flow:
1. `npx dt-app auth` (if not already authenticated)
2. `npx dt-app deploy`

## Publishing to Another Environment

Deployment is per environment. To publish to a different environment:

**Step 1:** Edit the environmentUrl in app.config.json:
```json
"environmentUrl": "https://NEW-ENVIRONMENT.apps.dynatrace.com/"
```

**Step 2:** Re-authenticate:
```bash
npx dt-app auth
```

**Step 3:** Deploy:
```bash
npx dt-app deploy
```

**ATTENTION:**
- App State (persisted Acks) is isolated by tenant. Each environment starts with a clean slate — acknowledgments from the previous environment are not migrated.
- The new environment must have Grail enabled and the dt.davis.problems table available. Environments without Grail will not return problem data.
- The administrator of the new environment must ensure that users have IAM permissions for the declared scopes (see [Required OAuth Scopes](#required-oauth-scopes)).

## Required OAuth Scopes

Scopes are declared in app.config.json and requested from the user on first app load (or after re-authentication with new scopes).

- `storage:logs:read` — Default dt-app template
- `storage:buckets:read` — Default dt-app template
- `storage:events:read` — DQL access to dt.davis.problems table (Grail)
- `state:app-states:read` — Reading persisted Ack state
- `state:app-states:write` — Writing Ack/Unack state

If a new scope is added to app.config.json after deployment, existing users will need to re-authorize the app. This happens automatically on next load with a Dynatrace consent screen.

## App Features

### Problems View
- Table with all problems in the selected timeframe
- Columns: Problem #, Started, Summary, Root Cause, Events, Assigned To, Status, Action
- Pagination with 20 items per page
- Red line highlight for OPEN problems
- Direct links to problems in Dynatrace in the Problem # column

### Status Cards (Filters)
- All problems, Open, Closed, Acknowledged, Maintenance
- Click a card to filter the table by that status
- Real-time count of problems per status
- "--" value displayed when count is zero

### Timeframe Filter
- Timeframe selector integrated with Dynatrace presets
- Default: "Today" (@d to now())
- Timeframe is passed directly to the DQL query

### Assignee Filter (Acknowledged by)
- Filters table by the user who performed the Ack
- Options: All users, Unassigned, My, and individual users

### Auto-Refresh
- Button with RefreshAuto icon next to TimeframeSelector
- When active (clear icon): performs immediate refresh and repeats every 1 minute
- When inactive (grayed icon): no automatic refresh
- Refresh updates data in background without altering filters, timeframe, or any UI state

### Acknowledgment (Ack/Unack)
- Action column: clickable UserEvents icon for OPEN problems (Ack)
- Yellow UserEvents icon for ACKNOWLEDGED problems (Unack)
- Disabled UserEvents icon for problems with no Ack/Unack option
- Ack state is persisted in Dynatrace App State API (per tenant)
- On app load, persisted state is loaded and applied over data from Grail

### History Modal (document icon)
- Displays complete event history of the problem
- Combines System events (Started, Closed — from Grail) with user events (Acknowledged, Unacknowledged — persisted in App State)
- System events are always displayed regardless of persistence

### Send Message Modal (chat icon)
- Fields: Title and Content
- Send button enabled only when both fields are filled
- Identified by the problem's display_id (e.g., P-12345)

### Escalation Call Modal (phone icon)
- Displays the problem's escalation contact
- When no contact is defined, displays "Contact undefined" and "no phone number"

### Assigned User Modal (click on name in Assigned To column)
- Displays name and email of the user who performed the Ack
- For current user: shows the actual email from Dynatrace profile
- For other users: displays name and "no email"
- Column shows "Me" when the logged-in user is responsible

## Important Behaviors

### Real-time Data
The app queries the dt.davis.problems table directly via DQL (Grail). Data is loaded when opening the app and changing the timeframe. A ProgressCircle is displayed while the query is executing.

### Status Mapping
Dynatrace returns the following statuses that are mapped by the app:

- `ACTIVE` → Open
- `CLOSED` / `RESOLVED` → Closed
- `ACKNOWLEDGED` → Acknowledged
- `UNDER_MAINTENANCE` → Maintenance

### Ack Persistence (App State)
Acknowledgment is a local app operation — Dynatrace does not have an official Ack endpoint via API for dt.davis.problems.

The app persists state using the Dynatrace App State API:
- Key: "problem-ack-states"
- Value: JSON with `{ [problemId]: { action, assignedTo, history } }`
- State is shared among all tenant users
- The last Ack/Unack of each problem prevails

**LIMITATION:** App State has a 400KB total limit. In environments with many problems being acknowledged over time, periodic cleanup of old entries may be necessary.

### No Grail Problem
If the environment does not have Grail enabled or the dt.davis.problems table doesn't exist, the table will display "No data available." and no problems will be listed.

### Authentication Failure on Startup
If `dt-app dev` returns "Authentication failed", run:
```bash
npx dt-app auth
```

This occurs when the app.config.json scopes have been changed since the last authentication.

### display_id Field
The text displayed in the Problem # column is the display_id field (e.g., P-12345). The link points to the problem using the event.id (internal technical ID from Grail). The link format is:

```
{environmentUrl}/ui/apps/dynatrace.davis.problems/problem/{event.id}?from=%40d&to=now%28%29
```

### Current User
The name displayed in "Assigned To" and in modals is obtained via `getCurrentUserDetails()` from the `@dynatrace-sdk/app-environment` SDK. In development, it returns the user authenticated via `dt-app auth`.

## Query Cost & Consumption (DPS)

> ⚠️ **Read this before running the app in a production environment.** This app runs live DQL queries against Grail, which consumes Dynatrace Platform Subscription (DPS) budget. Understand and measure it to avoid surprises on your bill.

### What drives cost

The only meaningful cost driver is the **Grail query** on `dt.davis.problems` executed by [useProblems.ts](ui/app/hooks/useProblems.ts). The App State reads/writes (Ack persistence) have negligible cost. Grail query consumption is billed by the **amount of data analyzed (GB scanned)** per execution.

The number of executions — and therefore the total cost — is multiplied by these factors:

| Factor | Effect on cost | Notes |
| --- | --- | --- |
| **Auto-refresh (1 min)** | 🔴 **Dominant** — 1 query per minute, per open tab | On by default. This is the biggest lever. |
| **Timeframe width** | Wider window = more data scanned | Default is "Today", which is narrow. |
| **Concurrent users / open tabs** | Multiplies linearly | Each open app instance runs its own auto-refresh. |
| **Number of problems in the environment** | More records = more GB scanned | Environment-dependent. |

### Rough estimate

Use this formula to project consumption:

```
GB/month ≈ GB_per_query × queries_per_hour × hours_per_day × days × concurrent_users
cost     ≈ GB/month × your DPS "Grail Query – data analyzed" rate
```

**Illustrative example** (busy environment, auto-refresh ON):
- ~5 MB scanned per query (small environments: well under 1 MB)
- 60 queries/h × 8 h × 22 days × 20 users ≈ **~211,000 queries/month**
- ≈ **~1 TB/month scanned** → multiply by your contract's Grail Query rate.

Without auto-refresh, consumption drops to roughly **one query per app open / timeframe change**.

### How to measure precisely (recommended)

Don't rely on the estimate — measure it in **your** environment:

1. **Notebook / DQL metadata:** paste the app's query into a Dynatrace Notebook and inspect the scan metadata. Programmatically, `queryExecute(...)` returns `metadata.grail.scannedBytes` and `scannedRecords` — the real cost per execution.
2. **Account Management → Cost & usage → Grail Query:** confirms aggregated consumption after running scenarios (e.g. auto-refresh on vs off, narrow vs wide timeframe).

### How to reduce cost

- **Increase the auto-refresh interval** (e.g. 60s → 5 min) or turn it off by default — biggest single win. The interval is set in [Problems.tsx](ui/app/pages/Problems.tsx) (`60_000` ms in the auto-refresh effect).
- **Keep the default timeframe narrow** ("Today").
- **Project only the fields you need** with `| fields ...` in the `fetch` — Grail is columnar, so scanning fewer fields scans fewer bytes.
- Avoid leaving many app tabs open simultaneously.

## Relevant File Structure

- **app.config.json** — Main app configuration: environmentUrl, ID, OAuth scopes, icon.

- **ui/app/pages/Problems.tsx** — Main component. Contains all UI: cards, table, modals, filters, auto-refresh and Ack/Unack logic.

- **ui/app/types/problems.ts** — Single source of truth for all shared TypeScript types: `Problem`, `ProblemStatus`, `HistoryEvent`, `HistoryEventType`, `EscalationContact`, `FilterStatus`. Imported by both `Problems.tsx` and `useProblems.ts`.

- **ui/app/utils/timeframe.ts** — Shared utility: `parseTimeframeDate`. Resolves Strato `TimeValue` objects and plain expression strings (e.g. `"now()-2h"`, `"@d"`) to a JS `Date`. Re-evaluates expressions at call time so auto-refresh always uses the current instant.

- **ui/app/hooks/useProblems.ts** — Hook that executes the DQL query on `dt.davis.problems` and maps records to the `Problem` type. Accepts a `Timeframe | { from: string; to: string } | null` object. Rebuilds the query whenever the timeframe reference changes, so calling `applyTimeframe()` in `Problems.tsx` triggers a fresh fetch.

- **ui/app/hooks/useAckEvents.ts** — Hook that reads and writes Ack state to the Dynatrace App State API (`stateClient` from `@dynatrace-sdk/client-state`). Persists only user events (Ack/Unack). Write failures are caught and logged without disrupting the UI (optimistic update is preserved).

- **ui/assets/icons/headset-v2-128x128.svg** — App icon displayed in Dynatrace menu.

- **ui/assets/Dynatrace_Logo.svg** — Logo displayed in app header (Command Center).

## Available Scripts

This project was bootstrapped with the Dynatrace App Toolkit (`dt-app`). The following npm scripts are available:

| Script | Runs | Description |
| --- | --- | --- |
| `npm run start` | `dt-app dev` | Runs the app in development mode with hot reload and auto-opens the browser. |
| `npm run build` | `dt-app build` | Builds the app for production into the `dist` folder. |
| `npm run deploy` | `dt-app deploy` | Builds and deploys the app to the environment in `app.config.json`. |
| `npm run uninstall` | `dt-app uninstall` | Uninstalls the app from the environment in `app.config.json`. |
| `npm run create:function` | `dt-app function create` | Generates a new serverless function in the `api` folder. |
| `npm run create:action` | `dt-app action create` | Generates a new action. |
| `npm run update` | `dt-app update` | Updates `@dynatrace`-scoped packages and applies automatic migrations. |
| `npm run info` | `dt-app info` | Outputs CLI and environment information. |
| `npm run help` | `dt-app help` | Outputs help for the Dynatrace App Toolkit. |
| `npm run lint` | `eslint .` | Lints the project (includes security/SDL rules). |

To learn more about the Dynatrace Platform, see [Dynatrace Developer](https://developer.dynatrace.com/). To learn React, see the [React documentation](https://reactjs.org/).
