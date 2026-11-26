/**
 * The one seam between the UI and agents A (pure domain) and B (data/platform).
 * Pages import domain logic and platform calls from here only, so a signature change
 * on either side is reconciled in this file.
 */
import type { DirectoryUser } from "../domain/contracts";
import type { Store } from "../data/repository";
import { createStore } from "../data/store";
import { getRepository, isDemo } from "../data/demoMode";
import { getCurrentUserDetails } from "@dynatrace-sdk/app-environment";

export { effectiveIncident, applyAction } from "../domain/incidents/actions";
export { onCallAt, onCallUids, layerOnCallAt } from "../domain/schedule/resolve";
export type { OnCall } from "../domain/schedule/resolve";
export { scheduleTimeline, layerTimeline, overrideTimeline, onCallNowAndNext, onCallHoursByUser } from "../domain/schedule/timeline";
export type { ShiftSegment } from "../domain/schedule/timeline";

export function createAppStore(): Store {
  return createStore(getRepository());
}

export function isDemoActive(): boolean {
  return isDemo();
}

export function getCurrentUser(): DirectoryUser {
  try {
    const u = getCurrentUserDetails();
    return { uid: u.id, name: u.name, email: u.email };
  } catch {
    return { uid: "me", name: "You" };
  }
}

export async function loadDirectoryUsers(uids: string[]): Promise<DirectoryUser[]> {
  void uids;
  return [];
}
