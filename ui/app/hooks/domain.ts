import { exportCustomWorkflow, exportProviderWorkflow, findCustomWorkflows, findProviderWorkflows, openCustomWorkflowIntent, openProviderWorkflowIntent, type CustomWorkflowInfo } from "../data/workflows/installer";
/**
 * The one seam between the UI and agents A (pure domain) and B (data/platform).
 * Pages import domain logic and platform calls from here only, so a signature change
 * on either side is reconciled in this file.
 */
import type { Channel, DirectoryUser, EngineTickRequest, Settings } from "../domain/contracts";
import type { Store } from "../data/repository";
import { currentAppId, DEMO_ACTOR, getDirectory, getInstaller, getStore, isDemo, isRuntimeMissing, setDemoPreference } from "../data/demoMode";
import { getCurrentUserDetails, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

// ─── A: pure domain ───────────────────────────────────────────────────────────
export { effectiveIncident } from "../domain/incidents/actions";
export { onCallAt, onCallUids, layerOnCallAt } from "../domain/schedule/resolve";
export type { OnCall } from "../domain/schedule/resolve";
export { scheduleTimeline, layerTimeline, overrideTimeline, onCallNowAndNext, onCallHoursByUser } from "../domain/schedule/timeline";
export { firstHandoff } from "../domain/schedule/resolve";
export { startOfLocalDay, weekdayInZone } from "../domain/time/tz";
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

export function getEngineStatus(settings: Settings) {
  return getInstaller().getStatus(settings);
}

/** Run engine now / test notification: one full engine cycle through the app function engine-run. */
export function runEngineNow(settings: Settings, reason: EngineTickRequest["reason"], testRequest?: { providerId: string; channel: Channel; address: string }) {
  const params: EngineTickRequest = testRequest ? { reason, testRequest } : { reason };
  return getInstaller().runEngineNow(settings, params);
}

/** Opens the Workflows app with the engine workflow pre-filled (the person reviews and saves it). */
export function openEngineInstallIntent(settings: Settings, intervalMinutes?: number): void {
  getInstaller().openInstallIntent(settings, intervalMinutes);
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
export function exportWorkflowDefinition(settings: Settings, intervalMinutes?: number): { fileName: string; json: string } {
  return getInstaller().exportDefinition(settings, intervalMinutes);
}

/** Absolute link to the Workflows app, or undefined outside the platform. */
export function workflowsAppUrl(): string | undefined {
  try {
    const base = getEnvironmentUrl();
    if (!base || base.includes("missing")) return undefined;
    return `${base.replace(/\/$/, "")}${getInstaller().workflowsAppPath()}`;
  } catch {
    return undefined;
  }
}
export { currentAppId };

/** Custom integration workflow (provider kind "workflow"): prefilled example, created by the person in Workflows. */
export function openCustomWorkflowInstall(): void {
  openCustomWorkflowIntent(currentAppId());
}
export function exportCustomWorkflowDefinition(): { fileName: string; json: string } {
  return exportCustomWorkflow(currentAppId());
}
export function findCustomWorkflowIds(): Promise<CustomWorkflowInfo[]> {
  return isDemo() ? Promise.resolve([]) : findCustomWorkflows();
}

/** Per-integration workflow of a built-in provider. */
export function openProviderWorkflowInstall(provider: { id: string; name: string }): void {
  openProviderWorkflowIntent(currentAppId(), provider);
}
export function exportProviderWorkflowDefinition(provider: { id: string; name: string }): { fileName: string; json: string } {
  return exportProviderWorkflow(currentAppId(), provider);
}
export function findProviderWorkflowIds(providerName: string): Promise<CustomWorkflowInfo[]> {
  return isDemo() ? Promise.resolve([]) : findProviderWorkflows(providerName);
}
