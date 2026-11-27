/**
 * War rooms: a meeting link opened from an incident, grouping every incident that shares the same cause,
 * with Dynatrace Notebooks attached for investigation and post-mortem. Open/closed is set by people
 * (the engine never changes it). Stored under `war.<id>`. Pure module: no React, no SDK.
 */

/** A document attached to a war room. */
export interface WarRoomLink {
  title: string;
  url: string;
  /** Dynatrace document id when the link is a Notebook created or picked in the app. */
  documentId?: string;
}

/** A war room (`war.<id>`); times are epoch ms. */
export interface WarRoom {
  schemaVersion: 1;
  id: string;
  title: string;
  /** Meeting link (Teams, Zoom, Meet, Slack huddle…). Only https links are accepted. */
  url: string;
  /** Incidents handled in this room (several alerts can share one root cause). */
  incidentIds: string[];
  /** Notebooks (or any https document) for investigation notes and the post-mortem. */
  notebooks: WarRoomLink[];
  status: "open" | "closed";
  openedAt: number;
  /** IAM uid of the person who opened the room. */
  openedBy: string;
  closedAt?: number;
  closedBy?: string;
  summary?: string;
  rev: number;
}

/** Longest accepted war room title (characters). */
export const WAR_ROOM_TITLE_MAX = 120;

/** True for absolute https URLs only (no javascript:, data:, http:). */
export function isSafeHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

export interface WarRoomError {
  path: string;
  message: string;
}

export function validateWarRoom(w: WarRoom): WarRoomError[] {
  const e: WarRoomError[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(w.id)) e.push({ path: "id", message: "Invalid id" });
  if (!w.title.trim()) e.push({ path: "title", message: "Give the room a title" });
  else if (w.title.length > WAR_ROOM_TITLE_MAX) e.push({ path: "title", message: `At most ${WAR_ROOM_TITLE_MAX} characters` });
  if (!isSafeHttpsUrl(w.url)) e.push({ path: "url", message: "Use an https meeting link" });
  if (w.incidentIds.length === 0) e.push({ path: "incidentIds", message: "Link at least one incident" });
  w.notebooks.forEach((n, i) => {
    if (!n.title.trim()) e.push({ path: `notebooks[${i}].title`, message: "Give the notebook a name" });
    // Notebooks picked or created in the app carry a document id and a platform link (may be relative).
    if (!n.documentId && !isSafeHttpsUrl(n.url)) e.push({ path: `notebooks[${i}].url`, message: "Use an https link" });
  });
  if (w.status === "closed" && (w.closedAt === undefined || w.closedAt < w.openedAt))
    e.push({ path: "closedAt", message: "A closed room needs an end time after its start" });
  return e;
}

/** Duration in ms: until now while open, until closedAt once closed. */
export function warRoomDuration(w: WarRoom, now: number): number {
  return Math.max(0, (w.status === "closed" ? (w.closedAt ?? now) : now) - w.openedAt);
}

/** Number of rooms with status "open". */
export function openWarRoomCount(rooms: readonly WarRoom[]): number {
  return rooms.filter((r) => r.status === "open").length;
}

/** Rooms of "today" (local day of `now`): opened today, closed today, or still open. */
export function isTodaysRoom(w: WarRoom, now: number): boolean {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const s = start.getTime();
  return w.status === "open" || w.openedAt >= s || (w.closedAt ?? 0) >= s;
}

/** Open rooms that include this incident. */
export function openRoomsForIncident(rooms: readonly WarRoom[], incidentId: string): WarRoom[] {
  return rooms.filter((r) => r.status === "open" && r.incidentIds.includes(incidentId));
}

/** Closed copy of a room (rev + 1). */
export function closeWarRoom(w: WarRoom, by: string, now: number, summary?: string): WarRoom {
  return { ...w, status: "closed", closedAt: Math.max(now, w.openedAt), closedBy: by, ...(summary ? { summary } : {}), rev: w.rev + 1 };
}

/** Reopened copy of a room: closedAt/closedBy removed (summary kept), rev + 1. */
export function reopenWarRoom(w: WarRoom): WarRoom {
  const { closedAt: _a, closedBy: _b, ...rest } = w;
  void _a;
  void _b;
  return { ...rest, status: "open", rev: w.rev + 1 };
}

/** DQL string literal: escape backslashes and double quotes. */
function dqlString(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Content of a Dynatrace Notebook (document type "notebook", content version "7", the format the Notebooks
 * app writes) with a post-mortem template and a DQL section listing the war room's problems.
 * `uuid` is injected so the builder stays pure and testable.
 */
export function buildPostmortemNotebook(
  title: string,
  displayIds: readonly string[],
  uuid: () => string,
): Record<string, unknown> {
  const md = (markdown: string) => ({ id: uuid(), type: "markdown", markdown });
  const ids = displayIds.filter((d) => /^[A-Za-z0-9._-]{1,64}$/.test(d));
  const sections: Record<string, unknown>[] = [
    md(`# Post-mortem: ${title.replace(/[\r\n]+/g, " ")}\n\nWar room opened from Command Center${ids.length ? ` for ${ids.join(", ")}` : ""}.`),
    md("## Summary\n\n_What happened, in two or three sentences._"),
  ];
  if (ids.length > 0) {
    sections.push({
      id: uuid(),
      type: "dql",
      title: "Problems handled in this war room",
      showTitle: true,
      filterSegments: [],
      drilldownPath: [],
      showInput: true,
      height: 300,
      previousFilterSegments: [],
      state: {
        input: {
          timeframe: { from: "now()-7d", to: "now()" },
          value: [
            "fetch dt.davis.problems, from: now()-7d",
            `| filter in(display_id, array(${ids.map(dqlString).join(", ")}))`,
            "| dedup event.id, sort: {timestamp desc}",
            "| fields display_id, event.name, event.status, event.start, event.end",
          ].join("\n"),
        },
      },
    });
  }
  sections.push(
    md("## Timeline\n\n| Time | Event |\n| --- | --- |\n|  |  |"),
    md("## Root cause\n\n"),
    md("## Impact\n\n"),
    md("## Action items\n\n- [ ] "),
  );
  return { version: "7", defaultTimeframe: { from: "now()-24h", to: "now()" }, defaultSegments: [], sections };
}
