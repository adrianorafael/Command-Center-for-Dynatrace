/**
 * Demo-mode detection and adapter selection (spec §10). UI only (uses window/localStorage).
 *
 * Demo is active when any of:
 *  - getEnvironmentId() === 'dt.missing.environment.id' — documented fallback "if the Dynatrace
 *    JavaScript runtime isn't available" (node_modules/@dynatrace-sdk/app-environment/types/index.d.ts l.80)
 *  - the URL has ?demo=1
 *  - localStorage 'cc.demo' === '1' (set by the Settings → demo mode switch)
 * Settings.demoMode is a stored preference the UI may also honour by calling setDemoPreference(true).
 */

import { getAppId, getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { AppStateRepository } from "./appStateRepository";
import { createIamDirectory, createStaticDirectory, type Directory } from "./directory";
import { demoSeed, demoUsers } from "./domainPort";
import { MemoryRepository } from "./memoryRepository";
import type { Repository } from "./repository";
import { createStore } from "./store";
import type { Store } from "./repository";
import { createDemoInstaller, createWorkflowInstaller, type EngineInstaller } from "./workflows/installer";

export const MISSING_ENVIRONMENT_ID = "dt.missing.environment.id";
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

export function isDemo(): boolean {
  return isRuntimeMissing() || urlDemoFlag() || storageDemoFlag();
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

export function getRepository(): Repository {
  if (!repo) {
    repo = isDemo()
      ? new MemoryRepository(demoSeed(Date.now()), { actor: DEMO_ACTOR })
      : new AppStateRepository();
  }
  return repo;
}

export function getStore(): Store {
  if (!store) store = createStore(getRepository());
  return store;
}

export function getDirectory(): Directory {
  if (!directory) directory = isDemo() ? createStaticDirectory(demoUsers(Date.now())) : createIamDirectory();
  return directory;
}

export function getInstaller(): EngineInstaller {
  if (!installer) installer = isDemo() ? createDemoInstaller() : createWorkflowInstaller(currentAppId());
  return installer;
}

/** Tests only: forget cached adapters. */
export function resetAdaptersForTests(): void {
  repo = undefined;
  directory = undefined;
  installer = undefined;
  store = undefined;
}
