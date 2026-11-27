/**
 * Inbound how-to snippets, shared by Integrations → Inbound and the Help page.
 * Placeholders only (R1): YOUR-ENVIRONMENT and <TOKEN> are never real values.
 *
 * Default path (verified live on a tenant by the lead): Events API v2 through the platform
 * endpoint with a platform token creates a Davis event, which opens a Davis problem. The cc.*
 * properties appear as event fields and are copied to the problem, where routing reads them
 * (ui/app/domain/alerts/normalize.ts). cc.dedup_key / cc.action only matter for the optional
 * "Davis events" and "generic events" sources (problems dedupe and close in Davis itself).
 */

// Documented in docs.dynatrace.com → OpenPipeline → API ingestion reference (Davis events: platform token with
// openpipeline:events.davis:ingest). Verified on a trial tenant: HTTP 201, Davis opened a problem.
// eslint-disable-next-line noSecrets/no-secrets -- placeholder URL, not a credential
export const EVENTS_ENDPOINT = "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest";
/** Optional generic-events source: OpenPipeline generic event ingest (scope openpipeline:events:ingest). */
// eslint-disable-next-line noSecrets/no-secrets -- placeholder URL, not a credential
export const GENERIC_EVENTS_ENDPOINT = "https://YOUR-ENVIRONMENT.live.dynatrace.com/platform/ingest/v1/events";
export const GENERIC_TOKEN_SCOPE = "openpipeline:events:ingest";
/** Platform token permission for Davis event ingest (spec H3). */
export const TOKEN_SCOPE = "openpipeline:events.davis:ingest";

const BODY = `{
  "eventType": "CUSTOM_ALERT",
  "title": "Checkout latency above 2 s",
  "entitySelector": "type(SERVICE),entityName.equals(checkout)",
  "timeout": 30,
  "properties": {
    "cc.priority": "P2",
    "cc.service": "checkout",
    "cc.tags": "team:payments,env:prod"
  }
}`;

export const SNIPPETS: { id: string; label: string; language?: "bash" | "python" | "javascript"; code: string }[] = [
  {
    id: "curl",
    label: "curl",
    language: "bash",
    code: `curl -X POST "${EVENTS_ENDPOINT}" \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '${BODY.replace(/\n/g, "\n  ")}'`,
  },
  {
    id: "powershell",
    label: "PowerShell",
    code: `$body = @'
${BODY}
'@
Invoke-RestMethod -Method Post -Uri "${EVENTS_ENDPOINT}" \`
  -Headers @{ Authorization = "Bearer <TOKEN>" } \`
  -ContentType "application/json" -Body $body`,
  },
  {
    id: "python",
    label: "Python",
    language: "python",
    code: `import json, urllib.request

event = ${BODY.replace(/\n/g, "\n")}
req = urllib.request.Request(
    "${EVENTS_ENDPOINT}",
    data=json.dumps(event).encode(),
    headers={"Authorization": "Bearer <TOKEN>", "Content-Type": "application/json"},
    method="POST",
)
print(urllib.request.urlopen(req, timeout=10).status)`,
  },
  {
    id: "workflow",
    label: "Dynatrace Workflow (JavaScript task)",
    language: "javascript",
    code: `// Run JavaScript task inside a Dynatrace workflow. Relative platform URLs get the
// workflow actor's authentication; the Events API needs its own token (<TOKEN>).
export default async function () {
  const res = await fetch("${EVENTS_ENDPOINT}", {
    method: "POST",
    headers: { Authorization: "Bearer <TOKEN>", "Content-Type": "application/json" },
    body: JSON.stringify(${BODY.replace(/\n/g, "\n    ")}),
  });
  return { status: res.status };
}`,
  },
];

export const RESOLVE_NOTE =
  "The event opens a Davis problem; the incident resolves when Davis closes the problem (after the event timeout, or when you close it). Re-sending the same event refreshes it.";

/** Only for the optional "Davis events" / "generic events" sources (Settings → Event sources). */
export const EVENT_SOURCE_NOTE =
  'If you turn on the Davis events or generic events source instead, add "cc.dedup_key" (same key, same incident) and send "cc.action": "resolve" with that key to resolve. These two properties have no effect on Davis problems.';

export const EVENT_FIELDS: { field: string; usedFor: string }[] = [
  { field: "title", usedFor: "Incident title, routing conditions (title contains / regex)" },
  { field: "eventType / event.category", usedFor: "Default priority by category, routing" },
  { field: "entitySelector", usedFor: "Affected entities shown in the incident" },
  { field: "cc.dedup_key", usedFor: "Davis events / generic events sources only: same key, same incident" },
  { field: "cc.priority", usedFor: "Priority P1–P5 (a matching rule can override it)" },
  { field: "cc.service", usedFor: "Service (by id or name) and therefore team and policy" },
  { field: "cc.tags", usedFor: "Comma-separated tags, usable in routing rules" },
  { field: "cc.action", usedFor: 'Davis events / generic events sources only: "trigger" (default) or "resolve"' },
];
