import type { Incident, IncidentStatus, Priority } from "../../domain/contracts";

export interface ConsoleFilters {
  status: IncidentStatus[];
  priority: Priority[];
  team: string[];
  /** "me", "unassigned", or uids / team ids. */
  assignee: string[];
  service: string[];
  source: string[];
  /** "1".."n" (step number, 1-based) or "exhausted" or "none". */
  escalation: string[];
  q: string;
}

export const DEFAULT_STATUS: IncidentStatus[] = ["triggered", "acknowledged"];

const KEYS = ["status", "priority", "team", "assignee", "service", "source", "escalation"] as const;

export function readFilters(params: URLSearchParams): ConsoleFilters {
  const list = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean);
  const status = params.has("status") ? (list("status") as IncidentStatus[]) : DEFAULT_STATUS;
  return {
    status,
    priority: list("priority") as Priority[],
    team: list("team"),
    assignee: list("assignee"),
    service: list("service"),
    source: list("source"),
    escalation: list("escalation"),
    q: params.get("q") ?? "",
  };
}

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

export function isDefaultFilter(f: ConsoleFilters): boolean {
  return (
    f.status.length === DEFAULT_STATUS.length &&
    DEFAULT_STATUS.every((s) => f.status.includes(s)) &&
    !f.priority.length &&
    !f.team.length &&
    !f.assignee.length &&
    !f.service.length &&
    !f.source.length &&
    !f.escalation.length &&
    !f.q
  );
}

export function escalationKey(inc: Incident): string {
  if (inc.escalation.exhausted) return "exhausted";
  if (inc.escalation.lastStepIndex < 0) return "none";
  return String(inc.escalation.lastStepIndex + 1);
}

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
export const SOURCE_LABEL: Record<string, string> = {
  "davis-problem": "Davis problem",
  "davis-event": "Davis event",
  "generic-event": "Event API",
};
