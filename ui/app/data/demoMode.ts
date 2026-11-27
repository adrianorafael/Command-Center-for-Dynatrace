/**
 * Demo-mode detection and adapter selection (spec §10). UI only (uses window/localStorage).
 *
 * Demo is active when any of:
 *  - getEnvironmentId() === 'dt.missing.environment.id' — documented fallback "if the Dynatrace
 *    JavaScript runtime isn't available" (node_modules/@dynatrace-sdk/app-environment/types/index.d.ts l.80)
 *  - the URL has ?demo=1 — only when the runtime is missing (offline preview)
 *  - localStorage 'cc.demo' === '1' (set by the Settings → demo mode switch)
 * Settings.demoMode is a stored preference the UI may also honour by calling setDemoPreference(true).
 */

import { getAppId, getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { AppStateRepository } from "./appStateRepository";
import { createIamDirectory, createStaticDirectory, type Directory } from "./directory";
import { demoSeed, demoUsers } from "./demoPort";
import { MemoryRepository } from "./memoryRepository";
import { KEY, type Repository } from "./repository";
import { createStore } from "./store";
import type { Store } from "./repository";
import { createDemoInstaller, createWorkflowInstaller, type EngineInstaller } from "./workflows/installer";

/** What getEnvironmentId() returns without the Dynatrace runtime (see header). */
export const MISSING_ENVIRONMENT_ID = "dt.missing.environment.id";
/** localStorage key of the per-browser demo preference. */
export const DEMO_STORAGE_KEY = "cc.demo";
/** Placeholder app id used when the runtime is missing (matches app.config.json). */
export const FALLBACK_APP_ID = "my.command.center";
/** Synthetic identity used for writes in demo mode. */
export const DEMO_ACTOR = "user-0001";

function safeEnvironmentId(): string {
  try {
    return getEnvironmentId();
  } catch {
    return MISSING_ENVIRONMENT_ID;
  }
}

function urlDemoFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const v = new URLSearchParams(window.location.search).get("demo");
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

function storageDemoFlag(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DEMO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** True when the platform runtime is absent (offline preview, tests). */
export function isRuntimeMissing(): boolean {
  return safeEnvironmentId() === MISSING_ENVIRONMENT_ID;
}

/**
 * ?demo=1 is only honoured when the platform runtime is missing (offline preview); inside a real
 * environment a crafted link must not silently switch an operator to fake data. The explicit,
 * stored preference (Settings → demo mode) still applies.
 */
export function isDemo(): boolean {
  // Without the runtime the app is always in demo mode, so ?demo=1 only documents intent there.
  return isRuntimeMissing() || storageDemoFlag();
}

/** True when the URL asks for demo data (informational; see isDemo). */
export function demoRequestedByUrl(): boolean {
  return urlDemoFlag();
}

/** Persist the user's demo preference for this browser; takes effect on reload. */
export function setDemoPreference(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEMO_STORAGE_KEY, "1");
    else localStorage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // storage blocked: preference simply isn't remembered
  }
}

/** This app's id from the runtime, or FALLBACK_APP_ID offline. */
export function currentAppId(): string {
  try {
    const id = getAppId();
    return id && !id.startsWith("dt.missing") ? id : FALLBACK_APP_ID;
  } catch {
    return FALLBACK_APP_ID;
  }
}

let repo: Repository | undefined;
let directory: Directory | undefined;
let installer: EngineInstaller | undefined;
let store: Store | undefined;

/**
 * Offline preview only (runtime missing): `?demo=empty` starts with no teams, schedules, policies, services or
 * incidents, to walk through the first-time setup. The synthetic user directory stays available.
 */
function emptyDemoRequested(): boolean {
  try {
    return isRuntimeMissing() && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "empty";
  } catch {
    return false;
  }
}

/**
 * Demo mode has no engine, so the seeded heartbeat would age and, after a few minutes, every page would warn that
 * the paging engine is late. This wrapper reports the seeded heartbeat as if the engine had just run (at the start
 * of the current minute), so a demo stays clean however long it is shown. Nothing else is changed.
 */
export function withLiveDemoHeartbeat(inner: Repository, now: () => number = Date.now): Repository {
  return {
    async get<T>(key: string) {
      const hit = await inner.get<T>(key);
      if (key !== KEY.heartbeat || !hit) return hit;
      const t = now();
      return { ...hit, value: { ...(hit.value as object), lastTickAt: t - (t % 60_000) } as T };
    },
    list: (prefix) => inner.list(prefix),
    put: (key, value, ttlMs) => inner.put(key, value, ttlMs),
    delete: (key) => inner.delete(key),
  };
}

/** The process-wide Repository: MemoryRepository with demo fixtures in demo mode, App State otherwise. Cached. */
export function getRepository(): Repository {
  if (!repo) {
    repo = isDemo()
      ? withLiveDemoHeartbeat(new MemoryRepository(emptyDemoRequested() ? [] : demoSeed(Date.now()), { actor: DEMO_ACTOR }))
      : new AppStateRepository();
  }
  return repo;
}

/** Store over getRepository(). Cached. */
export function getStore(): Store {
  if (!store) store = createStore(getRepository());
  return store;
}

/** User directory: synthetic users in demo mode, IAM otherwise. Cached. */
export function getDirectory(): Directory {
  if (!directory) directory = isDemo() ? createStaticDirectory(demoUsers(Date.now())) : createIamDirectory();
  return directory;
}

/** Engine workflow installer: offline stand-in in demo mode, Automation API otherwise. Cached. */
export function getInstaller(): EngineInstaller {
  if (!installer) installer = isDemo() ? createDemoInstaller(currentAppId()) : createWorkflowInstaller(currentAppId());
  return installer;
}

/** Tests only: forget cached adapters. */
export function resetAdaptersForTests(): void {
  repo = undefined;
  directory = undefined;
  installer = undefined;
  store = undefined;
}
