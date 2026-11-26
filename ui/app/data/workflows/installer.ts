/**
 * Idempotent installer for the engine workflow + status + on-demand runs.
 *
 * client-automation 8.10 (node_modules/@dynatrace-sdk/client-automation/types/index.d.ts):
 *  - workflowsClient.getWorkflow({ id }) → Workflow { id, version, isDeployed?, lastExecution: Execution|null,
 *    description?, actor?, modificationInfo … }                         l.3992 / l.3627   (automation:workflows:read)
 *  - workflowsClient.updateWorkflow({ id, body: WorkflowUpdate })        l.4019            (automation:workflows:write)
 *  - workflowsClient.createWorkflow({ body: WorkflowCreate })            l.3966            (automation:workflows:write)
 *  - workflowsClient.getTrashedWorkflows() → { count, results: TrashedWorkflow{id,…}[] }   l.3847 / l.1705
 *  - workflowsClient.restoreTrashedWorkflow({ id, body: { isDeployed? } })                 l.3900
 *  - workflowsClient.runWorkflow({ id, body: { input?, params?, uniqueQualifier? } }) → Execution
 *    ("No execution created - execution with uniqueQualifier provided already exists")    l.4379 (automation:workflows:run)
 *  - executionsClient.getExecutions({ workflow?: string[], limit?, … }) → { count, results: Execution[] }  l.1052
 *  - errors: ErrorEnvelopeError extends ClientRequestError (response.status)               l.777
 *
 * Actor: updating a workflow makes the updater its actor unless a service user is set (spec H1/H4),
 * so `actor` is only sent when explicitly chosen.
 */

import { executionsClient, workflowsClient } from "@dynatrace-sdk/client-automation";
import type { EngineTickRequest, Settings } from "../../domain/contracts";
import {
  DEFINITION_MARKER,
  ENGINE_DEFINITION_VERSION,
  buildEngineWorkflowCreate,
  buildEngineWorkflowUpdate,
} from "./definition";

export interface ExecutionSummary {
  id: string;
  state: string;
  startedAt?: number;
  endedAt?: number;
  triggerType?: string;
}

export interface EngineWorkflowStatus {
  installed: boolean;
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

export type InstallOutcome = "created" | "updated" | "restored";

export interface EngineInstaller {
  install(settings: Settings, opts?: { actor?: string }): Promise<InstallOutcome>;
  getStatus(settings: Settings): Promise<EngineWorkflowStatus>;
  /** Runs the engine now via the workflow (escalate now, test notification). Returns the execution id. */
  runEngineNow(settings: Settings, params: EngineTickRequest, uniqueQualifier?: string): Promise<string | undefined>;
}

interface ExecutionLike {
  id: string;
  state: string;
  startedAt?: Date | string;
  endedAt?: Date | string | null;
  triggerType?: string;
}

/** Subset of WorkflowsClient + ExecutionsClient (injectable for tests). */
export interface AutomationClientLike {
  getWorkflow(c: { id: string }): Promise<{
    id: string;
    version?: number;
    isDeployed?: boolean;
    description?: string;
    actor?: string | null;
    lastExecution?: ExecutionLike | null;
  }>;
  updateWorkflow(c: { id: string; body: ReturnType<typeof buildEngineWorkflowUpdate> }): Promise<unknown>;
  createWorkflow(c: { body: ReturnType<typeof buildEngineWorkflowCreate> }): Promise<unknown>;
  getTrashedWorkflows(): Promise<{ results: { id: string }[] }>;
  restoreTrashedWorkflow(c: { id: string; body: { isDeployed?: boolean } }): Promise<unknown>;
  runWorkflow(c: {
    id: string;
    body: { params?: Record<string, unknown>; uniqueQualifier?: string | null };
  }): Promise<{ id?: string } | undefined>;
  getExecutions(c: { workflow?: string[]; limit?: number }): Promise<{ results: ExecutionLike[] }>;
}

const defaultClient: AutomationClientLike = {
  getWorkflow: (c) => workflowsClient.getWorkflow(c),
  updateWorkflow: (c) => workflowsClient.updateWorkflow(c),
  createWorkflow: (c) => workflowsClient.createWorkflow(c),
  getTrashedWorkflows: () => workflowsClient.getTrashedWorkflows(),
  restoreTrashedWorkflow: (c) => workflowsClient.restoreTrashedWorkflow(c),
  runWorkflow: (c) => workflowsClient.runWorkflow(c),
  getExecutions: (c) => executionsClient.getExecutions(c),
};

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

export function createWorkflowInstaller(appId: string, client: AutomationClientLike = defaultClient): EngineInstaller {
  return {
    async install(settings, opts = {}) {
      const id = settings.engine.workflowId;
      const def = { appId, settings, actor: opts.actor };
      try {
        await client.getWorkflow({ id });
        await client.updateWorkflow({ id, body: buildEngineWorkflowUpdate(def) });
        return "updated";
      } catch (e) {
        if (!isNotFoundError(e)) throw e;
      }
      const trashed = await client.getTrashedWorkflows();
      if (trashed.results.some((w) => w.id === id)) {
        await client.restoreTrashedWorkflow({ id, body: { isDeployed: true } });
        await client.updateWorkflow({ id, body: buildEngineWorkflowUpdate(def) });
        return "restored";
      }
      await client.createWorkflow({ body: buildEngineWorkflowCreate(def) });
      return "created";
    },

    async getStatus(settings) {
      const id = settings.engine.workflowId;
      let wf;
      try {
        wf = await client.getWorkflow({ id });
      } catch (e) {
        if (isNotFoundError(e)) return { installed: false, outdated: false, recentExecutions: [] };
        throw e;
      }
      const definitionVersion = parseDefinitionVersion(wf.description);
      let recent: ExecutionSummary[] = [];
      try {
        recent = (await client.getExecutions({ workflow: [id], limit: 10 })).results.map(summarize);
      } catch {
        recent = []; // status still useful without the execution list
      }
      return {
        installed: true,
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
      const ex = await client.runWorkflow({
        id: settings.engine.workflowId,
        body: {
          params: { ...params },
          ...(uniqueQualifier ? { uniqueQualifier: uniqueQualifier.slice(0, 100) } : {}),
        },
      });
      return ex?.id;
    },
  };
}

/** Demo mode: nothing leaves the browser. */
export function createDemoInstaller(): EngineInstaller {
  let installed = false;
  return {
    install() {
      const was = installed;
      installed = true;
      return Promise.resolve(was ? "updated" : "created");
    },
    getStatus() {
      const now = Date.now();
      return Promise.resolve({
        installed,
        definitionVersion: installed ? ENGINE_DEFINITION_VERSION : undefined,
        outdated: false,
        recentExecutions: installed
          ? [{ id: "demo-execution", state: "SUCCESS", startedAt: now - 30_000, endedAt: now - 27_000, triggerType: "Schedule" }]
          : [],
        lastExecution: installed
          ? { id: "demo-execution", state: "SUCCESS", startedAt: now - 30_000, endedAt: now - 27_000, triggerType: "Schedule" }
          : undefined,
        demo: true,
      });
    },
    runEngineNow() {
      return Promise.resolve(undefined);
    },
  };
}

export { DEFINITION_MARKER };
