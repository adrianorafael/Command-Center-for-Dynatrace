/**
 * App function `status` — engine health for scripts and external monitoring (read-only).
 *   POST .../api/status {}  → { heartbeat, lease, openIncidents, triggered }
 * `heartbeat` is the last engine cycle (time, duration, counts, last error, lease skips);
 * `lease` shows whether a cycle currently holds the engine lease.
 */
import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { KEY } from "../ui/app/data/repository";
import { createStore } from "../ui/app/data/store";
import type { EngineLock } from "./lib/lease";

export default async function () {
  const repo = new AppStateRepository();
  const [hb, lock, incidents] = await Promise.all([
    repo.get<Record<string, unknown>>(KEY.heartbeat),
    repo.get<EngineLock>(KEY.lock),
    createStore(repo).listIncidents(),
  ]);
  const now = Date.now();
  return {
    now,
    heartbeat: hb?.value ?? null,
    lease: lock ? { holder: lock.value.holder.slice(0, 12), ageSec: Math.round((now - lock.value.acquiredAt) / 1000) } : null,
    openIncidents: incidents.filter((i) => i.status !== "resolved").length,
    triggered: incidents.filter((i) => i.status === "triggered").length,
  };
}
