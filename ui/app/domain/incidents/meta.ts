/**
 * Engine bookkeeping stored on `inc.*` records in addition to the frozen Incident contract.
 * All fields are optional, so older records and the UI (which ignores them) stay compatible.
 * Persisted as part of the Incident JSON; readers that only know `Incident` simply ignore them.
 */

import type { Incident } from "../contracts";

export interface IncidentEngineState {
  /** Consecutive OK source queries that did not return this (resolved) incident's alert. */
  absentTicks?: number;
  /** Paging hold (quiet-hours hold / maintenance) began at this instant; the clock is paused. */
  heldSince?: number;
  /** An operator asked to escalate now: the next step fires on the next tick. */
  escalateRequestedAt?: number;
}

export type EngineIncident = Incident & IncidentEngineState;

export function engineState(inc: Incident): IncidentEngineState {
  return inc as EngineIncident;
}

/** Mutating setter (use on a cloned incident). `undefined` removes the field. */
export function setEngineState(inc: Incident, patch: IncidentEngineState): void {
  const target = inc as EngineIncident;
  for (const [k, v] of Object.entries(patch) as [keyof IncidentEngineState, number | undefined][]) {
    if (v === undefined) delete target[k];
    else target[k] = v;
  }
}
