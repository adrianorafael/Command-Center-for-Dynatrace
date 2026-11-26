/**
 * The one seam between the UI and agents A (pure domain) and B (data/platform).
 * Pages import domain logic and platform calls from here only, so a signature change
 * on either side is reconciled in this file.
 */
import type { Channel, DirectoryUser, EngineTickRequest, Settings } from "../domain/contracts";
import type { Store } from "../data/repository";
import { buildEngineWorkflowCreate } from "../data/workflows/definition";
import { currentAppId, DEMO_ACTOR, getDirectory, getInstaller, getStore, isDemo, isRuntimeMissing, setDemoPreference } from "../data/demoMode";
import { getCurrentUserDetails } from "@dynatrace-sdk/app-environment";

// ─── A: pure domain ───────────────────────────────────────────────────────────
export { effectiveIncident } from "../domain/incidents/actions";
export { onCallAt, onCallUids, layerOnCallAt } from "../domain/schedule/resolve";
export type { OnCall } from "../domain/schedule/resolve";
export { scheduleTimeline, layerTimeline, overrideTimeline, onCallNowAndNext, onCallHoursByUser } from "../domain/schedule/timeline";
export type { ShiftSegment } from "../domain/schedule/timeline";
export { routeAlert, ruleMatches, evaluateCondition, fieldValues, RULE_FIELDS } from "../domain/routing/match";
export type { RouteDecision } from "../domain/routing/match";
export { allFirings, stepOffsetsMs, simulatePolicy } from "../domain/escalation/machine";
export { expandTargets } from "../domain/escalation/targets";
export { summarizeRollups, rollupsFromIncidents, incidentTimings } from "../domain/reports/metrics";
export type { MetricsSummary } from "../domain/reports/metrics";
export { defaultSettings } from "../domain/validation/defaults";
export { isValidTimeZone } from "../domain/time/tz";

// ─── B: data / platform ───────────────────────────────────────────────────────
export type { EngineWorkflowStatus, InstallOutcome } from "../data/workflows/installer";
export { setDemoPreference, isRuntimeMissing };

export function createAppStore(): Store {
  return getStore();
}

export function isDemoActive(): boolean {
  return isDemo();
}

export function getCurrentUser(): DirectoryUser {
  if (isDemo()) return { uid: DEMO_ACTOR, name: "You (demo)" };
  try {
    const u = getCurrentUserDetails();
    return { uid: u.id, name: u.name, email: u.email };
  } catch {
    return { uid: DEMO_ACTOR, name: "You" };
  }
}

export function loadDirectoryUsers(uids: string[]): Promise<DirectoryUser[]> {
  return uids.length ? getDirectory().resolve(uids) : Promise.resolve([]);
}

export function searchDirectory(query: string): Promise<DirectoryUser[]> {
  return getDirectory().search(query);
}

export function installEngine(settings: Settings, actor?: string) {
  return getInstaller().install(settings, actor ? { actor } : undefined);
}

export function getEngineStatus(settings: Settings) {
  return getInstaller().getStatus(settings);
}

/** Escalate now / test notification: runs the engine workflow immediately (spec §8). */
export function runEngineNow(settings: Settings, reason: EngineTickRequest["reason"], testRequest?: { providerId: string; channel: Channel; address: string }) {
  const params: EngineTickRequest = testRequest ? { reason, testRequest } : { reason };
  return getInstaller().runEngineNow(settings, params, `${reason}-${Date.now()}`);
}

export {
  validateTeam,
  validateSchedule,
  validatePolicy,
  validateService,
  validateRule,
  validateRules,
  validateSettings,
  validateProvider,
  validateUserContact,
  looksLikeSecret,
  E164_RE,
  VAULT_ID_RE,
} from "../domain/validation/validate";
export type { ValidationError } from "../domain/validation/validate";

/** New entity id matching the key-safe id rule ([a-z0-9][a-z0-9_-]{0,63}). */
export function newId(prefix: string): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
  const p = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
  return `${p}-${s}`;
}

/**
 * Engine workflow definition as importable JSON (third-party apps can't hold
 * automation:workflows:write, so admins upload it in the Workflows app).
 */
export function buildWorkflowJson(settings: Settings): string {
  const def = buildEngineWorkflowCreate({ appId: currentAppId(), settings });
  return JSON.stringify(def, null, 2);
}
export { currentAppId };
