/**
 * Engine tick orchestration (I/O around the pure domain `tick`). Dependencies are injected so
 * the whole flow runs in tests against MemoryRepository and a mocked Grail.
 *
 * Write order matters (no transactions in App State):
 *   incidents → ledger records → delete folded actions → rollup → archives (+ delete their
 *   inc.* keys) → heartbeat → release lease (finally).
 * Deleting actions only after the incident write succeeded means an ack is never lost; a crash
 * in between just folds the same (idempotent) actions again on the next tick.
 */

import {
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
import { KEY, type Repository } from "../../ui/app/data/repository";
import { createStore } from "../../ui/app/data/store";
import { describeError, type RunQuery } from "../../ui/app/data/grail";
import { normalizeRecords } from "../../ui/app/domain/alerts/normalize";
import { emptyBatches, tick } from "../../ui/app/domain/engine/tick";
import { applyRollupDelta, isEmptyDelta, type RollupDelta } from "../../ui/app/domain/reports/metrics";
import { acquireLease, releaseLease } from "./lease";
import { fetchSources } from "./sources";

export const NOTIFICATION_TTL_MS = 14 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

export interface EngineDeps {
  repo: Repository;
  runQuery: RunQuery;
  now?: () => number;
  /** Lease holder id (random per invocation). */
  holder?: string;
  /** Absolute base URL of the app UI for message links, e.g. https://<env>.apps.dynatrace.com/ui/apps/<appId> */
  appBaseUrl?: string;
}

/** Non-secret provider view handed to the send tasks through the tick result. */
export interface ProviderView {
  id: string;
  channel: Channel;
  kind: ProviderConfig["kind"];
  enabled: boolean;
  credentialVaultId?: string;
  params: Record<string, string>;
}

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

export async function runEngineTick(payload: EngineTickRequest, deps: EngineDeps): Promise<EngineTickResult> {
  const now = (deps.now ?? Date.now)();
  const started = Date.now();
  const repo = deps.repo;
  const store = createStore(repo);
  const settings = await store.getSettings();
  const base = {
    ok: true,
    tickAt: now,
    batches: emptyBatches(),
    counts: zeroCounts(),
    errors: [] as string[],
    providers: providerViews(settings),
  };

  if (payload?.reason === "test") {
    if (!payload.testRequest) return { ...base, ok: false, errors: ["Test notification: testRequest is missing"] };
    const t = buildTestRequest(settings, payload.testRequest, now, deps.appBaseUrl);
    if (!t.request) return { ...base, ok: false, errors: [t.error ?? "Test notification failed"] };
    base.batches[t.request.channel].push(t.request);
    return base;
  }

  if (!settings.engine.enabled) return { ...base, skipped: "disabled" };

  const holder = deps.holder ?? `tick-${now}-${randomId()}`;
  if (!(await acquireLease(repo, holder, now, settings.engine.lockTtlSec))) {
    return { ...base, skipped: "locked" };
  }

  const errors: string[] = [];
  let counts = zeroCounts();
  try {
    const [teams, schedules, policies, services, rules, contacts, incidents, pendingActions, ledger, sources] =
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
        fetchSources(settings, deps.runQuery),
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
      ...(deps.appBaseUrl ? { appBaseUrl: deps.appBaseUrl } : {}),
    });
    errors.push(...out.errors);
    counts = out.counts;

    const fail = (what: string) => (key: string, e: unknown) => errors.push(`${what} ${key}: ${describeError(e)}`);

    // 1) incidents
    let incidentWriteFailed = false;
    await forEachLimited(
      out.incidentsToWrite,
      8,
      (inc) => repo.put(KEY.incident(inc.id), inc),
      (inc, e) => {
        incidentWriteFailed = true;
        fail("write incident")(inc.id, e);
      },
    );
    // 2) ledger
    await forEachLimited(
      out.notificationsToWrite,
      8,
      (r: NotificationRecord) => repo.put(KEY.notification(r.key), r, NOTIFICATION_TTL_MS),
      (r, e) => fail("write notification")(r.key, e),
    );
    // 3) folded actions — only when every incident write succeeded
    if (!incidentWriteFailed) {
      await forEachLimited(out.actionKeysToDelete, 8, (k) => repo.delete(k), fail("delete action"));
    }
    // 4) rollup
    await addRollup(repo, out.rollupDelta).catch((e: unknown) => errors.push(`rollup: ${describeError(e)}`));
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
      (a, e) => fail("archive")(a.incident.id, e),
    );
    await forEachLimited(
      out.incidentIdsToDelete.filter((id) => archived.has(id)),
      8,
      (id) => repo.delete(KEY.incident(id)),
      fail("delete incident"),
    );

    const response: EngineTickResult = {
      ok: true,
      tickAt: now,
      batches: out.batches,
      counts,
      errors,
      providers: base.providers,
    };
    return response;
  } catch (e) {
    errors.push(`tick: ${describeError(e)}`);
    return { ...base, ok: false, counts, errors };
  } finally {
    const hb: EngineHeartbeat = {
      schemaVersion: SCHEMA_VERSION,
      lastTickAt: now,
      durationMs: Date.now() - started,
      counts,
      ...(errors.length ? { lastError: errors[0]?.slice(0, 500) } : {}),
    };
    await repo.put(KEY.heartbeat, hb).catch(() => undefined);
    await releaseLease(repo, holder).catch(() => undefined);
  }
}

export async function addRollup(repo: Repository, delta: RollupDelta): Promise<void> {
  if (isEmptyDelta(delta)) return;
  const key = KEY.rollup(delta.day);
  const existing = await repo.get<DailyRollup>(key);
  await repo.put(key, applyRollupDelta(existing?.value, delta));
}
