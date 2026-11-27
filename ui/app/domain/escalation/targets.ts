/**
 * Expand escalation targets to IAM uids.
 * - schedule → whoever is on call at the given instant (overrides and layers applied)
 * - user     → that uid
 * - team     → members whose role is not "observer"
 */

import type { EscalationTarget, Schedule, Team } from "../contracts";
import { onCallUids } from "../schedule/resolve";

/** Data needed to resolve schedule and team targets. */
export interface TargetContext {
  schedules: Schedule[];
  teams: Team[];
}

export interface ExpandedTarget {
  uid: string;
  /** How this uid was reached (first target that produced it). */
  via: EscalationTarget;
}

/** Uids one target reaches at `at` (epoch ms): schedules are resolved at that instant. */
export function expandTarget(target: EscalationTarget, ctx: TargetContext, at: number): string[] {
  switch (target.type) {
    case "user":
      return target.uid ? [target.uid] : [];
    case "schedule":
      return onCallUids(ctx.schedules, target.scheduleId, at);
    case "team": {
      const team = ctx.teams.find((t) => t.id === target.teamId);
      return team ? team.members.filter((m) => m.role !== "observer").map((m) => m.uid) : [];
    }
    default:
      return [];
  }
}

/** Unique uids for a list of targets, in target order. */
export function expandTargets(targets: EscalationTarget[], ctx: TargetContext, at: number): ExpandedTarget[] {
  const seen = new Set<string>();
  const out: ExpandedTarget[] = [];
  for (const t of targets) {
    for (const uid of expandTarget(t, ctx, at)) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      out.push({ uid, via: t });
    }
  }
  return out;
}

/** Human label for a target (UI and timeline). */
export function describeTarget(
  target: EscalationTarget,
  names: { schedules?: Schedule[]; teams?: Team[]; userName?: (uid: string) => string | undefined } = {},
): string {
  switch (target.type) {
    case "user":
      return names.userName?.(target.uid) ?? target.uid;
    case "schedule":
      return `On-call: ${names.schedules?.find((s) => s.id === target.scheduleId)?.name ?? target.scheduleId}`;
    case "team":
      return `Team: ${names.teams?.find((t) => t.id === target.teamId)?.name ?? target.teamId}`;
    default:
      return "unknown";
  }
}
