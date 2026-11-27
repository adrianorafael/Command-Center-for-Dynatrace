/**
 * Engine tick orchestration (I/O around the pure domain `tick`). Dependencies are injected so
 * the whole flow runs in tests against MemoryRepository and a mocked Grail.
 *
 * Write order matters (no transactions in App State):
 *   incidents → ledger records → delete folded actions → rollup → archives (+ delete their
 *   inc.* keys) → storage estimate → release lease, then heartbeat (both in `finally`).
 * Deleting actions only after the incident write succeeded means an ack is never lost; a crash
 * in between just folds the same (idempotent) actions again on the next tick.
 */

import {
  CHANNELS,
  SCHEMA_VERSION,
  type Channel,
  type DailyRollup,
  type EngineCounts,
  type EngineHeartbeat,
  type EngineTickRequest,
  type EngineTickResponse,
  type NotificationRecord,
  type NotificationRequest,
  type ProviderConfig,
  type Settings,
} from "../../ui/app/domain/contracts";
import { KEY, PREFIX, type Repository, type Stored } from "../../ui/app/data/repository";
import { createStore } from "../../ui/app/data/store";
import { describeError, type QueryRunner } from "../../ui/app/data/grail";
import { MIN_LOCK_TTL_SEC } from "../../ui/app/data/domainPort";
import { withAttempt } from "../../ui/app/domain/keys";
import { normalizeRecords } from "../../ui/app/domain/alerts/normalize";
import { archiveResolvedBound, emptyBatches, tick } from "../../ui/app/domain/engine/tick";
import { acquireLease, leaseLost, releaseLease } from "./lease";
import { fetchSources } from "./sources";
import {
  APP_STATE_LIMIT_BYTES,
  SHED_THRESHOLD_BYTES,
  addRollup,
  foldRollupDeltas,
  isFinalRecord,
  shedArchives,
  slimRecord,
  usage,
  type PrefixUsage,
  type StorageEstimate,
} from "./storage";

export { addRollup };

/** App State TTL of a ledger record (`ntf.*`): 14 days. */
export const NOTIFICATION_TTL_MS = 14 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

export interface EngineDeps {
  repo: Repository;
  runQuery: QueryRunner;
  now?: () => number;
  /** Lease holder id (random per invocation). */
  holder?: string;
  /** Absolute base URL of the app UI for message links, e.g. https://<env>.apps.dynatrace.com/ui/apps/<appId> */
  appBaseUrl?: string;
}

/** Non-secret provider view handed to the senders through the tick result (no secret, only the vault entry id). */
export interface ProviderView {
  id: string;
  channel: Channel;
  kind: ProviderConfig["kind"];
  enabled: boolean;
  credentialVaultId?: string;
  params: Record<string, string>;
}

/** Tick result plus the provider views the senders need, so the send step does not re-read settings. */
export type EngineTickResult = EngineTickResponse & { providers: ProviderView[] };

export function zeroCounts(): EngineCounts {
  return {
    alertsFetched: 0,
    incidentsCreated: 0,
    incidentsResolved: 0,
    actionsFolded: 0,
    notificationsPlanned: 0,
    notificationsRetried: 0,
  };
}

/** Copies each configured provider into a ProviderView (params cloned, so senders cannot mutate settings). */
export function providerViews(settings: Settings): ProviderView[] {
  return settings.providers.map((p) => ({
    id: p.id,
    channel: p.channel,
    kind: p.kind,
    enabled: p.enabled,
    ...(p.credentialVaultId ? { credentialVaultId: p.credentialVaultId } : {}),
    params: { ...p.params },
  }));
}

function randomId(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

/** Run `fn` over `items` with at most `limit` in flight; failures are collected, not thrown. */
export async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  onError: (item: T, e: unknown) => void,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (e) {
        onError(item, e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** reason 'test': one synthetic notification through the chosen provider; no state is touched. */
export function buildTestRequest(
  settings: Settings,
  test: NonNullable<EngineTickRequest["testRequest"]>,
  now: number,
  appBaseUrl?: string,
): { request?: NotificationRequest; error?: string } {
  const provider = settings.providers.find((p) => p.id === test.providerId);
  if (!provider) return { error: `Test notification: provider ${test.providerId} is not configured` };
  if (provider.channel !== test.channel) {
    return { error: `Test notification: provider ${provider.id} serves ${provider.channel}, not ${test.channel}` };
  }
  const address = String(test.address ?? "").trim().slice(0, 300);
  if (!address) return { error: "Test notification: address is empty" };
  const base = (appBaseUrl ?? "/ui/apps/my.command.center").replace(/\/+$/, "");
  return {
    request: {
      key: `test.${now}.${randomId()}`,
      incidentId: "test",
      cycle: 0,
      step: 0,
      attempt: 1,
      channel: test.channel,
      providerId: provider.id,
      to: { uid: "test", address },
      subject: "Command Center test notification",
      text: `Command Center test notification via ${provider.name}. If you can read this, the ${test.channel} channel works.`,
      speech: "This is a Command Center test call. The voice channel works.",
      priority: "P5",
      incidentUrl: `${base}/integrations`,
    },
  };
}

/** Heartbeat plus engine extras (contract EngineHeartbeat + optional fields the UI may show). */
export type EngineHeartbeatWithStorage = EngineHeartbeat & {
  storage?: StorageEstimate;
  /** Runs skipped because another tick held the lease (cumulative). */
  skippedLocked?: number;
  lastSkippedAt?: number;
  /** A lease release that could not be verified (the next tick overwrites it once expired). */
  releaseFailedAt?: number;
};

/** Writes the heartbeat, carrying the skip counters of the stored one (re-read just before writing). */
async function writeHeartbeat(repo: Repository, hb: EngineHeartbeatWithStorage): Promise<void> {
  const cur = (await repo.get<EngineHeartbeatWithStorage>(KEY.heartbeat).catch(() => undefined))?.value;
  const carried = {
    ...(cur?.skippedLocked ? { skippedLocked: cur.skippedLocked } : {}),
    ...(cur?.lastSkippedAt ? { lastSkippedAt: cur.lastSkippedAt } : {}),
  };
  await repo.put(KEY.heartbeat, { ...carried, ...hb }).catch(() => undefined);
}

/** A skipped run only bumps the counters; the running tick's heartbeat stays untouched. */
async function recordLockedSkip(repo: Repository, now: number): Promise<void> {
  const cur = (await repo.get<EngineHeartbeatWithStorage>(KEY.heartbeat).catch(() => undefined))?.value;
  const base: EngineHeartbeatWithStorage = cur ?? {
    schemaVersion: SCHEMA_VERSION,
    lastTickAt: 0,
    durationMs: 0,
    counts: zeroCounts(),
  };
  await repo
    .put(KEY.heartbeat, { ...base, skippedLocked: (base.skippedLocked ?? 0) + 1, lastSkippedAt: now })
    .catch(() => undefined);
}

/** Effective lease TTL: above the longest tick, but short enough that a crashed tick blocks ≤ 2 runs. */
export function effectiveLockTtlSec(configured: number): number {
  return Math.min(MAX_LOCK_TTL_SEC, Math.max(MIN_LOCK_TTL_SEC, Number.isFinite(configured) ? configured : MIN_LOCK_TTL_SEC));
}
/** Upper clamp for `settings.engine.lockTtlSec`. */
export const MAX_LOCK_TTL_SEC = 180;

/**
 * One tick under the engine lease: load state and sources, run the pure `tick`, write its output in the order given
 * in the header. Returns the batches whose ledger records were written; sending is the caller's job (cycle.ts).
 * reason "test" builds one test notification without the lease and without touching state.
 */
export async function runEngineTick(payload: EngineTickRequest, deps: EngineDeps): Promise<EngineTickResult> {
  const now = (deps.now ?? Date.now)();
  const started = Date.now();
  const repo = deps.repo;
  const store = createStore(repo);
  const errors: string[] = [];
  let counts = zeroCounts();
  let providers: ProviderView[] = [];
  const fail = (extra: Partial<EngineTickResult> = {}): EngineTickResult => ({
    ok: false,
    tickAt: now,
    batches: emptyBatches(),
    counts,
    errors,
    providers,
    ...extra,
  });

  let settings: Settings;
  try {
    settings = await store.getSettings();
  } catch (e) {
    errors.push(`settings: ${describeError(e)}`);
    await writeHeartbeat(repo, { schemaVersion: SCHEMA_VERSION, lastTickAt: now, durationMs: Date.now() - started, counts, lastError: errors[0] });
    return fail();
  }
  providers = providerViews(settings);

  if (payload?.reason === "test") {
    if (!payload.testRequest) return fail({ errors: ["Test notification: testRequest is missing"] });
    const t = buildTestRequest(settings, payload.testRequest, now, deps.appBaseUrl);
    if (!t.request) return fail({ errors: [t.error ?? "Test notification failed"] });
    const batches = emptyBatches();
    batches[t.request.channel].push(t.request);
    return { ok: true, tickAt: now, batches, counts, errors, providers };
  }

  if (!settings.engine.enabled) return { ...fail(), ok: true, skipped: "disabled" };

  const holder = deps.holder ?? `tick-${now}-${randomId()}`;
  const lockTtlSec = effectiveLockTtlSec(settings.engine.lockTtlSec);
  let leased = false;
  let skipped = false;
  let previous: EngineHeartbeatWithStorage | undefined;
  let storage: StorageEstimate | undefined;
  try {
    leased = await acquireLease(repo, holder, now, lockTtlSec);
    if (!leased) {
      skipped = true;
      await recordLockedSkip(repo, now);
      return { ...fail(), ok: true, skipped: "locked" };
    }
    previous = (await repo.get<EngineHeartbeatWithStorage>(KEY.heartbeat))?.value;

    const stillHolder = async () => !(await leaseLost(repo, holder, now));

    const [teams, schedules, policies, services, rules, contacts, incidents, pendingActions, ledger, archiveRows, sources] =
      await Promise.all([
        store.listTeams(),
        store.listSchedules(),
        store.listPolicies(),
        store.listServices(),
        store.getRules(),
        store.listContacts(),
        store.listIncidents(),
        store.listActions(),
        store.listNotifications(),
        repo.list<unknown>(PREFIX.archive),
        fetchSources(settings, deps.runQuery, undefined, now),
      ]);
    errors.push(...sources.errors);

    const alerts = normalizeRecords(
      { problems: sources.problems, davisEvents: sources.davisEvents, genericEvents: sources.genericEvents },
      now,
    );

    const out = tick({
      now,
      settings,
      teams,
      schedules,
      policies,
      services,
      rules,
      contacts,
      incidents,
      pendingActions,
      ledger,
      alerts,
      sourceStatus: sources.status,
      archived: archivedBounds(archiveRows),
      ...(deps.appBaseUrl ? { appBaseUrl: deps.appBaseUrl } : {}),
    });
    errors.push(...out.errors);
    counts = out.counts;

    const failed = (what: string) => (key: string, e: unknown) => errors.push(`${what} ${key}: ${describeError(e)}`);

    // The tick may have run long: never write with a lost lease (another tick owns the state now).
    if (!(await stillHolder())) {
      leased = false;
      errors.push("engine lease lost before writing; nothing written");
      return fail();
    }

    // 1) incidents
    let incidentWriteFailed = false;
    await forEachLimited(
      out.incidentsToWrite,
      8,
      (inc) => repo.put(KEY.incident(inc.id), inc),
      (inc, e) => {
        incidentWriteFailed = true;
        failed("write incident")(inc.id, e);
      },
    );

    // 2) ledger. A timeout is not written over a record that meanwhile became sent/failed, and its
    //    retry is dropped; only requests whose ledger record was written are returned for sending
    //    (otherwise an unrecorded page would be re-planned and re-sent every minute).
    const maxAttempts = settings.engine.maxAttempts;
    const resolvedMeanwhile = new Set<string>();
    for (const r of out.notificationsToWrite) {
      if (r.status !== "timeout") continue;
      const cur = (await repo.get<NotificationRecord>(KEY.notification(r.key)).catch(() => undefined))?.value;
      if (cur && (cur.status === "sent" || cur.status === "failed")) resolvedMeanwhile.add(r.key);
    }
    const toWrite = out.notificationsToWrite.filter(
      (r) => !resolvedMeanwhile.has(r.key) && !(r.attempt > 1 && resolvedMeanwhile.has(withAttempt(r.key, r.attempt - 1))),
    );
    const written = new Set<string>();
    await forEachLimited(
      toWrite,
      8,
      async (r: NotificationRecord) => {
        await repo.put(KEY.notification(r.key), isFinalRecord(r, maxAttempts) ? slimRecord(r) : r, NOTIFICATION_TTL_MS);
        written.add(r.key);
      },
      (r, e) => failed("write notification")(r.key, e),
    );
    const batches = emptyBatches();
    let dropped = 0;
    for (const c of CHANNELS) {
      for (const n of out.batches[c]) {
        if (written.has(n.key)) batches[c].push(n);
        else dropped++;
      }
    }
    if (dropped > 0) errors.push(`${dropped} notification(s) not sent: ledger write failed or superseded`);

    // 3) folded actions — only when every incident write succeeded
    if (!incidentWriteFailed) {
      await forEachLimited(out.actionKeysToDelete, 8, (k) => repo.delete(k), failed("delete action"));
    }

    // 4) rollups: this tick's delta, plus deltas written by delivery reports outside the lease
    await addRollup(repo, out.rollupDelta).catch((e: unknown) => errors.push(`rollup: ${describeError(e)}`));
    const rollupRows = await repo.list<DailyRollup>(PREFIX.rollup).catch(() => [] as Stored<DailyRollup>[]);
    await foldRollupDeltas(repo, rollupRows).catch((e: unknown) => errors.push(`rollup fold: ${describeError(e)}`));

    // 5) archives, then drop their live keys
    const archiveTtl = Math.min(90, Math.max(1, settings.retention.archiveDays)) * DAY_MS;
    const archived = new Set<string>();
    await forEachLimited(
      out.archives,
      8,
      async (a) => {
        await repo.put(KEY.archive(a.day, a.incident.id), a.incident, archiveTtl);
        archived.add(a.incident.id);
      },
      (a, e) => failed("archive")(a.incident.id, e),
    );
    await forEachLimited(
      out.incidentIdsToDelete.filter((id) => archived.has(id)),
      8,
      (id) => repo.delete(KEY.incident(id)),
      failed("delete incident"),
    );

    // 6) storage estimate (+ shedding of the oldest archives above the threshold)
    storage = await estimateStorage(repo, now, archiveRows, rollupRows, {
      [PREFIX.incident]: usage(incidents.map((value) => ({ value }))),
      [PREFIX.action]: usage(pendingActions),
      [PREFIX.notification]: usage(ledger.map((value) => ({ value }))),
      [PREFIX.team]: usage(teams.map((value) => ({ value }))),
      [PREFIX.schedule]: usage(schedules.map((value) => ({ value }))),
      [PREFIX.policy]: usage(policies.map((value) => ({ value }))),
      [PREFIX.service]: usage(services.map((value) => ({ value }))),
      [PREFIX.contact]: usage(contacts.map((value) => ({ value }))),
      cfg: usage([{ value: settings }, { value: rules }]),
    }).catch((e: unknown) => {
      errors.push(`storage estimate: ${describeError(e)}`);
      return previous?.storage;
    });

    if (!(await stillHolder())) {
      leased = false;
      errors.push("engine lease lost while writing; notifications deferred to the next tick");
      return fail({ counts });
    }
    return { ok: true, tickAt: now, batches, counts, errors, providers };
  } catch (e) {
    errors.push(`tick: ${describeError(e)}`);
    return fail();
  } finally {
    if (!skipped) {
      // Release first (always, verified by re-reading), then record the outcome.
      const released = leased ? await releaseLease(repo, holder, now).catch(() => false) : true;
      if (!released) errors.push("engine lease release could not be verified");
      await writeHeartbeat(repo, {
        schemaVersion: SCHEMA_VERSION,
        lastTickAt: now,
        durationMs: Date.now() - started,
        counts,
        ...(errors.length ? { lastError: errors[0]?.slice(0, 500) } : {}),
        ...(storage ? { storage } : previous?.storage ? { storage: previous.storage } : {}),
        ...(released ? {} : { releaseFailedAt: now }),
      });
    }
  }
}

/** Bytes per prefix from what this tick loaded; sheds the oldest archives above the threshold. */
async function estimateStorage(
  repo: Repository,
  now: number,
  archives: Stored<unknown>[],
  rollups: Stored<unknown>[],
  loaded: Record<string, PrefixUsage>,
): Promise<StorageEstimate> {
  const byPrefix: Record<string, PrefixUsage> = { ...loaded, [PREFIX.archive]: usage(archives), [PREFIX.rollup]: usage(rollups) };
  let shed = 0;
  const total = Object.values(byPrefix).reduce((n, u) => n + u.bytes, 0);
  if (total > SHED_THRESHOLD_BYTES) {
    const r = await shedArchives(repo, archives, total);
    shed = r.deleted;
    byPrefix[PREFIX.archive] = { keys: archives.length - r.deleted, bytes: (byPrefix[PREFIX.archive]?.bytes ?? 0) - r.freed };
  }
  const totalBytes = Object.values(byPrefix).reduce((n, u) => n + u.bytes, 0);
  return { at: now, totalBytes, limitBytes: APP_STATE_LIMIT_BYTES, byPrefix, ...(shed ? { shed } : {}) };
}

/** Archived incident ids → upper bound of their resolve time (from the `arc.<yyyymmdd>.<id>` key). */
export function archivedBounds(rows: readonly { key: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const b = archiveResolvedBound(r.key);
    if (b) m.set(b.id, Math.max(m.get(b.id) ?? 0, b.bound));
  }
  return m;
}
