/**
 * War rooms: a meeting link opened from an incident, grouping every incident that shares the same cause,
 * with Dynatrace Notebooks attached for investigation and post-mortem. Open/closed is set by people
 * (the engine never changes it). Stored under `war.<id>`. Pure module: no React, no SDK.
 */

export interface WarRoomLink {
  title: string;
  url: string;
}

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
    if (!isSafeHttpsUrl(n.url)) e.push({ path: `notebooks[${i}].url`, message: "Use an https link" });
  });
  if (w.status === "closed" && (w.closedAt === undefined || w.closedAt < w.openedAt))
    e.push({ path: "closedAt", message: "A closed room needs an end time after its start" });
  return e;
}

/** Duration in ms: until now while open, until closedAt once closed. */
export function warRoomDuration(w: WarRoom, now: number): number {
  return Math.max(0, (w.status === "closed" ? (w.closedAt ?? now) : now) - w.openedAt);
}

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

export function openRoomsForIncident(rooms: readonly WarRoom[], incidentId: string): WarRoom[] {
  return rooms.filter((r) => r.status === "open" && r.incidentIds.includes(incidentId));
}

export function closeWarRoom(w: WarRoom, by: string, now: number, summary?: string): WarRoom {
  return { ...w, status: "closed", closedAt: Math.max(now, w.openedAt), closedBy: by, ...(summary ? { summary } : {}), rev: w.rev + 1 };
}

export function reopenWarRoom(w: WarRoom): WarRoom {
  const { closedAt: _a, closedBy: _b, ...rest } = w;
  void _a;
  void _b;
  return { ...rest, status: "open", rev: w.rev + 1 };
}
