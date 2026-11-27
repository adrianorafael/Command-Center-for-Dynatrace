/**
 * Engine workflow: status, installation and on-demand runs.
 *
 * - The app cannot create workflows itself: VERIFIED on deploy (2026-11-26) "Only apps that are provided by
 *   Dynatrace can use the 'automation:workflows:write' scope."
 * - Installation = the Workflows "create workflow" intent (developer.dynatrace.com/develop/workflows/use-intents):
 *   sendIntent({ title, tasks, trigger }) opens the Workflows app pre-filled; the person reviews and saves it.
 *   Per @dynatrace-sdk/navigation, undeclared payload properties are removed before delivery. Fallbacks: the
 *   JSON download (Workflows → Upload) and scripts/install-workflow.mjs for admins with a platform token.
 * - Status: workflowsClient.getWorkflow / getWorkflows (automation:workflows:read). Simple workflows keep only
 *   execution metadata, so engine health comes from the app's own heartbeat (hb.engine), not execution lists.
 * - On-demand runs ("Run engine now", tests) call the app function `engine-run` (same code as the action).
 * - Custom integration: a customer-owned simple workflow, created the same way (intent / JSON), that the engine runs
 *   once per notification (automation:workflows:run, api/lib/senders.ts).
 */

import { workflowsClient } from "@dynatrace-sdk/client-automation";
import { functions } from "@dynatrace-sdk/app-utils";
import { sendIntent } from "@dynatrace-sdk/navigation";
import type { EngineTickRequest, Settings } from "../../domain/contracts";
import { CUSTOM_WORKFLOW_TITLE, ENGINE_DEFINITION_VERSION, ENGINE_WORKFLOW_TITLE, actionId, buildCustomWorkflow, buildEngineWorkflow, buildEngineWorkflowCreate } from "./definition";

export interface ExecutionSummary {
  id: string;
  state: string;
  startedAt?: number;
  endedAt?: number;
  triggerType?: string;
}

export interface EngineWorkflowStatus {
  installed: boolean;
  /** Id of the workflow found (fixed id, or found by title when imported under a new id). */
  workflowId?: string;
  /** True when found by title, not by settings.engine.workflowId — save this id in Settings. */
  foundByTitle?: boolean;
  /** Definition version found in the workflow description, if any. */
  definitionVersion?: number;
  /** True when the installed definition is older than this build's. */
  outdated: boolean;
  workflowVersion?: number;
  isDeployed?: boolean;
  /** "SIMPLE" (no workflow hours) or "STANDARD". */
  type?: string;
  /** Interval of the installed workflow's schedule trigger, in minutes. */
  intervalMinutes?: number;
  /** True when the workflow's task is this app's run-engine action. */
  usesAction?: boolean;
  actor?: string;
  lastExecution?: ExecutionSummary;
  recentExecutions: ExecutionSummary[];
  demo?: boolean;
}

/** Kept for API compatibility; the app cannot install workflows itself (see header). */
export type InstallOutcome = "created" | "updated" | "restored";

export interface WorkflowExport {
  fileName: string;
  /** Pretty-printed WorkflowCreate JSON for Workflows → Upload. */
  json: string;
}

export interface EngineInstaller {
  /**
   * Not possible from a custom app (automation:workflows:write is reserved for Dynatrace apps).
   * Always rejects with InstallNotPermittedError — use exportDefinition() or the CLI.
   */
  install(settings: Settings, opts?: { actor?: string }): Promise<InstallOutcome>;
  /** The engine workflow JSON for this app id and these settings (no secrets). */
  exportDefinition(settings: Settings, intervalMinutes?: number): WorkflowExport;
  /** Path of the Workflows app to import the JSON (relative to the environment). */
  workflowsAppPath(): string;
  getStatus(settings: Settings): Promise<EngineWorkflowStatus>;
  /** Opens the Workflows app with the engine workflow pre-filled (create workflow intent). */
  openInstallIntent(settings: Settings, intervalMinutes?: number): void;
  /** Runs one full engine cycle now through the app function engine-run (manual run, test notification). */
  runEngineNow(settings: Settings, params: EngineTickRequest): Promise<EngineRunSummary | undefined>;
}

export interface EngineRunSummary {
  ok: boolean;
  sent: number;
  failed: number;
  deferred: number;
  errors: string[];
  skipped?: string;
}

export class InstallNotPermittedError extends Error {
  constructor() {
    super(
      "Custom apps cannot create or update workflows (automation:workflows:write is reserved for Dynatrace apps). " +
        "Download the workflow JSON and import it in the Workflows app, or ask an admin to run scripts/install-workflow.mjs.",
    );
    this.name = "InstallNotPermittedError";
  }
}

interface ExecutionLike {
  id: string;
  state: string;
  startedAt?: Date | string;
  endedAt?: Date | string | null;
  triggerType?: string;
}

interface WorkflowLike {
  id: string;
  title?: string;
  version?: number;
  isDeployed?: boolean;
  description?: string;
  actor?: string | null;
  type?: string;
  tasks?: Record<string, { action?: string }>;
  trigger?: { schedule?: { trigger?: { intervalMinutes?: number } | null } | null } | null;
  lastExecution?: ExecutionLike | null;
}

/** Subset of WorkflowsClient (injectable for tests). Read only. */
export interface AutomationClientLike {
  getWorkflow(c: { id: string }): Promise<WorkflowLike>;
  getWorkflows(c: { search?: string; limit?: number }): Promise<{ results: WorkflowLike[] }>;
}

const defaultClient: AutomationClientLike = {
  getWorkflow: (c) => workflowsClient.getWorkflow(c) as Promise<WorkflowLike>,
  getWorkflows: (c) => workflowsClient.getWorkflows(c) as Promise<{ results: WorkflowLike[] }>,
};

/** Runs one engine cycle through the app function (injectable for tests). */
export type EngineRunner = (params: EngineTickRequest) => Promise<EngineRunSummary | undefined>;

const defaultRunner: EngineRunner = async (params) => {
  const res = await functions.call("engine-run", { data: params });
  return (await res.json()) as EngineRunSummary;
};

/** Workflows app (UNVERIFIED path; the app id `dynatrace.automations` matches the action id prefix). */
export const WORKFLOWS_APP_PATH = "/ui/apps/dynatrace.automations/workflows";

export function isNotFoundError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const r = (e as { response?: { status?: unknown } }).response;
  if (r && r.status === 404) return true;
  return (e as { isNotFound?: unknown }).isNotFound === true;
}

function epoch(t: Date | string | null | undefined): number | undefined {
  if (t === null || t === undefined) return undefined;
  const ms = t instanceof Date ? t.getTime() : Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}

function summarize(e: ExecutionLike): ExecutionSummary {
  return {
    id: e.id,
    state: e.state,
    startedAt: epoch(e.startedAt),
    endedAt: epoch(e.endedAt),
    triggerType: e.triggerType,
  };
}

export function parseDefinitionVersion(description: string | undefined): number | undefined {
  const m = /\[command-center-engine v(\d+)\]/.exec(description ?? "");
  return m ? Number(m[1]) : undefined;
}

export function exportEngineDefinition(appId: string, settings: Settings, intervalMinutes?: number): WorkflowExport {
  return {
    fileName: "command-center-engine.workflow.json",
    json: `${JSON.stringify(buildEngineWorkflowCreate({ appId, settings, intervalMinutes }), null, 2)}\n`,
  };
}

/** The prefilled custom-integration workflow as a file for Workflows → Upload. */
export function exportCustomWorkflow(appId: string): WorkflowExport {
  return { fileName: "command-center-custom-integration.workflow.json", json: `${JSON.stringify(buildCustomWorkflow(appId), null, 2)}\n` };
}

/** Opens the Workflows app with the custom-integration workflow prefilled (create workflow intent). */
export function openCustomWorkflowIntent(appId: string): void {
  sendIntent(buildCustomWorkflow(appId));
}

export interface CustomWorkflowInfo {
  id: string;
  type?: string;
}

/** Finds custom-integration workflows by title (newest first), to offer their id. */
export async function findCustomWorkflows(client: AutomationClientLike = defaultClient): Promise<CustomWorkflowInfo[]> {
  const list = await client.getWorkflows({ search: CUSTOM_WORKFLOW_TITLE, limit: 20 });
  return list.results.filter((w) => w.title === CUSTOM_WORKFLOW_TITLE).map((w) => ({ id: w.id, ...(w.type ? { type: w.type } : {}) }));
}

export function createWorkflowInstaller(appId: string, client: AutomationClientLike = defaultClient, runner: EngineRunner = defaultRunner): EngineInstaller {
  async function find(settings: Settings): Promise<{ wf: WorkflowLike; byTitle: boolean } | undefined> {
    try {
      return { wf: await client.getWorkflow({ id: settings.engine.workflowId }), byTitle: false };
    } catch (e) {
      if (!isNotFoundError(e)) throw e;
    }
    // Imported through the Workflows app the id may differ: look it up by title.
    const list = await client.getWorkflows({ search: ENGINE_WORKFLOW_TITLE, limit: 20 });
    const hit = list.results.find((w) => w.title === ENGINE_WORKFLOW_TITLE);
    if (!hit) return undefined;
    try {
      return { wf: await client.getWorkflow({ id: hit.id }), byTitle: true };
    } catch {
      return { wf: hit, byTitle: true };
    }
  }

  return {
    install() {
      return Promise.reject(new InstallNotPermittedError());
    },

    exportDefinition(settings, intervalMinutes) {
      return exportEngineDefinition(appId, settings, intervalMinutes);
    },

    workflowsAppPath: () => WORKFLOWS_APP_PATH,

    async getStatus(settings) {
      const found = await find(settings);
      if (!found) return { installed: false, outdated: false, recentExecutions: [] };
      const { wf, byTitle } = found;
      const definitionVersion = parseDefinitionVersion(wf.description);
      const recent: ExecutionSummary[] = [];
      const usesAction = Object.values(wf.tasks ?? {}).some((t) => t.action === actionId(appId));
      return {
        installed: true,
        workflowId: wf.id,
        ...(byTitle ? { foundByTitle: true } : {}),
        definitionVersion,
        outdated: definitionVersion === undefined || definitionVersion < ENGINE_DEFINITION_VERSION || !usesAction,
        workflowVersion: wf.version,
        isDeployed: wf.isDeployed,
        type: wf.type,
        usesAction,
        ...(wf.trigger?.schedule?.trigger?.intervalMinutes ? { intervalMinutes: wf.trigger.schedule.trigger.intervalMinutes } : {}),
        actor: wf.actor ?? undefined,
        lastExecution: wf.lastExecution ? summarize(wf.lastExecution) : recent[0],
        recentExecutions: recent,
      };
    },

    openInstallIntent(settings, intervalMinutes) {
      sendIntent(buildEngineWorkflow({ appId, settings, intervalMinutes }));
    },

    runEngineNow(_settings, params) {
      return runner(params);
    },
  };
}

/** Demo mode: nothing leaves the browser. */
export function createDemoInstaller(appId = "my.command.center"): EngineInstaller {
  return {
    install() {
      return Promise.reject(new InstallNotPermittedError());
    },
    exportDefinition(settings, intervalMinutes) {
      return exportEngineDefinition(appId, settings, intervalMinutes);
    },
    workflowsAppPath: () => WORKFLOWS_APP_PATH,
    openInstallIntent() {
      // demo: nothing leaves the browser
    },
    getStatus(settings) {
      const now = Date.now();
      const last = { id: "demo-execution", state: "SUCCESS", startedAt: now - 30_000, endedAt: now - 27_000, triggerType: "Schedule" };
      return Promise.resolve({
        installed: true,
        workflowId: settings.engine.workflowId,
        definitionVersion: ENGINE_DEFINITION_VERSION,
        outdated: false,
        isDeployed: true,
        type: "SIMPLE",
        usesAction: true,
        recentExecutions: [last],
        lastExecution: last,
        demo: true,
      });
    },
    runEngineNow() {
      return Promise.resolve(undefined);
    },
  };
}
