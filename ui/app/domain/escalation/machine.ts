/**
 * Escalation state machine.
 *
 * Timing (all relative to `incident.escalation.startedAt` of the current cycle):
 * - Step i of a pass fires `offset(i)` after the pass start, where offset(i) is the sum of
 *   delayMinutes of steps 0…i (step 0's delay is "after the incident triggered").
 * - The policy repeats `repeat` more times. A pass lasts `offset(last) + gap`, where the
 *   repeat gap is the last step's delay, or DEFAULT_REPEAT_GAP_MINUTES when that is 0
 *   (the contract does not define one; a zero-length pass is impossible).
 * - Every (pass, step) pair has an ordinal = pass × steps.length + stepIndex. The ordinal is
 *   the `step` segment of notification keys, so repeated passes never collide in the ledger.
 * - The policy is exhausted one gap after the last step of the last pass fired.
 */

import type { EscalationPolicy, EscalationProgress, EscalationStep, Incident } from "../contracts";
import { MINUTE_MS } from "../time/tz";

export const DEFAULT_REPEAT_GAP_MINUTES = 5;
/** Hard cap on policy repeats evaluated by the engine. */
export const MAX_REPEAT = 20;

export interface StepFiring {
  ordinal: number;
  pass: number;
  stepIndex: number;
  dueAt: number;
  step: EscalationStep;
}

function delayMs(step: EscalationStep | undefined): number {
  const d = step?.delayMinutes;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d * MINUTE_MS : 0;
}

/** Cumulative offsets (ms) of each step from the pass start. */
export function stepOffsetsMs(policy: EscalationPolicy): number[] {
  let acc = 0;
  return policy.steps.map((s) => (acc += delayMs(s)));
}

export function repeatGapMs(policy: EscalationPolicy): number {
  const last = policy.steps[policy.steps.length - 1];
  return delayMs(last) || DEFAULT_REPEAT_GAP_MINUTES * MINUTE_MS;
}

export function passLengthMs(policy: EscalationPolicy): number {
  const offsets = stepOffsetsMs(policy);
  return (offsets[offsets.length - 1] ?? 0) + repeatGapMs(policy);
}

export function passCount(policy: EscalationPolicy): number {
  const r = Number.isFinite(policy.repeat) ? Math.floor(policy.repeat) : 0;
  return Math.min(MAX_REPEAT, Math.max(0, r)) + 1;
}

export function totalOrdinals(policy: EscalationPolicy): number {
  return policy.steps.length * passCount(policy);
}

/** The (pass, step) for an ordinal of the current cycle. */
export function firingFor(policy: EscalationPolicy, startedAt: number, ordinal: number): StepFiring | undefined {
  const n = policy.steps.length;
  if (n === 0 || ordinal < 0 || ordinal >= totalOrdinals(policy)) return undefined;
  const pass = Math.floor(ordinal / n);
  const stepIndex = ordinal % n;
  const step = policy.steps[stepIndex];
  if (!step) return undefined;
  const offsets = stepOffsetsMs(policy);
  const dueAt = startedAt + pass * passLengthMs(policy) + (offsets[stepIndex] ?? 0);
  return { ordinal, pass, stepIndex, dueAt, step };
}

/** Every firing of the cycle (whether due or not). */
export function allFirings(policy: EscalationPolicy, startedAt: number): StepFiring[] {
  const out: StepFiring[] = [];
  const total = totalOrdinals(policy);
  for (let o = 0; o < total; o++) {
    const f = firingFor(policy, startedAt, o);
    if (f) out.push(f);
  }
  return out;
}

/** Firings with dueAt ≤ now in the current cycle (already fired or newly due). */
export function dueFirings(policy: EscalationPolicy, startedAt: number, now: number): StepFiring[] {
  return allFirings(policy, startedAt).filter((f) => f.dueAt <= now);
}

/** Highest ordinal already marked fired in the progress (-1 = none). */
export function doneOrdinal(progress: EscalationProgress, policy: EscalationPolicy): number {
  if (progress.lastStepIndex < 0) return -1;
  return progress.repeatsDone * policy.steps.length + progress.lastStepIndex;
}

/** When the policy counts as exhausted for this cycle. */
export function exhaustedAt(policy: EscalationPolicy, startedAt: number): number | undefined {
  if (policy.steps.length === 0) return undefined;
  return startedAt + passCount(policy) * passLengthMs(policy);
}

export interface EscalationAdvance {
  progress: EscalationProgress;
  /** Firings that became due since the last recorded progress. */
  newlyDue: StepFiring[];
  /** All due firings of the cycle (for ledger-based planning). */
  due: StepFiring[];
  /** True when exhaustion was reached during this evaluation. */
  becameExhausted: boolean;
  /** Next firing time (for UI), if any. */
  nextDueAt?: number;
}

/** Evaluate the policy for the incident at `now`; returns the updated progress. */
export function advanceEscalation(incident: Incident, policy: EscalationPolicy, now: number): EscalationAdvance {
  const prog = incident.escalation;
  const all = allFirings(policy, prog.startedAt);
  const due = all.filter((f) => f.dueAt <= now);
  const done = doneOrdinal(prog, policy);
  const newlyDue = due.filter((f) => f.ordinal > done);
  const last = due[due.length - 1];
  const progress: EscalationProgress = { ...prog };
  if (last && last.ordinal > done) {
    progress.lastStepIndex = last.stepIndex;
    progress.repeatsDone = last.pass;
  }
  let becameExhausted = false;
  const exAt = exhaustedAt(policy, prog.startedAt);
  if (!prog.exhausted && exAt !== undefined && now >= exAt) {
    progress.exhausted = true;
    becameExhausted = true;
  }
  const next = all.find((f) => f.dueAt > now);
  return { progress, newlyDue, due, becameExhausted, ...(next ? { nextDueAt: next.dueAt } : {}) };
}

/** Simulation for the policy editor: who/when for each firing, relative to t0 = 0. */
export function simulatePolicy(policy: EscalationPolicy): { ordinal: number; pass: number; stepIndex: number; atMinute: number }[] {
  return allFirings(policy, 0).map((f) => ({
    ordinal: f.ordinal,
    pass: f.pass,
    stepIndex: f.stepIndex,
    atMinute: f.dueAt / MINUTE_MS,
  }));
}
