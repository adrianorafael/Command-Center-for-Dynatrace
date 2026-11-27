/**
 * Custom workflow action "Run Command Center engine".
 *
 * Installed as the single task of a Simple workflow, so the engine consumes no workflow hours: each run is one
 * action invocation that does the whole cycle — alerts, escalations, notifications, delivery records. Settings
 * are read from App State, so changing settings never requires editing a workflow. Diagnostics live in the engine
 * heartbeat (Integrations → Workflows), because Simple workflows keep only execution metadata.
 *
 * Two workflows use it:
 *  - "Command Center · Engine" (interval trigger): no input, one cycle per run;
 *  - "Command Center · Engine on problem" (Problem trigger, optional): the task input carries the problem's id and
 *    status, and the run waits until that problem can be read before its cycle (api/lib/problemTrigger.ts).
 */
import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { runGrailQuery } from "../ui/app/data/grail";
import { appBaseUrl, runEngineCycle, type CycleResult } from "../api/lib/cycle";
import { runProblemTriggeredCycle, type ProblemTriggerInput } from "../api/lib/problemTrigger";
import { vaultReader } from "../api/lib/senders";

export default async (payload?: ProblemTriggerInput): Promise<CycleResult> => {
  const deps = {
    repo: new AppStateRepository(),
    // The full result (records + truncation notices), not records only: a scan-limited or sampled source must be
    // marked "truncated" so it never counts as proof that an incident is gone (api/lib/sources.ts).
    runQuery: runGrailQuery,
    appBaseUrl: appBaseUrl(),
    fetch,
    readCredential: vaultReader(fetch),
  };
  const fromProblem = typeof payload?.problemId === "string" && payload.problemId.trim() !== "";
  return fromProblem ? runProblemTriggeredCycle(payload, deps) : runEngineCycle({ reason: "schedule" }, deps);
};
