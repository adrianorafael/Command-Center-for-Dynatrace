# On-call setup — teams, people, schedules, policies and routing

This guide takes a fresh Command Center for Dynatrace installation to "the right person's phone rings". It assumes the
engine workflow and at least one provider are set up ([outbound notifications](outbound-notifications.md)). The
in-app **Help → Get started** checklist follows the same order and ticks itself off.

All examples use invented names; replace them with your own.

## How the pieces fit

```
alert ──▶ routing rule (first match) ──▶ service ──▶ team ──▶ escalation policy
                                                                  │
                     step 1 after 0 min:  on-call of schedule "Payments primary"
                     step 2 after 10 min: on-call of schedule "Payments secondary"
                     step 3 after 10 min: whole team "Payments"
                     repeat 1×
                                                                  │
                     each person ──▶ notification rules ──▶ contact methods ──▶ workflow ──▶ phone / chat
```

Escalation stops as soon as someone **acknowledges**. Snooze pauses it; unacknowledge, reopen, escalate now and the end
of a snooze start a new cycle.

## 1. Teams

**Teams → New team.**

- **Members** are users of this Dynatrace environment, picked from the IAM directory (type at least 3 characters of the
  name or email). Command Center stores only the user ID; names and emails are read live.
- **Permission to build teams:** Building teams searches tenant users through the IAM API. The user doing it needs the account permission
  **View users and groups** (`account-idm-read`) on one of their groups (Account Management → Group management →
  Permissions, scope **Account**). Without it the API returns `403 "User not authorized"` — even with a token holding
  every scope, because a token never exceeds its owner's permissions. Operators who only work the console don't need it.
- **Roles**: *admin* (manages the team), *responder* (gets paged), *observer* (watches). Roles guide the UI; they are not
  enforced on the server — anyone who can open the app can edit any team.
- **Default escalation policy**: used for alerts routed to the team without a more specific policy.
- **Quiet hours** (optional): time windows per team in which less urgent incidents either wait (**hold**) or are sent only
  to low-urgency channels (**low-urgency**). The engine honours them, but version 2.0.0 has no editor for them: add a
  `quietHours` array to the team in an exported configuration file and import it again (Settings → Export and import).

## 2. Contact methods and notification rules

Open a member → **Contact methods**.

| Channel | Address |
| --- | --- |
| SMS, voice, WhatsApp | Phone number in E.164, e.g. `+15550100000` |
| Telegram | Chat ID (the person starts a chat with your bot first) |
| Slack, Microsoft Teams | Any label, e.g. a handle. The webhook decides the channel; the message is prefixed with the person's name (or this address when no name is known) |
| IFTTT | Any label. It is **not** sent: the applet receives only subject, text and incident link, so one IFTTT applet serves everyone with this method |
| Webhook | Routing key for your endpoint (sent as `to.address`) |

**Notification rules** decide which method is used, for which priority, and after how many minutes:

| Rule | Meaning |
| --- | --- |
| P2 or more urgent → Voice after 0 min | P1 and P2 ring immediately |
| P3 or more urgent → SMS after 0 min | P1–P3 also get an SMS immediately |
| P5 or more urgent → Slack after 5 min | everything goes to Slack after 5 minutes |

An escalation step can **force channels** instead (for example "SMS only" for a step that notifies a whole team).

> Contact methods are stored in App State and are **readable by every user of the app**. Tell your team before they
> enter personal phone numbers.

## 3. Schedules

**On-call → Schedules → New schedule.**

- **Time zone**: an IANA zone such as `Europe/Berlin` or `America/Sao_Paulo`. Handoff times and restrictions are in
  this zone; daylight-saving changes are handled.
- **Layers**: each layer has participants in order and a rotation — **daily**, **weekly**, or **custom** (every N hours),
  an anchor start and a **handoff time** (`HH:mm`).
- **Restrictions** (optional): the layer covers only certain weekdays and hours, e.g. a business-hours layer Monday to
  Friday 09:00–18:00.
- **Precedence**: later layers win over earlier ones where they overlap; **overrides** win over everything.

Typical pattern:

| Layer | Rotation | Restriction |
| --- | --- | --- |
| 1 — Follow the sun base | weekly, Monday 09:00 | none |
| 2 — Business hours | daily, 09:00 | Mon–Fri 09:00–18:00 |

**Overrides** (On-call → Overrides, or from the schedule): one person covers a period, e.g. a swap for Friday night.

The **coverage preview** shows the resulting shifts while you edit; **On-call → Now** shows who is on call per schedule,
until when, who is next, and gaps without coverage.

## 4. Escalation policies

**Escalations → New policy.**

- **Steps** run in order. Step 1's delay counts from the moment the incident triggered; each later delay counts from the
  previous step.
- **Targets** per step: on-call of a **schedule**, a **user**, or a whole **team**.
- **Channels** (optional): force channels for this step instead of each person's notification rules.
- **Repeat**: how many times the whole policy runs again after the last step (0 = once).
- The **simulation** lists who would be notified at which minute.

Delays are accurate to about one minute (the engine runs every minute).

## 5. Services and routing rules

**Services → New service**: name, owning team, escalation policy (optional — otherwise the team's default), default
priority (optional). Events can target a service directly with the property `cc.service` (service ID or name).

**Services → Routing rules**: an ordered list, **first match wins**. Each rule has conditions combined with *all* or
*any*:

| Field | Examples |
| --- | --- |
| `title`, `description` | contains `checkout`, regex `^\[SIM\]` |
| `category` | equals `AVAILABILITY`, `ERROR`, `SLOWDOWN`, `RESOURCE_CONTENTION`, `CUSTOM_ALERT`, `MONITORING_UNAVAILABLE`, `INFO` |
| `severity` | lte `2` |
| `source` | equals `davis-problem`, `davis-event`, `generic-event` |
| `entity.name`, `entity.type`, `entity.id` | equals `SERVICE` |
| `tag` | equals `env:prod` |
| `rootCause.name` | contains `db` |
| `fields.<name>` | `fields.cc.service` in `checkout,payments-api` |

Operators: equals, contains, regex, in (comma-separated), exists, lte, gte, each optionally negated.

A matching rule can set **service**, **team**, **policy**, **priority**, **add tags**, or **suppress** the alert (no
incident is paged). Use **Test a rule** to run the rules against recent alerts before saving.

**Priority** is decided in this order: the rule's priority → the event's `cc.priority` → the service's default priority
→ **Priority mapping** by Davis severity → by category → the fallback priority (Settings → Routing defaults, default
P3).

**Routing defaults** (Settings): the team and policy used when no rule and no service apply. Without them, unmatched
alerts become incidents that page nobody.

## 6. Maintenance and quiet hours

- Davis maintenance windows: incidents under maintenance are shown but not paged, unless **Settings → Event sources →
  Page during maintenance windows** is on.
- Team quiet hours: see step 1 (no editor in 2.0.0).
- A rule with **suppress** drops matching alerts entirely.

## 7. Test it

1. On a test environment, import the alert simulator workflow, or send one event by hand
   ([inbound events](inbound-events.md)).
2. Watch the incident appear on the console within about two minutes, routed to the expected service and team.
3. Do not acknowledge; check **Escalation** and **Notifications** in the incident detail as the steps fire.
4. Acknowledge and confirm that escalation stops.
5. Export the configuration (Settings → Export and import) and keep the file somewhere safe.
