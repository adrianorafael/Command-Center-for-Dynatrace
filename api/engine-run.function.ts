/**
 * App function `engine-run` — one full engine cycle on demand ("Run engine now", "Send test").
 * Same code as the workflow action; runs with the caller's permissions.
 *   POST .../api/engine-run  { "reason": "manual" }
 *   POST .../api/engine-run  { "reason": "test", "testRequest": { "providerId", "channel", "address" } }
 */
import type { EngineTickRequest } from "../ui/app/domain/contracts";
import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { runQuery } from "../ui/app/data/grail";
import { appBaseUrl, runEngineCycle, type CycleResult } from "./lib/cycle";
import { vaultReader } from "./lib/senders";

export default async function (payload: EngineTickRequest = { reason: "manual" }): Promise<CycleResult> {
  const reason = payload.reason === "test" ? "test" : "manual";
  return runEngineCycle({ ...payload, reason }, {
    repo: new AppStateRepository(),
    runQuery,
    appBaseUrl: appBaseUrl(),
    fetch,
    readCredential: vaultReader(fetch),
  });
}
