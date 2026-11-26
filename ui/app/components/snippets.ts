/**
 * Inbound how-to snippets, shared by Integrations → Inbound and the Help page.
 * Placeholders only (R1): YOUR-ENVIRONMENT and <TOKEN> are never real values.
 *
 * Endpoint, scope and body fields follow the architect's research (spec H3):
 * Events API v2 POST /api/v2/events/ingest, token scope events.ingest, body eventType/title/
 * entitySelector/properties/timeout. Property names cc.* are the ones the domain normaliser
 * reads (ui/app/domain/alerts/normalize.ts). Tenant-side behaviour is UNVERIFIED (no tenant).
 */

// eslint-disable-next-line noSecrets/no-secrets -- placeholder URL, not a credential
export const EVENTS_ENDPOINT = "https://YOUR-ENVIRONMENT.live.dynatrace.com/api/v2/events/ingest";
export const TOKEN_SCOPE = "events.ingest";

const BODY = `{
  "eventType": "CUSTOM_ALERT",
  "title": "Checkout latency above 2 s",
  "entitySelector": "type(SERVICE),entityName.equals(checkout)",
  "timeout": 30,
  "properties": {
    "cc.dedup_key": "checkout-latency",
    "cc.priority": "P2",
    "cc.service": "checkout",
    "cc.tags": "team:payments,env:prod",
    "cc.action": "trigger"
  }
}`;

export const SNIPPETS: { id: string; label: string; language?: "bash" | "python" | "javascript"; code: string }[] = [
  {
    id: "curl",
    label: "curl",
    language: "bash",
    code: `curl -X POST "${EVENTS_ENDPOINT}" \\
  -H "Authorization: Api-Token <TOKEN>" \\
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
  -Headers @{ Authorization = "Api-Token <TOKEN>" } \`
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
    headers={"Authorization": "Api-Token <TOKEN>", "Content-Type": "application/json"},
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
    headers: { Authorization: "Api-Token <TOKEN>", "Content-Type": "application/json" },
    body: JSON.stringify(${BODY.replace(/\n/g, "\n    ")}),
  });
  return { status: res.status };
}`,
  },
];

export const RESOLVE_NOTE =
  'To resolve, send the same cc.dedup_key with "cc.action": "resolve". Re-sending a trigger refreshes the event; an incident is never resolved just because events stop.';

export const EVENT_FIELDS: { field: string; usedFor: string }[] = [
  { field: "title", usedFor: "Incident title, routing conditions (title contains / regex)" },
  { field: "eventType / event.category", usedFor: "Default priority by category, routing" },
  { field: "entitySelector", usedFor: "Affected entities shown in the incident" },
  { field: "cc.dedup_key", usedFor: "Deduplication: same key, same incident" },
  { field: "cc.priority", usedFor: "Priority P1–P5 (a matching rule can override it)" },
  { field: "cc.service", usedFor: "Service (by id or name) and therefore team and policy" },
  { field: "cc.tags", usedFor: "Comma-separated tags, usable in routing rules" },
  { field: "cc.action", usedFor: '"trigger" (default) or "resolve"' },
];
