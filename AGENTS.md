# AI Coding Agent Instructions — Command Center for Dynatrace

> **If a `CLAUDE.md` sits next to this file, keep it.** The Dynatrace App Toolkit (≥ 1.10) can write one; it is
> Dynatrace's own guidance and routes to the `dt-app-mcp` server. This file is **additive**: it records what Dynatrace
> cannot know — this app's identity, architecture, scopes, traps and version discipline. Do not copy content between
> the two; a copy is a second source of truth that drifts.

## Follow the development pattern

This project is built under **[Development Pattern for Dynatrace](https://github.com/adrianorafael/development-pattern-for-Dynatrace)**.
Load that skill before writing, reviewing, running, deploying or publishing any code here.

Its twelve non-negotiable rules apply to every change in this repository, including "tiny" ones:

| # | Rule |
| --- | --- |
| R1 | Never publish a secret — no tokens, `.env`, tenant IDs, tenant URLs, emails, phone numbers or real names. Use `YOUR-ENVIRONMENT`, `YOUR-TOKEN`, `HOST-0000000000000001`, `user-0001`, `+15550100000`. |
| R2 | Never invent an API — verify every component, prop, SDK method, DQL function and workflow action against `node_modules/**/*.d.ts`, `dt-app-mcp`, or developer.dynatrace.com, and cite it. |
| R3 | Strato only — `@dynatrace/strato-components/<subpath>`, `@dynatrace/strato-icons`, `@dynatrace/strato-design-tokens`. No MUI, Tailwind, Recharts, Chart.js or D3. |
| R4 | Research the docs, depth-first, before writing a spec. |
| R5 | Spec before code, with an approval gate — `specs/command-center-v2.md`. |
| R6 | Every DQL is executed against a live tenant before it ships; otherwise it is labelled ⚠️ UNVALIDATED. |
| R7 | Every visualization is fed a verified data shape. |
| R8 | No monotonous screens — chart type follows the data's shape and question. |
| R9 | Review AI-written code like hostile code (security + quality checklist before every push). |
| R10 | No AI co-authorship — no co-author trailers, "generated with" footers or AI attribution in commits, PRs, README, page, changelog or code comments. |
| R11 | Naming convention: **Command Center for Dynatrace** (repository, README H1, page title). In-product name: `Command Center`. |
| R12 | Every publication bumps `app.version` (SemVer); every push that changes behaviour, setup or cost updates the README **and** `docs/index.html` (and `CHANGELOG.md`) in the same commit. |

## Project specifics

- **App id:** `my.command.center` (keep the `my.` prefix — unsigned app). **Name:** `Command Center`.
- **Version:** `app.config.json` → `app.version` is the single source of truth (currently 2.0.0); every release is
  recorded in `CHANGELOG.md`. Versions must increase monotonically per environment or `dt-app deploy` is rejected.
- **Scopes (8):** `storage:buckets:read`, `storage:events:read`, `state:app-states:read|write|delete`,
  `iam:users:read`, `automation:workflows:read`, `automation:workflows:run`. Each carries a comment in
  `app.config.json`. Adding one forces every user to re-consent (MAJOR).
- **Cannot be requested:** `automation:workflows:write` (only Dynatrace-provided apps may hold it). The engine workflow
  is imported by a person or installed with `scripts/install-workflow.mjs`.
- **Grail tables:** `dt.davis.problems`, `dt.davis.events`, `events`. Queries live only in `ui/app/data/dql.ts`.
- **Persistence:** App State only, per-entity keys (`ui/app/data/repository.ts` → `KEY` / `PREFIX`). Limits: 10 MB per
  value, 50 MB per app, keys ≤ 200 chars `[a-z0-9._-]`, TTL 1 min … 90 days. No optimistic locking: last write wins.
- **Cost driver:** the engine workflow — 1,440 runs/day, 1–8 Grail queries per run. The UI runs no DQL; it polls App
  State (default every 30 s).

## Architecture and layer boundaries

```
ui/app/domain/        pure TypeScript core — routing, schedules, escalation, action folding, notification
                      planning, engine tick, reports, validation, demo fixtures. NO React, NO @dynatrace-sdk imports;
                      time is passed in as `now: number`. contracts.ts is FROZEN (schemaVersion 1): change only with
                      a schemaVersion bump and a migration.
ui/app/data/          platform adapters behind the Repository port: App State adapter, in-memory adapter (demo/tests),
                      DQL builders, Grail runner, IAM directory, workflow definition + task scripts + status.
api/                  app functions engine-tick and delivery-report; api/lib/ holds the engine run, sources, lease.
                      They import the domain and data layers from ui/app (shared code, one build).
ui/app/pages|components|hooks/   Strato UI. Consumes contracts.ts, the Repository/store and pure domain functions.
workflow-templates/   GENERATED engine workflow JSON (node scripts/gen-workflow-templates.mjs) + trial-only simulator.
scripts/              install-workflow, gen-workflow-templates, preview-server, screenshot.
docs/                 project page (index.html, icon.svg, screenshots/) and guides/.
specs/, design/       specification and screen design. Update the spec when behaviour changes.
```

Rules that keep the layers honest:

- Domain code stays pure and deterministic; every behaviour change there gets a unit test.
- The workflow task scripts are template strings in `ui/app/data/workflows/scripts/`. After changing them, run
  `node scripts/gen-workflow-templates.mjs` and bump `ENGINE_DEFINITION_VERSION` in `definition.ts` so installed
  workflows show "Update available". A unit test fails if the checked-in template drifts.
- Only verified workflow fields are used (no `withItems`, no http-function inputs, no custom condition expressions).
  Senders never retry — the ledger retries with a new attempt number.
- Secrets never enter App State, the bundle, task results or logs: only Credential Vault entry IDs.
- Any value interpolated into DQL is allow-listed or clamped in `dql.ts`.

## Strato 3.x — imports

`@dynatrace/strato-components-preview` is **removed** from this project (deprecated upstream). Import from subpaths of
`@dynatrace/strato-components`, never the package root (ESLint `no-restricted-imports` enforces it):

```ts
import { Flex, Grid, PageLayout, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { DataTable, SimpleTable } from "@dynatrace/strato-components/tables";
import { TimeseriesChart, DonutChart } from "@dynatrace/strato-components/charts";
import { Select, TextInput, Switch } from "@dynatrace/strato-components/forms";
import { Sheet, Modal, Tooltip } from "@dynatrace/strato-components/overlays";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { showToast } from "@dynatrace/strato-components/notifications";
import { TimeframeSelector } from "@dynatrace/strato-components/filters";
import { MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { SettingIcon } from "@dynatrace/strato-icons";
```

Subpaths in use: `layouts`, `content`, `typography`, `buttons`, `forms`, `tables`, `overlays`, `navigation`,
`notifications`, `charts`, `filters`, `core`. Component APIs: `node_modules/@dynatrace/strato-components/<subpath>/**/*.d.ts`
— the `.d.ts` is the tiebreaker when it disagrees with documentation. Colours, spacing and borders come from design
tokens, never hex values (the hex palette in `docs/index.html` is for the marketing page only).

## MCP servers — two of them, different jobs

| Server | Job | Without it |
| --- | --- | --- |
| `dt-app-mcp` | Strato components (`list_strato_components`, `get_strato_component`, `get_strato_usecases`), SDK docs (`list_sdks`, `get_sdk`), DQL knowledge base (`get_dql_knowledgebase`), experience standards (`get_experience_standard`). No credentials. | Component lookups fall back to grepping `node_modules`. |
| `dynatrace-mcp` | Executes DQL against a tenant. | **R6 cannot be satisfied** — new queries ship ⚠️ UNVALIDATED. |

```bash
claude mcp add dt-app-mcp -- npx -y dt-app-mcp
/mcp                 # confirm the servers are listed and connected
```

**Knowledge is not execution.** A query written with help from `get_dql_knowledgebase` has still never run.
Current status: Q1, Q2 and Q4 executed on a tenant; Q3 (generic events) parses but is ⚠️ not validated with data.

## Dynatrace knowledge: reference, never vendor

Dynatrace's own agent skills (https://github.com/Dynatrace/dynatrace-for-ai) are the authority for DQL and Grail
semantics. Fetch the file you need when you need it; never commit a copy into this repository.

## Commands

```bash
npm install
npm test                 # vitest (domain, data adapters, workflow definition/scripts, engine tick)
npm run typecheck        # tsc for ui/ and api/
npm run lint             # ESLint incl. security, no-unsanitized and no-secrets rules
npm run build            # dt-app build (offline)
npm run check            # all of the above

node scripts/gen-workflow-templates.mjs [--check]      # regenerate / verify the engine workflow template
npx dt-app build && node scripts/preview-server.mjs    # offline preview at http://127.0.0.1:4173/ui/ (demo mode)
node scripts/screenshot.mjs docs/screenshots           # needs playwright + a Chrome binary

npx dt-app auth          # authenticate against the environment in app.config.json
npx dt-app dev           # open the printed link, NOT localhost:3000
npx dt-app deploy        # ONLY with explicit approval; name the target tenant first; bump app.version first
```

Before every commit: `bash <skill>/assets/scripts/scan-secrets.sh` on the working tree and on `git diff --cached`.

## Traps already hit in this repository

- `@dynatrace/strato-components-preview` is deprecated — import from `@dynatrace/strato-components/<subpath>`.
- Third-party apps cannot hold `automation:workflows:write`; a deploy that declares it fails. The app reads and runs the
  workflow only.
- The workflow actor needs Workflows → Settings → **Authorization settings** enabled, or `tick` fails and nobody is paged.
- Credential Vault entries used by workflow tasks need **Allow access without app context**.
- Problem records do **not** carry the Events API `properties`; they are on the linked `dt.davis.events` records
  (`dt.davis.event_ids`). The engine copies `cc.*` from the events onto the problem (Q4 + `api/lib/sources.ts`).
  `cc.action` and `cc.dedup_key` are deliberately not copied.
- Davis tables hold one record per status change: dedup by `event.id` keeping the newest record **before** filtering
  on status.
- Grail timestamps arrive as ISO strings with nanoseconds; `event.end` is null while ACTIVE; `event.severity` can be null.
- Never resolve an incident because it vanished from a result set — only on an explicit CLOSED/resolve record.
- A private workflow is visible to its owner only, so on-demand runs (escalate now, tests) are owner-only.
- `TimeseriesChart` needs `Date` objects, not ISO strings.
- Fixtures must be synthetic and pass the secret scanner (no emails, no real-looking entity IDs or tenant IDs).
- No `.env` exists in this repository; scripts read `DT_ENVIRONMENT` / `DT_PLATFORM_TOKEN` from the shell only.
