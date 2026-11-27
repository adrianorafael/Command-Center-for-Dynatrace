/**
 * The one seam between the UI and the lower layers: the pure domain (ui/app/domain) and the data/platform
 * adapters (ui/app/data). Pages import domain logic and platform calls from here, so a signature change on either
 * side is reconciled in this file.
 */
import { exportOnProblemDefinition, getOnProblemStatus, openOnProblemIntent, type OnProblemWorkflowStatus } from "../data/workflows/installer";
import { exportCustomWorkflow, exportProviderWorkflow, findCustomWorkflows, findProviderWorkflows, openCustomWorkflowIntent, openProviderWorkflowIntent, type CustomWorkflowInfo } from "../data/workflows/installer";
import type { Channel, DirectoryUser, EngineTickRequest, Settings } from "../domain/contracts";
import type { Store } from "../data/repository";
import { currentAppId, DEMO_ACTOR, getDirectory, getInstaller, getStore, isDemo, isRuntimeMissing, setDemoPreference } from "../data/demoMode";
import { getCurrentUserDetails, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

// ─── Pure domain ──────────────────────────────────────────────────────────────
export { effectiveIncident } from "../domain/incidents/actions";
export { onCallAt, onCallUids, layerOnCallAt } from "../domain/schedule/resolve";
export type { OnCall } from "../domain/schedule/resolve";
export { scheduleTimeline, layerTimeline, overrideTimeline, onCallNowAndNext, onCallHoursByUser } from "../domain/schedule/timeline";
export { firstHandoff } from "../domain/schedule/resolve";
export { startOfLocalDay, weekdayInZone, civilDate, safeTimeZone } from "../domain/time/tz";
export type { CivilDate } from "../domain/time/tz";
export {
  addWeeks, daysRange, formatCivilDate, formatDaysRange, isInDays, pickedCivilDate, placeSpan, positionIn,
  resolveWeekParam, weekDays, weekStartAt, weekStartOfDate,
} from "../domain/time/week";
export type { WeekDay } from "../domain/time/week";
export type { ShiftSegment } from "../domain/schedule/timeline";
export { routeAlert, ruleMatches, evaluateCondition, fieldValues, RULE_FIELDS } from "../domain/routing/match";
export type { RouteDecision } from "../domain/routing/match";
export { allFirings, stepOffsetsMs, simulatePolicy } from "../domain/escalation/machine";
export { expandTargets } from "../domain/escalation/targets";
export { summarizeRollups, rollupsFromIncidents, incidentTimings } from "../domain/reports/metrics";
export type { MetricsSummary } from "../domain/reports/metrics";
export { defaultSettings } from "../domain/validation/defaults";
export { isValidTimeZone } from "../domain/time/tz";

// ─── Data / platform ──────────────────────────────────────────────────────────
export type { EngineWorkflowStatus, InstallOutcome } from "../data/workflows/installer";
export { setDemoPreference, isRuntimeMissing };

/** The shared Store (App State, or the in-memory demo store). */
export function createAppStore(): Store {
  return getStore();
}

export function isDemoActive(): boolean {
  return isDemo();
}

/** The signed-in user; a placeholder identity in demo mode or when the runtime cannot tell. */
export function getCurrentUser(): DirectoryUser {
  if (isDemo()) return { uid: DEMO_ACTOR, name: "You (demo)" };
  try {
    const u = getCurrentUserDetails();
    return { uid: u.id, name: u.name, email: u.email };
  } catch {
    return { uid: DEMO_ACTOR, name: "You" };
  }
}

/** Resolve uids to directory users (IAM, or the synthetic demo directory). */
export function loadDirectoryUsers(uids: string[]): Promise<DirectoryUser[]> {
  return uids.length ? getDirectory().resolve(uids) : Promise.resolve([]);
}

/** Search active users by name or email (at least SEARCH_MIN_CHARS characters, else []). */
export function searchDirectory(query: string): Promise<DirectoryUser[]> {
  return getDirectory().search(query);
}

/** Engine workflow status for the Workflows tab (read-only Automation API calls). */
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
/** The custom-integration workflow as a file for Workflows → Upload. */
export function exportCustomWorkflowDefinition(): { fileName: string; json: string } {
  return exportCustomWorkflow(currentAppId());
}
/** Custom-integration workflows found by title (none in demo mode). */
export function findCustomWorkflowIds(): Promise<CustomWorkflowInfo[]> {
  return isDemo() ? Promise.resolve([]) : findCustomWorkflows();
}

/** "Engine on problem": the optional workflow that runs the engine when Davis opens or closes a problem. */
export type { OnProblemWorkflowStatus };
export function openOnProblemInstall(settings: Settings): void {
  openOnProblemIntent(currentAppId(), settings);
}
export function exportOnProblemWorkflowDefinition(settings: Settings): { fileName: string; json: string } {
  return exportOnProblemDefinition(currentAppId(), settings);
}
export function getOnProblemWorkflowStatus(): Promise<OnProblemWorkflowStatus> {
  // Demo mode shows a complete setup and never calls the platform.
  return isDemo()
    ? Promise.resolve({ installed: true, type: "SIMPLE", isDeployed: true, usesAction: true, triggerActive: true, outdated: false, demo: true })
    : getOnProblemStatus(currentAppId());
}

/** Per-integration workflow of a built-in provider (opt-in delivery; by default the engine sends directly). */
export function openProviderWorkflowInstall(provider: { id: string; name: string }): void {
  openProviderWorkflowIntent(currentAppId(), provider);
}
export function exportProviderWorkflowDefinition(provider: { id: string; name: string }): { fileName: string; json: string } {
  return exportProviderWorkflow(currentAppId(), provider);
}
/** Workflows titled for this provider (none in demo mode), to link one to the provider. */
export function findProviderWorkflowIds(providerName: string): Promise<CustomWorkflowInfo[]> {
  return isDemo() ? Promise.resolve([]) : findProviderWorkflows(providerName);
}
