/**
 * App function `incidents` — read-only summary of incidents, for scripts and health checks.
 *   POST .../api/incidents  {}                          → newest 200 incidents
 *   POST .../api/incidents  { "status": "triggered" }    → filtered by status
 * Returns no contact data and no timeline; runs with the caller's permissions.
 */
import type { IncidentStatus } from "../ui/app/domain/contracts";
import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { createStore } from "../ui/app/data/store";

/** One incident as returned to scripts: identifiers, status and timestamps (epoch ms) only. */
export interface IncidentSummary {
  id: string;
  displayId?: string;
  title: string;
  source: string;
  status: IncidentStatus;
  priority: string;
  teamId?: string;
  createdAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export default async function (payload: { status?: IncidentStatus } = {}): Promise<{ incidents: IncidentSummary[] }> {
  const list = await createStore(new AppStateRepository()).listIncidents();
  return {
    incidents: list
      .filter((i) => !payload.status || i.status === payload.status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200)
      .map((i) => ({
        id: i.id,
        displayId: i.alert.displayId,
        title: i.alert.title,
        source: i.alert.source,
        status: i.status,
        priority: i.priority,
        teamId: i.teamId,
        createdAt: i.createdAt,
        acknowledgedAt: i.acknowledgedAt,
        resolvedAt: i.resolvedAt,
        resolvedBy: i.resolvedBy,
      })),
  };
}
