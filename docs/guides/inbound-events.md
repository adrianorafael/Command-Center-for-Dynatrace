# Inbound events — getting alerts into Command Center

Command Center for Dynatrace reads alerts **only from Dynatrace**: Davis problems, Davis events and generic events in
Grail. External tools never call the app; they send events to Dynatrace, and the engine picks them up on its next
run (every minute).

> All URLs use the placeholder `YOUR-ENVIRONMENT`. Replace it with your environment ID. Never commit a token.

## The three paths

| Path | Source setting | Query | Status | When to use |
| --- | --- | --- | --- | --- |
| **1. Event → Davis problem** (default) | Davis problems — always on | Q1 + Q4 | ✅ verified on a tenant | Almost always. Davis correlates, de-duplicates and closes the problem for you. |
| **2. Davis event without a problem** | Settings → Event sources → Davis events (off by default) | Q2 | ✅ query verified | Event types that do not open a problem, or when you want `cc.dedup_key` / `cc.action` control. |
| **3. Generic event convention** | Settings → Event sources → Generic events (off by default) | Q3 | ⚠️ not validated with data | Tools that already send OpenPipeline generic events. |

## Path 1 — send an event, Davis opens a problem

### Endpoint and token

| Endpoint | Token | Header |
| --- | --- | --- |
| `https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest` | Access token with scope `events.ingest` | `Authorization: Api-Token YOUR-TOKEN` |
| `https://YOUR-ENVIRONMENT.apps.dynatrace.com/platform/classic/environment-api/v2/events/ingest` | Platform token with the events-ingest permission | `Authorization: Bearer YOUR-TOKEN` |
| `/platform/classic/environment-api/v2/events/ingest` (relative, inside a Dynatrace workflow task) | none — the workflow actor's identity is used | — |

Both absolute endpoints were used successfully. For the platform token, the Dynatrace documentation names
`openpipeline:events.davis:ingest` (legacy `storage:events:write`); check the token wizard in your environment.

### Body

```json
{
  "eventType": "CUSTOM_ALERT",
  "title": "Checkout latency above 2 s",
  "timeout": 30,
  "entitySelector": "type(SERVICE),entityName.equals(checkout)",
  "properties": {
    "cc.service": "checkout",
    "cc.priority": "P2",
    "cc.tags": "team:payments,env:prod",
    "cc.runbook": "checkout-latency"
  }
}
```

- `eventType`: `CUSTOM_ALERT`, `ERROR_EVENT`, `AVAILABILITY_EVENT`, `PERFORMANCE_EVENT` or
  `RESOURCE_CONTENTION_EVENT` — each opened a Davis problem in testing. Other types (for example `CUSTOM_INFO`) may not.
- `timeout`: minutes the event stays active (documented default 15, maximum 360). Send the **same payload again** to
  keep it open; stop sending and it closes when the timeout expires.
- `entitySelector` (optional): attaches the event to monitored entities, shown under **Entities** in the incident.
- `properties`: up to 100 keys. They land as **top-level fields** on the record in `dt.davis.events`.

### What happens next

1. The event lands in `dt.davis.events`. Davis opens a problem in `dt.davis.problems` whose `dt.davis.event_ids`
   contains the event's `event.id`.
2. On the next engine run, Q1 fetches the problem and Q4 fetches the `cc.*` properties of its events. The engine copies
   them onto the problem (fields already on the problem win; with several events, the first wins).
3. Routing runs: rules first, then `cc.service`, then the defaults. The incident is created with priority, service,
   team and escalation policy.
4. When Davis closes the problem, the incident resolves on the next run (`resolvedBy: source`). If Davis reopens it,
   the incident triggers again with a new escalation cycle.

### Properties that matter on this path

| Property | Effect |
| --- | --- |
| `cc.service` | Service by **ID or name** → team and escalation policy (unless a rule sets a service) |
| `cc.priority` | `P1`–`P5`. Precedence: routing rule priority → `cc.priority` → service default → severity map → category map → fallback |
| `cc.tags` | Comma-separated tags, merged with entity tags; match with the `tag` condition |
| `cc.<anything>` | Available to routing rules as `fields.cc.<anything>` |
| `cc.dedup_key`, `cc.action` | **Ignored on problems** — the problem is the incident and Davis decides when it closes |

## Path 2 — Davis events without a problem

Enable **Settings → Event sources → Davis events** and list the event types to read (default `CUSTOM_ALERT`,
`ERROR_EVENT`). Q2 then reads `dt.davis.events` for the last 24 hours.

- Events that belong to a fetched problem are **dropped** (their `cc.*` fields are merged into the problem), so the
  same alert never becomes two incidents. Davis "frequent events" are dropped too.
- For the remaining events, `cc.dedup_key` becomes the incident identity (re-sent events collapse into one incident)
  and `cc.action: "resolve"` resolves it, in addition to the event closing.
- Be careful with `cc.action: "resolve"` on a problem-opening type: the resolve event is itself a new event and can
  open a new problem. Prefer letting the event time out.

## Path 3 — generic events (⚠️ not validated with data)

Enable **Settings → Event sources → Generic events**. The engine reads the `events` table with this convention:

| Field | Value |
| --- | --- |
| `event.type` | `command_center.alert` (configurable in Settings) |
| `event.name` | title |
| `event.description` | description (optional) |
| `cc.dedup_key` | **required** — one incident per key |
| `cc.action` | `trigger` (default) or `resolve` |
| `cc.priority`, `cc.service`, `cc.tags` | as above |

Q3 summarises all records of the last 24 hours per `cc.dedup_key`; the **last** action decides the status, and a
trigger after the first one counts as a reopen. Generic events are sent to the OpenPipeline ingest API (documented as
`POST https://YOUR-ENVIRONMENT.apps.dynatrace.com/platform/ingest/v1/events` with the `openpipeline:events:ingest`
permission). The query parses and runs, but no data was ingested through this path during testing, and whether the
`cc.*` fields arrive unchanged depends on your OpenPipeline configuration. Test it before relying on it.

## Examples

### curl

```bash
curl -X POST "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest" \
  -H "Authorization: Api-Token YOUR-TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"ERROR_EVENT","title":"Login service returns HTTP 5xx","timeout":30,
       "properties":{"cc.service":"login","cc.priority":"P2","cc.tags":"env:prod"}}'
```

### From a Dynatrace workflow (Run JavaScript task)

```js
export default async function () {
  const res = await fetch("/platform/classic/environment-api/v2/events/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType: "CUSTOM_ALERT",
      title: "Nightly backup exceeded window",
      timeout: 60,
      properties: { "cc.service": "backup", "cc.priority": "P4" },
    }),
  });
  return { status: res.status };
}
```

This is how `workflow-templates/command-center-alert-simulator.workflow.json` works (trial/test environments only:
it creates `[SIM] …` alerts every 7 minutes with `cc.source: alert-simulator`).

The **Integrations → Inbound** page has the same snippets for curl, PowerShell, Python and workflows.

## Checking that an event arrived

Run in a Notebook:

```
fetch dt.davis.events, from: now() - 1h
| filter isNotNull(cc.service)
| fieldsKeep timestamp, event.id, event.type, event.name, event.status, "cc.*"
| sort timestamp desc
```

```
fetch dt.davis.problems, from: now() - 1h
| filter not(dt.davis.is_duplicate)
| fields timestamp, display_id, event.name, event.status, dt.davis.event_ids
| sort timestamp desc
```

If the event is there but no problem was opened, use path 2. If the problem is there but no incident appears after two
minutes, check the engine heartbeat (console banner) and **Integrations → Workflows**.
