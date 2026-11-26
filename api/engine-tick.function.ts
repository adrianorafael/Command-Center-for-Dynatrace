/**
 * App function `engine-tick` — called every minute by the "Command Center · Engine" workflow
 * (`fetch('/apps/<appId>/api/engine-tick', { method: 'POST', body })`).
 * Default export receives the request body as `payload` (dt-app function template:
 * node_modules/dt-app/lib/src/function/template/function.ts).
 */

import { getAppId, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import type { EngineTickRequest } from "../ui/app/domain/contracts";
import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { runQuery } from "../ui/app/data/grail";
import { runEngineTick, type EngineTickResult } from "./lib/engine";

/** Absolute UI base for links in messages; undefined when the runtime does not expose it. */
export function appBaseUrl(): string | undefined {
  try {
    const env = getEnvironmentUrl();
    const app = getAppId();
    if (!env || env.startsWith("dt.missing") || !app || app.startsWith("dt.missing")) return undefined;
    return `${env.replace(/\/+$/, "")}/ui/apps/${app}`;
  } catch {
    return undefined;
  }
}

export default async function (payload: EngineTickRequest = { reason: "manual" }): Promise<EngineTickResult> {
  return runEngineTick(payload, {
    repo: new AppStateRepository(),
    runQuery,
    appBaseUrl: appBaseUrl(),
  });
}
