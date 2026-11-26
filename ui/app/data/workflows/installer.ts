/**
 * Engine workflow: status, on-demand runs and an importable definition.
 *
 * VERIFIED on a trial tenant deploy (2026-11-26): "Only apps that are provided by Dynatrace can use
 * the 'automation:workflows:write' scope." → this app can READ and RUN workflows but cannot create
 * or update them. Installation is therefore:
 *   - UI: download the generated JSON (exportDefinition) and import it in the Workflows app (Upload);
 *   - CLI for admins: scripts/install-workflow.mjs (platform token, REST create/update).
 *
 * client-automation 8.10 (node_modules/@dynatrace-sdk/client-automation/types/index.d.ts):
 *  - workflowsClient.getWorkflow({ id }) → Workflow { id, title, version, isDeployed?, lastExecution: Execution|null,
 *    description?, actor? … }                                     l.3992 / l.3627   (automation:workflows:read)
 *  - workflowsClient.getWorkflows({ search?, limit? … }) → { count, results }        (automation:workflows:read)
 *  - workflowsClient.runWorkflow({ id, body: { input?, params?, uniqueQualifier? } }) → Execution
 *    ("No execution created - execution with uniqueQualifier provided already exists")   l.4379 (automation:workflows:run)
 *  - executionsClient.getExecutions({ workflow?: string[], limit? }) → { count, results: Execution[] }  l.1052
 *  - errors: ErrorEnvelopeError extends ClientRequestError (response.status)             l.777
 */

import { executionsClient, workflowsClient } from "@dynatrace-sdk/client-automation";
import type { EngineTickRequest, Settings } from "../../domain/contracts";
import { ENGINE_DEFINITION_VERSION, ENGINE_WORKFLOW_TITLE, buildEngineWorkflowCreate } from "./definition";

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
  exportDefinition(settings: Settings): WorkflowExport;
  /** Path of the Workflows app to import the JSON (relative to the environment). */
  workflowsAppPath(): string;
  getStatus(settings: Settings): Promise<EngineWorkflowStatus>;
  /** Runs the engine now via the workflow (escalate now, test notification). Returns the execution id. */
  runEngineNow(settings: Settings, params: EngineTickRequest, uniqueQualifier?: string): Promise<string | undefined>;
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
  lastExecution?: ExecutionLike | null;
}

/** Subset of WorkflowsClient + ExecutionsClient (injectable for tests). Read + run only. */
export interface AutomationClientLike {
  getWorkflow(c: { id: string }): Promise<WorkflowLike>;
  getWorkflows(c: { search?: string; limit?: number }): Promise<{ results: WorkflowLike[] }>;
  runWorkflow(c: {
    id: string;
    body: { params?: Record<string, unknown>; uniqueQualifier?: string | null };
  }): Promise<{ id?: string } | undefined>;
  getExecutions(c: { workflow?: string[]; limit?: number }): Promise<{ results: ExecutionLike[] }>;
}

const defaultClient: AutomationClientLike = {
  getWorkflow: (c) => workflowsClient.getWorkflow(c),
  getWorkflows: (c) => workflowsClient.getWorkflows(c),
  runWorkflow: (c) => workflowsClient.runWorkflow(c),
  getExecutions: (c) => executionsClient.getExecutions(c),
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

export function exportEngineDefinition(appId: string, settings: Settings): WorkflowExport {
  return {
    fileName: "command-center-engine.workflow.json",
    json: `${JSON.stringify(buildEngineWorkflowCreate({ appId, settings }), null, 2)}\n`,
  };
}

export function createWorkflowInstaller(appId: string, client: AutomationClientLike = defaultClient): EngineInstaller {
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

    exportDefinition(settings) {
      return exportEngineDefinition(appId, settings);
    },

    workflowsAppPath: () => WORKFLOWS_APP_PATH,

    async getStatus(settings) {
      const found = await find(settings);
      if (!found) return { installed: false, outdated: false, recentExecutions: [] };
      const { wf, byTitle } = found;
      const definitionVersion = parseDefinitionVersion(wf.description);
      let recent: ExecutionSummary[] = [];
      try {
        recent = (await client.getExecutions({ workflow: [wf.id], limit: 10 })).results.map(summarize);
      } catch {
        recent = []; // status is still useful without the execution list
      }
      return {
        installed: true,
        workflowId: wf.id,
        ...(byTitle ? { foundByTitle: true } : {}),
        definitionVersion,
        outdated: definitionVersion === undefined || definitionVersion < ENGINE_DEFINITION_VERSION,
        workflowVersion: wf.version,
        isDeployed: wf.isDeployed,
        actor: wf.actor ?? undefined,
        lastExecution: wf.lastExecution ? summarize(wf.lastExecution) : recent[0],
        recentExecutions: recent,
      };
    },

    async runEngineNow(settings, params, uniqueQualifier) {
      const body = {
        params: { ...params },
        ...(uniqueQualifier ? { uniqueQualifier: uniqueQualifier.slice(0, 100) } : {}),
      };
      try {
        return (await client.runWorkflow({ id: settings.engine.workflowId, body }))?.id;
      } catch (e) {
        if (!isNotFoundError(e)) throw e;
        const found = await find(settings); // imported under another id
        if (!found || found.wf.id === settings.engine.workflowId) throw e;
        return (await client.runWorkflow({ id: found.wf.id, body }))?.id;
      }
    },
  };
}

/** Demo mode: nothing leaves the browser. */
export function createDemoInstaller(appId = "my.command.center"): EngineInstaller {
  return {
    install() {
      return Promise.reject(new InstallNotPermittedError());
    },
    exportDefinition(settings) {
      return exportEngineDefinition(appId, settings);
    },
    workflowsAppPath: () => WORKFLOWS_APP_PATH,
    getStatus(settings) {
      const now = Date.now();
      const last = { id: "demo-execution", state: "SUCCESS", startedAt: now - 30_000, endedAt: now - 27_000, triggerType: "Schedule" };
      return Promise.resolve({
        installed: true,
        workflowId: settings.engine.workflowId,
        definitionVersion: ENGINE_DEFINITION_VERSION,
        outdated: false,
        isDeployed: true,
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
