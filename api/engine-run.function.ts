/**
 * App function `engine-run` — one full engine cycle on demand ("Run engine now", "Send test").
 * Same code as the workflow action; runs with the caller's permissions.
 *   POST .../api/engine-run  { "reason": "manual" }
 *   POST .../api/engine-run  { "reason": "test", "testRequest": { "providerId", "channel", "address" } }
 */
import type { EngineTickRequest } from "../ui/app/domain/contracts";
import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { runGrailQuery } from "../ui/app/data/grail";
import { appBaseUrl, runEngineCycle, type CycleResult } from "./lib/cycle";
import { vaultReader } from "./lib/senders";

/** A scheduled cycle may hold the engine lease for a few seconds: retry briefly instead of failing. */
const LOCK_RETRIES = 4;
const LOCK_WAIT_MS = 5_000;

export default async function (payload: EngineTickRequest = { reason: "manual" }): Promise<CycleResult> {
  const reason = payload.reason === "test" ? "test" : "manual";
  // runGrailQuery, not runQuery: truncation notices must reach the engine (see actions/run-engine.action.ts).
  const deps = { repo: new AppStateRepository(), runQuery: runGrailQuery, appBaseUrl: appBaseUrl(), fetch, readCredential: vaultReader(fetch) };
  let result = await runEngineCycle({ ...payload, reason }, deps);
  for (let i = 0; i < LOCK_RETRIES && result.skipped === "locked"; i++) {
    await new Promise((r) => setTimeout(r, LOCK_WAIT_MS));
    result = await runEngineCycle({ ...payload, reason }, deps);
  }
  return result;
}
