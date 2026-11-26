/**
 * The single seam between the data layer and the pure domain core (agent A's modules):
 * if a domain signature changes, only this file (and demoPort.ts for fixtures) needs to follow.
 * Kept free of demo fixtures so the app functions do not bundle them.
 */

import type { Settings } from "../domain/contracts";
import { defaultSettings as domainDefaultSettings } from "../domain/validation/defaults";

/**
 * Fixed id of the engine workflow (settings.engine.workflowId) when none is stored.
 * Workflow ids are per tenant, so one well-known UUID lets the installer find "its" workflow
 * again (get → update; trash → restore) without any extra bookkeeping.
 */
export const DEFAULT_ENGINE_WORKFLOW_ID = "6f1c9a52-3d2e-4b7a-9c41-cc2e5a0d7e01";

/**
 * Lease TTL must exceed the longest tick (queries ≤ ~50 s + writes; function limit 120 s), or a
 * second tick can start while the first is still writing.
 */
export const MIN_LOCK_TTL_SEC = 130;
export const DEFAULT_LOCK_TTL_SEC = 150;

export function defaultSettings(): Settings {
  const s = domainDefaultSettings();
  if (!s.engine.workflowId) s.engine.workflowId = DEFAULT_ENGINE_WORKFLOW_ID;
  if (!(s.engine.lockTtlSec >= MIN_LOCK_TTL_SEC)) s.engine.lockTtlSec = DEFAULT_LOCK_TTL_SEC;
  return s;
}
