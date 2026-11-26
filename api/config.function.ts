/**
 * App function `config` — configuration as code.
 *
 *   POST /platform/app-engine/app-functions/v1/apps/<appId>/api/config
 *   { "op": "export" }                                   → whole configuration bundle
 *   { "op": "import", "bundle": {...}, "dryRun": true }  → validate (and write unless dryRun)
 *
 * Runs with the caller's permissions (state:app-states:read/write via the app's scopes).
 */

import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { runConfig, type ConfigRequest, type ConfigResponse } from "./lib/config";

export default async function (payload: ConfigRequest = { op: "export" }): Promise<ConfigResponse> {
  return runConfig(payload, new AppStateRepository());
}
