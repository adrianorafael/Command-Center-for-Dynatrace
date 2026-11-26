/**
 * Seam to the synthetic demo fixtures (domain/demo/fixtures.ts). UI-only: never imported by
 * the app functions, so fixtures are not bundled server-side.
 */

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
