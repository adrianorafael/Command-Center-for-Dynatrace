/**
 * Console filter model: read/written as URL search params, applied to incidents without React.
 *
 * Also owns the "today" bound of the Resolved and All views (`createdBound`), so the table and every tab count
 * use the same rule.
 */
import type { Timeframe } from "@dynatrace/strato-components/core";
import type { Incident, IncidentStatus, Priority } from "../../domain/contracts";
import { startOfLocalDay } from "../../domain/time/tz";

/** Every Console filter; an empty list means "no filter" on that field. */
export interface ConsoleFilters {
  status: IncidentStatus[];
  priority: Priority[];
  team: string[];
  /** "me", "unassigned", or uids / team ids. */
  assignee: string[];
  /** Who acknowledged the incident: "me" or uids. URL key `ackby`. */
  ackby: string[];
  service: string[];
  source: string[];
  /** "1".."n" (step number, 1-based) or "exhausted" or "none". */
  escalation: string[];
  q: string;
}

/** Status filter of a fresh Console: open, not snoozed. */
export const DEFAULT_STATUS: IncidentStatus[] = ["triggered", "acknowledged"];

/**
 * The status tabs above the incident table ("Show"). Each tab is a fixed set of statuses; the URL keeps the plain
 * `status=` list, so bookmarks and links from other pages keep working. A list that matches no tab (an old
 * bookmark) shows no tab as selected and still filters.
 */
export const STATUS_VIEWS: { id: string; label: string; status: IncidentStatus[] }[] = [
  { id: "open", label: "Open", status: DEFAULT_STATUS },
  { id: "triggered", label: "Triggered", status: ["triggered"] },
  { id: "acknowledged", label: "Acknowledged", status: ["acknowledged"] },
  { id: "snoozed", label: "Snoozed", status: ["snoozed"] },
  { id: "resolved", label: "Resolved", status: ["resolved"] },
  // An empty status list means "no status filter".
  { id: "all", label: "All", status: [] },
];

/** The tab whose statuses equal the current filter (order-insensitive), if any. */
export function statusViewOf(status: readonly IncidentStatus[]): string | undefined {
  const all = ["triggered", "acknowledged", "snoozed", "resolved"];
  const norm = (l: readonly string[]) => (l.length === 0 || all.every((x) => l.includes(x)) ? "*" : [...new Set(l)].sort().join(","));
  return STATUS_VIEWS.find((v) => norm(v.status) === norm(status))?.id;
}

const KEYS = ["status", "priority", "team", "assignee", "ackby", "service", "source", "escalation"] as const;

/** Filters from URL search params (missing keys → defaults). */
export function readFilters(params: URLSearchParams): ConsoleFilters {
  const list = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean);
  const status = params.has("status") ? (list("status") as IncidentStatus[]) : DEFAULT_STATUS;
  return {
    status,
    priority: list("priority") as Priority[],
    team: list("team"),
    assignee: list("assignee"),
    ackby: list("ackby"),
    service: list("service"),
    source: list("source"),
    escalation: list("escalation"),
    q: params.get("q") ?? "",
  };
}

/** Writes the filters into a copy of the params: empty lists are removed, `status` is always written. */
export function writeFilters(params: URLSearchParams, f: ConsoleFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of KEYS) {
    const v = f[k];
    if (k === "status") {
      next.set("status", v.join(","));
      continue;
    }
    if (v.length) next.set(k, v.join(","));
    else next.delete(k);
  }
  if (f.q) next.set("q", f.q);
  else next.delete("q");
  return next;
}

/** True when nothing differs from the default view. */
export function isDefaultFilter(f: ConsoleFilters): boolean {
  return (
    f.status.length === DEFAULT_STATUS.length &&
    DEFAULT_STATUS.every((s) => f.status.includes(s)) &&
    !f.priority.length &&
    !f.team.length &&
    !f.assignee.length &&
    !f.ackby.length &&
    !f.service.length &&
    !f.source.length &&
    !f.escalation.length &&
    !f.q
  );
}

/** True when the status list can show resolved incidents: the Resolved tab, All (empty or every status). */
export function includesResolved(status: readonly IncidentStatus[]): boolean {
  return status.length === 0 || status.includes("resolved");
}

/**
 * Lower bound on `createdAt` for a status list.
 *
 * A timeframe picked in "Created" (`pickedFrom`) always wins. Without one, lists that can show resolved incidents
 * (Resolved, All, or an old bookmark that includes resolved) are bounded to the start of today in `timeZone`:
 * resolved incidents accumulate until archived, while open ones stay few, so only those views need a bound.
 * `today` tells the page to say so.
 */
export function createdBound(
  status: readonly IncidentStatus[],
  pickedFrom: number | undefined,
  now: number,
  timeZone: string,
): { createdAfter?: number; today: boolean } {
  if (pickedFrom !== undefined) return { createdAfter: pickedFrom, today: false };
  if (includesResolved(status)) return { createdAfter: startOfLocalDay(now, timeZone), today: true };
  return { today: false };
}

/**
 * Row count of every status tab under the other filters, each with its own `createdBound`, so a tab's count is
 * exactly the number of rows the table shows when that tab is selected.
 */
export function statusViewCounts(
  incidents: Incident[],
  f: ConsoleFilters,
  me: string,
  pickedFrom: number | undefined,
  now: number,
  timeZone: string,
): Record<string, number> {
  return Object.fromEntries(
    STATUS_VIEWS.map((v) => {
      const { createdAfter } = createdBound(v.status, pickedFrom, now, timeZone);
      return [v.id, applyFilters(incidents, { ...f, status: v.status }, me, createdAfter).length];
    }),
  );
}

/** Escalation filter value of an incident: "1"…"n", "exhausted" or "none". */
export function escalationKey(inc: Incident): string {
  if (inc.escalation.exhausted) return "exhausted";
  if (inc.escalation.lastStepIndex < 0) return "none";
  return String(inc.escalation.lastStepIndex + 1);
}

/** The incidents that pass every filter. */
export function applyFilters(
  incidents: Incident[],
  f: ConsoleFilters,
  me: string,
  createdAfter?: number,
): Incident[] {
  const q = f.q.trim().toLowerCase();
  return incidents.filter((i) => {
    if (f.status.length && !f.status.includes(i.status)) return false;
    if (f.priority.length && !f.priority.includes(i.priority)) return false;
    if (f.team.length && !f.team.includes(i.teamId ?? "")) return false;
    if (f.service.length && !f.service.includes(i.serviceId ?? "")) return false;
    if (f.source.length && !f.source.includes(i.alert.source)) return false;
    if (f.escalation.length && !f.escalation.includes(escalationKey(i))) return false;
    if (f.assignee.length) {
      const a = i.assignee;
      const ok = f.assignee.some((x) =>
        x === "me" ? a?.type === "user" && a.id === me : x === "unassigned" ? !a : a?.id === x,
      );
      if (!ok) return false;
    }
    // acknowledgedBy stays set after resolve (cleared only by unack/reopen), so resolved incidents keep their acker.
    if (f.ackby.length) {
      const by = i.acknowledgedBy;
      if (!by || !f.ackby.some((x) => (x === "me" ? by === me : by === x))) return false;
    }
    if (createdAfter !== undefined && i.createdAt < createdAfter) return false;
    if (q) {
      const hay = [
        i.id,
        i.alert.displayId ?? "",
        i.alert.title,
        ...i.alert.entities.map((e) => `${e.name ?? ""} ${e.id}`),
        ...i.tags,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export const PRIORITY_RANK: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
/** Display name of each alert source. */
export const SOURCE_LABEL: Record<string, string> = {
  "davis-problem": "Davis problem",
  "davis-event": "Davis event",
  "generic-event": "Event API",
};

/**
 * Timeframe for a `created=<hours>h` URL value (1–720 h), relative to now; null for anything else. Only read when the
 * page opens: after that the Created selector owns the timeframe.
 */
export function timeframeFromParam(v: string | null, now = Date.now()): Timeframe | null {
  const m = /^(\d{1,3})h$/.exec(v ?? "");
  const hours = m ? Number(m[1]) : 0;
  if (hours < 1 || hours > 720) return null;
  return {
    from: { absoluteDate: new Date(now - hours * 3_600_000).toISOString(), value: `now()-${hours}h`, type: "expression" },
    to: { absoluteDate: new Date(now).toISOString(), value: "now()", type: "expression" },
  };
}
