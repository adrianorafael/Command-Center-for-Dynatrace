/**
 * Seam to the synthetic demo fixtures (domain/demo/fixtures.ts). UI-only: never imported by
 * the app functions, so fixtures are not bundled server-side.
 */

import type { WarRoom } from "../domain/warrooms";
import type { DirectoryUser } from "../domain/contracts";
import { buildDemoData, type DemoData } from "../domain/demo/fixtures";
import type { MemorySeed } from "./memoryRepository";
import { KEY } from "./repository";

/** DemoData → App State key/value records (same key schema as production, spec §4). */
export function demoDataToSeed(d: DemoData): MemorySeed[] {
  const seed: MemorySeed[] = [
    { key: KEY.settings, value: { ...d.settings, demoMode: true } },
    { key: KEY.rules, value: d.rules },
    { key: KEY.heartbeat, value: d.heartbeat },
  ];
  for (const t of d.teams) seed.push({ key: KEY.team(t.id), value: t });
  for (const s of d.schedules) seed.push({ key: KEY.schedule(s.id), value: s });
  for (const p of d.policies) seed.push({ key: KEY.policy(p.id), value: p });
  for (const s of d.services) seed.push({ key: KEY.service(s.id), value: s });
  for (const c of d.contacts) seed.push({ key: KEY.contact(c.uid), value: c });
  for (const i of d.incidents) seed.push({ key: KEY.incident(i.id), value: i });
  for (const a of d.actions) {
    seed.push({ key: a.key, value: a.value, lastModifiedBy: a.lastModifiedBy, lastModifiedTime: a.lastModifiedTime });
  }
  for (const n of d.notifications) seed.push({ key: KEY.notification(n.key), value: n });
  for (const r of d.rollups) seed.push({ key: KEY.rollup(r.day), value: r });
  for (const w of demoWarRooms(d)) seed.push({ key: KEY.warRoom(w.id), value: w });
  return seed;
}

/** Demo-mode seed for MemoryRepository (synthetic fixtures only). */
export function demoSeed(now: number): MemorySeed[] {
  return demoDataToSeed(buildDemoData(now));
}

/** Synthetic directory for demo mode. */
export function demoUsers(now: number): DirectoryUser[] {
  return buildDemoData(now).directory;
}

/** Synthetic war rooms for demo mode: one open (two incidents, one notebook), one closed earlier today. */
function demoWarRooms(d: ReturnType<typeof buildDemoData>): WarRoom[] {
  const open = d.incidents.filter((i) => i.status !== "resolved");
  const resolved = d.incidents.filter((i) => i.status === "resolved");
  const now = d.heartbeat?.lastTickAt ?? Date.now();
  const opener = d.directory[0]?.uid ?? "user-0001";
  const rooms: WarRoom[] = [];
  if (open.length >= 2)
    rooms.push({
      schemaVersion: 1,
      id: "wr-demo-checkout",
      title: `Bridge: ${open[0].alert.title}`,
      url: "https://meet.example.com/noc-bridge-checkout",
      incidentIds: [open[0].id, open[1].id],
      notebooks: [{ title: "Investigation notes", url: "https://notebooks.example.com/demo-investigation" }],
      status: "open",
      openedAt: now - 47 * 60_000,
      openedBy: opener,
      rev: 1,
    });
  if (resolved.length >= 1)
    rooms.push({
      schemaVersion: 1,
      id: "wr-demo-dns",
      title: `Bridge: ${resolved[0].alert.title}`,
      url: "https://meet.example.com/noc-bridge-dns",
      incidentIds: [resolved[0].id],
      notebooks: [{ title: "Post-mortem", url: "https://notebooks.example.com/demo-postmortem" }],
      status: "closed",
      openedAt: now - 5 * 3_600_000,
      openedBy: d.directory[1]?.uid ?? opener,
      closedAt: now - 3 * 3_600_000 - 20 * 60_000,
      closedBy: opener,
      summary: "Resolver config rolled back; post-mortem scheduled.",
      rev: 2,
    });
  return rooms;
}
