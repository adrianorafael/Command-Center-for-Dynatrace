/**
 * Paging suppression: routing-rule suppression, Davis maintenance windows and team quiet hours.
 *
 * - "rule": set at creation by a routing rule with `suppress: true` — never paged.
 * - "maintenance": the alert is under a Davis maintenance window and
 *   `settings.sources.davisProblems.pageDuringMaintenance` is false — re-evaluated every tick.
 * - "quiet-hours": a team quiet-hours window applies to incidents whose priority is strictly
 *   less urgent than `minPriority`. Mode "hold" pauses paging; "low-urgency" only allows
 *   LOW_URGENCY_CHANNELS (chat/webhook, no SMS/voice/WhatsApp).
 */

import type { Channel, Incident, Priority, QuietHours, Settings, Team } from "./contracts";
import { lessUrgentThan } from "./priority";
import { inWeeklyWindow, safeTimeZone } from "./time/tz";

export const LOW_URGENCY_CHANNELS: readonly Channel[] = ["slack", "teams", "telegram", "ifttt", "webhook"];

/** The quiet-hours window that applies at `now` (hold beats low-urgency), if any. */
export function activeQuietHours(team: Team | undefined, priority: Priority, now: number): QuietHours | undefined {
  let found: QuietHours | undefined;
  for (const qh of team?.quietHours ?? []) {
    if (!lessUrgentThan(priority, qh.minPriority)) continue;
    if (!inWeeklyWindow(now, qh, safeTimeZone(qh.timeZone))) continue;
    if (qh.mode === "hold") return qh;
    found = found ?? qh;
  }
  return found;
}

export function maintenanceSuppressed(inc: Incident, settings: Settings): boolean {
  return inc.alert.underMaintenance && !settings.sources.davisProblems.pageDuringMaintenance;
}

export interface PagingState {
  /** False when nothing may be sent now. */
  page: boolean;
  /** Value for Incident.suppressed (undefined = not suppressed). */
  suppressed?: Incident["suppressed"];
  /** When set, only these channels may be used (low-urgency quiet hours). */
  allowedChannels?: readonly Channel[];
}

export function pagingState(inc: Incident, team: Team | undefined, settings: Settings, now: number): PagingState {
  if (inc.suppressed === "rule") return { page: false, suppressed: "rule" };
  if (maintenanceSuppressed(inc, settings)) return { page: false, suppressed: "maintenance" };
  const qh = activeQuietHours(team, inc.priority, now);
  if (qh?.mode === "hold") return { page: false, suppressed: "quiet-hours" };
  if (qh) return { page: true, suppressed: "quiet-hours", allowedChannels: LOW_URGENCY_CHANNELS };
  return { page: true };
}
