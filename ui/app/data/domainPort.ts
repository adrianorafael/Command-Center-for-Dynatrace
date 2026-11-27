/**
 * The single seam between the data layer and the pure domain core (ui/app/domain):
 * if a domain signature changes, only this file (and demoPort.ts for fixtures) needs to follow.
 * Kept free of demo fixtures so the app functions do not bundle them.
 */

import type { Settings } from "../domain/contracts";
import { defaultSettings as domainDefaultSettings } from "../domain/validation/defaults";

/**
 * Fixed id of the engine workflow (settings.engine.workflowId) when none is stored.
 * Workflow ids are per tenant, so one well-known UUID lets scripts/install-workflow.mjs find "its" workflow again
 * (get → update; trash → restore) and the in-app status check look it up, without any extra bookkeeping. A workflow
 * created through the Workflows app may get another id; the status check then finds it by title.
 */
export const DEFAULT_ENGINE_WORKFLOW_ID = "6f1c9a52-3d2e-4b7a-9c41-cc2e5a0d7e01";

/**
 * Lease TTL must exceed the longest tick (function limit 120 s), or a second tick can start while
 * the first is still writing — but stay close to it, because a lease that outlives a crashed tick
 * blocks the following minute-ticks. The lease is always released (and verified) in `finally`.
 */
export const MIN_LOCK_TTL_SEC = 130;
/** Lease TTL written into settings that have none (or one below the minimum). */
export const DEFAULT_LOCK_TTL_SEC = 130;

/** Domain default settings plus the data-layer defaults above (engine workflow id, lease TTL floor). */
export function defaultSettings(): Settings {
  const s = domainDefaultSettings();
  if (!s.engine.workflowId) s.engine.workflowId = DEFAULT_ENGINE_WORKFLOW_ID;
  if (!(s.engine.lockTtlSec >= MIN_LOCK_TTL_SEC)) s.engine.lockTtlSec = DEFAULT_LOCK_TTL_SEC;
  return s;
}
