/**
 * Custom workflow action "Run Command Center engine".
 *
 * Installed as the single task of a Simple workflow (interval trigger), so the engine consumes no workflow
 * hours: each run is one action invocation that does the whole cycle — alerts, escalations, notifications,
 * delivery records. Settings are read from App State, so the action needs no input and changing settings
 * never requires editing the workflow. Diagnostics live in the engine heartbeat (Integrations → Workflow),
 * because Simple workflows keep only execution metadata.
 */
import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { runQuery } from "../ui/app/data/grail";
import { appBaseUrl, runEngineCycle, type CycleResult } from "../api/lib/cycle";
import { vaultReader } from "../api/lib/senders";

export default async (): Promise<CycleResult> =>
  runEngineCycle({ reason: "schedule" }, {
    repo: new AppStateRepository(),
    runQuery,
    appBaseUrl: appBaseUrl(),
    fetch,
    readCredential: vaultReader(fetch),
  });
