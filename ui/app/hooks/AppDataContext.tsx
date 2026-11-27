/**
 * App-wide data layer: one Store (data/store.ts createStore over the demo or App State repository),
 * a snapshot of every collection, polling refresh, and mutations with optimistic incident
 * updates (the same effectiveIncident reducer the engine uses).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "./notifications";
import type { WarRoom } from "../domain/warrooms";
import { Button } from "@dynatrace/strato-components/buttons";
import type {
  DailyRollup,
  DirectoryUser,
  EngineHeartbeat,
  EscalationPolicy,
  Incident,
  IncidentAction,
  NotificationRecord,
  RoutingRules,
  Schedule,
  Service,
  Settings,
  Team,
  UserContact,
} from "../domain/contracts";
import { SCHEMA_VERSION, engineStaleAfterMs } from "../domain/contracts";
import type { Store, Stored } from "../data/repository";
import { createAppStore, effectiveIncident, getCurrentUser, isDemoActive, loadDirectoryUsers } from "./domain";
import { errorMessage } from "../components/format";

/** Snapshot of every collection, reloaded on each poll. */
export interface AppData {
  settings: Settings;
  teams: Team[];
  schedules: Schedule[];
  policies: EscalationPolicy[];
  services: Service[];
  rules: RoutingRules;
  contacts: UserContact[];
  /** Effective incidents (stored + pending actions + optimistic local actions). */
  incidents: Incident[];
  actions: Stored<IncidentAction>[];
  notifications: NotificationRecord[];
  rollups: DailyRollup[];
  heartbeat?: EngineHeartbeat;
  warRooms: WarRoom[];
}

/** Distributive omit so each action variant keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An operator action as a page submits it; act() fills in incident, time, client and author. */
export type ActionPayload = DistributiveOmit<IncidentAction, "schemaVersion" | "incidentId" | "at" | "clientId" | "by">;

/** What useAppData() returns. `now` (epoch ms) ticks every 15 s so ages re-render without a refetch. */
export interface AppDataContextValue {
  store: Store;
  demo: boolean;
  data?: AppData;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: unknown;
  lastUpdated?: number;
  now: number;
  refresh: () => Promise<void>;
  /** Auto-refresh interval in seconds (0 = off). Defaults to settings.ui.autoRefreshSec. */
  refreshSec: number;
  setRefreshSec: (s: number) => void;
  setPaused: (p: boolean) => void;
  currentUser: DirectoryUser;
  users: Map<string, DirectoryUser>;
  userName: (uid: string | undefined) => string;
  /** Cache users found through the directory (picker results) for display. */
  rememberUsers: (list: DirectoryUser[]) => void;
  /** Append one operator action per incident; optimistic; returns the appended actions. */
  act: (incidentIds: string[], payload: ActionPayload, opts?: { silent?: boolean }) => Promise<IncidentAction[]>;
  /** Run a config write, refresh, toast. Throws after showing the failure toast. */
  mutate: (fn: (s: Store) => Promise<void>, successTitle?: string) => Promise<void>;
}

const Ctx = createContext<AppDataContextValue | null>(null);

function randomId(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

const ACTION_VERB: Record<string, [string, string]> = {
  ack: ["Incident acknowledged", "acknowledge"],
  unack: ["Acknowledgement undone", "undo acknowledgement of"],
  resolve: ["Incident resolved", "resolve"],
  reopen: ["Incident reopened", "reopen"],
  snooze: ["Incident snoozed", "snooze"],
  reassign: ["Incident reassigned", "reassign"],
  escalate: ["Escalation requested", "escalate"],
  priority: ["Priority changed", "change priority of"],
  note: ["Note added", "add a note to"],
  tag: ["Tags updated", "update tags of"],
};

/** Loads everything once, then polls every `refreshSec` (paused while `setPaused(true)`). */
export const AppDataProvider = ({ children }: { children: React.ReactNode }) => {
  const [store] = useState<Store>(() => createAppStore());
  const [demo] = useState<boolean>(() => isDemoActive());
  const clientId = useMemo(() => `ui-${randomId()}`, []);
  const [currentUser] = useState<DirectoryUser>(() => getCurrentUser());

  const [raw, setRaw] = useState<Omit<AppData, "incidents"> & { rawIncidents: Incident[] }>();
  const [isLoading, setLoading] = useState(true);
  const [isRefreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>();
  const [lastUpdated, setLastUpdated] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const [local, setLocal] = useState<{ action: IncidentAction; confirmed: boolean }[]>([]);
  const [refreshOverride, setRefreshOverride] = useState<number>();
  const [paused, setPaused] = useState(false);
  const [users, setUsers] = useState<Map<string, DirectoryUser>>(() => new Map([[currentUser.uid, currentUser]]));
  const inflight = useRef<Promise<void> | null>(null);
  /** Incident ids seen in the previous load (null before the first load): drives "new incident" notifications. */
  const seenIncidents = useRef<Set<string> | null>(null);
  const engineStaleNotified = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const started = Date.now();
    setRefreshing(true);
    const p = (async () => {
      try {
        const [settings, teams, schedules, policies, services, rules, contacts, rawIncidents, actions, notifications, rollups, heartbeat, warRooms] =
          await Promise.all([
            store.getSettings(),
            store.listTeams(),
            store.listSchedules(),
            store.listPolicies(),
            store.listServices(),
            store.getRules(),
            store.listContacts(),
            store.listIncidents(),
            store.listActions(),
            store.listNotifications(),
            store.listRollups(),
            store.getHeartbeat(),
            store.listWarRooms(),
          ]);
        const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
        setRaw({
          settings,
          teams: [...teams].sort(byName),
          schedules: [...schedules].sort(byName),
          policies: [...policies].sort(byName),
          services: [...services].sort(byName),
          rules,
          contacts,
          rawIncidents,
          actions,
          notifications,
          rollups: [...rollups].sort((a, b) => a.day.localeCompare(b.day)),
          heartbeat,
          warRooms,
        });
        // New urgent incidents (P1/P2, triggered) and paging-engine health go to the notification center.
        const ids = new Set(rawIncidents.map((i) => i.id));
        if (seenIncidents.current) {
          const fresh = rawIncidents.filter(
            (i) => !seenIncidents.current?.has(i.id) && i.status === "triggered" && (i.priority === "P1" || i.priority === "P2"),
          );
          fresh.slice(0, 3).forEach((i) =>
            notify({
              category: "incident",
              type: i.priority === "P1" ? "critical" : "warning",
              title: `${i.priority} · ${i.alert.title}`,
              message: `#${i.alert.displayId ?? i.id}`,
              link: `/incidents/${i.id}`,
              lifespan: 8_000,
            }),
          );
          if (fresh.length > 3) notify({ category: "incident", type: "warning", title: `${fresh.length - 3} more new P1/P2 incidents`, link: "/" });
        }
        seenIncidents.current = ids;
        const staleMs = engineStaleAfterMs(settings);
        const stale = !!heartbeat && Date.now() - heartbeat.lastTickAt > staleMs;
        if (stale && !engineStaleNotified.current) {
          notify({
            category: "engine",
            type: "warning",
            title: "Paging engine is not running",
            message: `No engine run in the last ${Math.round(staleMs / 60_000)} minutes: escalations and notifications are delayed until it runs again.`,
            link: "/integrations",
            lifespan: 10_000,
          });
        }
        engineStaleNotified.current = stale;
        // Confirmed local actions are now part of the stored pending list.
        setLocal((l) => l.filter((x) => !(x.confirmed && x.action.at <= started)));
        setError(undefined);
        setLastUpdated(Date.now());
        setNow(Date.now());
        // Resolve display names for every uid we reference.
        const uids = new Set<string>();
        teams.forEach((t) => t.members.forEach((m) => uids.add(m.uid)));
        schedules.forEach((s) => {
          s.layers.forEach((l) => l.participants.forEach((u) => uids.add(u)));
          s.overrides.forEach((o) => uids.add(o.uid));
        });
        rawIncidents.forEach((i) => {
          if (i.assignee?.type === "user") uids.add(i.assignee.id);
          if (i.acknowledgedBy) uids.add(i.acknowledgedBy);
        });
        const fromContacts = new Map<string, DirectoryUser>();
        contacts.forEach((c) => c.displayName && fromContacts.set(c.uid, { uid: c.uid, name: c.displayName }));
        loadDirectoryUsers([...uids])
          .then((list) => {
            setUsers((prev) => {
              const next = new Map(prev);
              fromContacts.forEach((u, k) => next.has(k) || next.set(k, u));
              list.forEach((u) => next.set(u.uid, u));
              return next;
            });
          })
          .catch(() =>
            setUsers((prev) => {
              const next = new Map(prev);
              fromContacts.forEach((u, k) => next.has(k) || next.set(k, u));
              return next;
            }),
          );
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
        setRefreshing(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshSec = refreshOverride ?? raw?.settings.ui.autoRefreshSec ?? 60;
  useEffect(() => {
    if (!refreshSec || paused) return;
    const t = window.setInterval(() => void load(), refreshSec * 1000);
    return () => window.clearInterval(t);
  }, [refreshSec, paused, load]);

  // Ages and countdowns tick every 15 s without refetching.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const data = useMemo<AppData | undefined>(() => {
    if (!raw) return undefined;
    const { rawIncidents, ...rest } = raw;
    const pendingBy = new Map<string, IncidentAction[]>();
    const push = (a: IncidentAction) => {
      const list = pendingBy.get(a.incidentId) ?? [];
      list.push(a);
      pendingBy.set(a.incidentId, list);
    };
    raw.actions.forEach((s) => push(s.value));
    local.forEach((l) => push(l.action));
    const incidents = rawIncidents.map((inc) => {
      const pend = pendingBy.get(inc.id);
      if (!pend || pend.length === 0) return inc;
      const sorted = [...pend].sort((a, b) => a.at - b.at);
      try {
        return effectiveIncident(inc, sorted);
      } catch {
        return inc;
      }
    });
    return { ...rest, incidents };
  }, [raw, local]);

  const userName = useCallback(
    (uid: string | undefined) => {
      if (!uid) return "Unassigned";
      if (uid === "system") return "System";
      if (uid === "source") return "Source";
      return users.get(uid)?.name ?? uid;
    },
    [users],
  );

  const rememberUsers = useCallback((list: DirectoryUser[]) => {
    if (!list.length) return;
    setUsers((prev) => {
      const next = new Map(prev);
      list.forEach((u) => next.set(u.uid, u));
      return next;
    });
  }, []);

  const act = useCallback<AppDataContextValue["act"]>(
    async (incidentIds, payload, opts) => {
      const at = Date.now();
      const actions = incidentIds.map(
        (incidentId, i) =>
          ({ ...payload, schemaVersion: SCHEMA_VERSION, incidentId, at: at + i, clientId, by: currentUser.uid }) as IncidentAction,
      );
      setLocal((l) => [...l, ...actions.map((action) => ({ action, confirmed: false }))]);
      try {
        for (const a of actions) await store.appendAction(a);
        setLocal((l) => l.map((x) => (actions.includes(x.action) ? { ...x, confirmed: true } : x)));
        if (!opts?.silent) {
          const [title] = ACTION_VERB[payload.type] ?? ["Done"];
          const inc = data?.incidents.find((i) => i.id === incidentIds[0]);
          const message =
            incidentIds.length > 1
              ? `${incidentIds.length} incidents`
              : inc
                ? `#${inc.alert.displayId ?? inc.id} · ${inc.alert.title}`
                : undefined;
          const undo =
            payload.type === "ack" ? ({ type: "unack" } as const) : payload.type === "resolve" ? ({ type: "reopen" } as const) : undefined;
          notify({
            category: "action",
            type: "success",
            title: incidentIds.length > 1 ? title.replace("Incident", `${incidentIds.length} incidents`) : title,
            message,
            lifespan: undo ? 10_000 : 4_000,
            actions: undo ? (
              <UndoButton onUndo={() => void actRef.current?.(incidentIds, undo, { silent: false })} />
            ) : undefined,
          });
        }
        void load();
        return actions;
      } catch (e) {
        setLocal((l) => l.filter((x) => !actions.includes(x.action)));
        const [, verb] = ACTION_VERB[payload.type] ?? ["", "update"];
        const inc = data?.incidents.find((i) => i.id === incidentIds[0]);
        notify({
          category: "error",
          type: "critical",
          title: `Couldn't ${verb} ${incidentIds.length > 1 ? `${incidentIds.length} incidents` : `#${inc?.alert.displayId ?? incidentIds[0]}`}`,
          message: errorMessage(e),
          lifespan: "infinite",
          actions: <UndoButton label="Retry" onUndo={() => void actRef.current?.(incidentIds, payload, opts)} />,
        });
        throw e;
      }
    },
    [clientId, currentUser.uid, data, load, store],
  );
  const actRef = useRef(act);
  actRef.current = act;

  const mutate = useCallback<AppDataContextValue["mutate"]>(
    async (fn, successTitle) => {
      try {
        await fn(store);
        if (successTitle) notify({ category: "action", type: "success", title: successTitle, lifespan: 4_000 });
        await load();
      } catch (e) {
        notify({ category: "error", type: "critical", title: "Couldn't save your changes", message: errorMessage(e), lifespan: "infinite" });
        throw e;
      }
    },
    [load, store],
  );

  const value: AppDataContextValue = {
    store,
    demo,
    data,
    isLoading,
    isRefreshing,
    error,
    lastUpdated,
    now,
    refresh: load,
    refreshSec,
    setRefreshSec: setRefreshOverride,
    setPaused,
    currentUser,
    users,
    userName,
    rememberUsers,
    act,
    mutate,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

const UndoButton = ({ onUndo, label = "Undo" }: { onUndo: () => void; label?: string }) => (
  <Button onClick={onUndo}>{label}</Button>
);

/** The app data context; throws outside AppDataProvider. */
export function useAppData(): AppDataContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData must be used inside <AppDataProvider>");
  return v;
}

/** Copy with `rev` bumped, before writing a config object (schemaVersion is left as it is). */
export function nextRev<T extends { rev: number }>(obj: T): T {
  return { ...obj, rev: (obj.rev ?? 0) + 1 };
}
