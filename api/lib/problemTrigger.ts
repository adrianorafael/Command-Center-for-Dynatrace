/**
 * The engine run that the Problem trigger starts ("Command Center · Engine on problem").
 *
 * Measured on a trial tenant (2026-11-27): the trigger fires 1–11 s after the problem event, but the problem record
 * only becomes queryable in Grail 30–40 s after its timestamp. A cycle run at once would not see the problem. So
 * this run waits, inside the same invocation, until the problem can be read in the state the trigger reported, and
 * then runs normal cycles until the incident exists (or is resolved). One success test decides everything: the
 * incident of this problem is in the expected state. When the wait runs out, nothing is lost: the scheduled engine
 * run picks the problem up as before.
 *
 * Cost: one invocation per firing while the run stays within 60 s (the wait budget is 45 s), plus one small query
 * per poll. The trigger fires once when a problem opens and once when it closes.
 */
import type { Incident } from "../../ui/app/domain/contracts";
import { buildProblemStatusQuery } from "../../ui/app/data/dql";
import { asGrailResult, describeError } from "../../ui/app/data/grail";
import { KEY } from "../../ui/app/data/repository";
import { createStore } from "../../ui/app/data/store";
import { incidentIdFor } from "../../ui/app/domain/ids";
import { CYCLE_BUDGET_MS, runEngineCycle, type CycleDeps, type CycleResult } from "./cycle";
import { zeroCounts } from "./engine";

/** Task input of the on-problem workflow: `{{ event()["event.id"] }}` and `{{ event()["event.status"] }}`. */
export interface ProblemTriggerInput {
  problemId?: unknown;
  problemStatus?: unknown;
}

/** How long the run waits for the problem to become readable and for its incident to appear. */
export const PROBLEM_WAIT_MS = 45_000;
/** Pause between two checks. */
export const PROBLEM_POLL_MS = 5_000;

export interface ProblemTriggerDeps extends CycleDeps {
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<unknown>;
  /** Injectable for tests. */
  runCycle?: typeof runEngineCycle;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const upper = (v: unknown): string => (typeof v === "string" ? v.trim().toUpperCase() : "");

export async function runProblemTriggeredCycle(input: ProblemTriggerInput | undefined, deps: ProblemTriggerDeps): Promise<CycleResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? pause;
  const runCycle = deps.runCycle ?? runEngineCycle;
  const started = now();
  // Sending must end before the invocation does, however long this run waited first.
  const cycleDeps: CycleDeps = { ...deps, deadlineAt: started + CYCLE_BUDGET_MS };
  const errors: string[] = [];
  const idle = (skipped: string): CycleResult => ({ ok: true, tickAt: started, skipped, counts: zeroCounts(), sent: 0, failed: 0, deferred: 0, errors });

  const problemId = typeof input?.problemId === "string" ? input.problemId.trim() : "";
  const statusQuery = buildProblemStatusQuery(problemId);
  // No usable problem id (the workflow was run by hand, or its input was edited): a plain cycle.
  if (!statusQuery) return runCycle({ reason: "problem-trigger" }, cycleDeps);

  const closed = upper(input?.problemStatus) === "CLOSED";
  const settings = await createStore(deps.repo).getSettings();
  if (!settings.engine.enabled) return idle("disabled");
  if (!settings.sources.davisProblems.enabled) return idle("problems-source-off");

  const incidentKey = KEY.incident(incidentIdFor({ source: "davis-problem", sourceId: problemId }));
  /** The one success test: the incident of this problem is in the state the trigger reported. */
  const done = async (): Promise<boolean> => {
    const inc = (await deps.repo.get<Incident>(incidentKey).catch(() => undefined))?.value;
    return closed ? inc?.status === "resolved" : !!inc && inc.status !== "resolved";
  };
  /** True once Grail returns the problem in that state. */
  const readable = async (): Promise<boolean> => {
    try {
      const rec = asGrailResult(await deps.runQuery(statusQuery, { timeoutMs: 10_000 })).records[0];
      return rec !== undefined && upper(rec["event.status"]) === (closed ? "CLOSED" : "ACTIVE");
    } catch (e) {
      if (errors.length === 0) errors.push(`problem status: ${describeError(e)}`);
      return false;
    }
  };

  const waitUntil = started + PROBLEM_WAIT_MS;
  let last: CycleResult | undefined;
  for (;;) {
    if (await done()) return last ?? idle("already-handled");
    if (await readable()) {
      last = await runCycle({ reason: "problem-trigger" }, cycleDeps);
      // Done at once when this cycle did it. "locked": another run is doing the same work; the next check sees its result.
      if (!last.skipped && (await done())) return last;
    }
    if (now() + PROBLEM_POLL_MS > waitUntil) break;
    await sleep(PROBLEM_POLL_MS);
  }
  if (await done()) return last ?? idle("already-handled");
  // Not readable in time, or a cycle ran without creating the incident (for example its routing properties
  // were not readable yet): the scheduled run takes over.
  return last ?? idle("problem-not-readable");
}
