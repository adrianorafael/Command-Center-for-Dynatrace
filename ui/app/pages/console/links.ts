/** Links from an incident to other places: its app route, the Davis problem and the Workflows app. */
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import type { Incident } from "../../domain/contracts";

function envUrl(): string | undefined {
  try {
    const u = getEnvironmentUrl();
    if (!u || u.includes("missing")) return undefined;
    return u.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/** Deep link to this incident inside the app. */
export function incidentLink(id: string): string {
  const base = `${window.location.origin}${window.location.pathname.replace(/\/ui\/.*$/, "/ui")}`;
  return `${base}/incidents/${encodeURIComponent(id)}`;
}

/**
 * Davis problem link. The Problems app id / page token are UNVERIFIED (DESIGN U7),
 * so this falls back to a URL built from the environment URL, as v1 did.
 */
export function problemUrl(inc: Incident): string | undefined {
  if (inc.alert.source !== "davis-problem") return undefined;
  const base = envUrl();
  if (!base) return undefined;
  return `${base}/ui/apps/dynatrace.davis.problems/problem/${encodeURIComponent(inc.alert.sourceId)}`;
}

/** Workflows app link for a workflow id (UNVERIFIED app path, DESIGN U7). */
export function workflowUrl(id: string): string | undefined {
  const base = envUrl();
  if (!base) return undefined;
  return `${base}/ui/apps/dynatrace.automations/workflows/${encodeURIComponent(id)}`;
}
