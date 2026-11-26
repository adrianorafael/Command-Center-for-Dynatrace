/**
 * "Command Center · Engine" workflow definition (spec §8).
 *
 * Every field is checked against node_modules/@dynatrace-sdk/client-automation/types/index.d.ts (8.10):
 *  - WorkflowCreate { id?, title, description?, isPrivate?, type?: 'STANDARD'|'SIMPLE', trigger?: TriggerRequest,
 *    tasks?: Tasks, input?, hourlyExecutionLimit?, actor? … }                              l.3674
 *  - WorkflowUpdate: same minus `id`                                                       l.4500
 *  - TriggerRequest { schedule?: ScheduleRequest, eventTrigger? }                          l.3340
 *  - ScheduleRequest { trigger: ScheduleTrigger, rule?, filterParameters?, timezone?, isActive? }  l.1971
 *  - IntervalTrigger { type: 'interval', intervalMinutes ≥ 1, betweenStart?, betweenEnd? } l.1592
 *  - Tasks { [name]: Task }                                                                l.2623
 *  - Task { name?, action, description?, input?, position?, predecessors?, conditions?, retry? … }  l.2469
 *  - TaskConditionOption { states?: {[task]: 'SUCCESS'|'ERROR'|'ANY'|'OK'|'NOK'}, custom?, else?: 'SKIP'|'STOP' }  l.2504
 *  - TaskRetryOption { count, delay?, failedLoopIterationsOnly? }                          l.2606
 *  - TaskPosition { x, y }                                                                 l.2591
 * Action id `dynatrace.automations:run-javascript` with input `{ script }`: spec H4 (use-intents docs)
 * and observed in a live tenant workflow export (2026-11-26).
 *
 * No withItems, http-function inputs or custom condition expressions (UNVERIFIED syntax).
 */

import type { Tasks, WorkflowCreate, WorkflowUpdate } from "@dynatrace-sdk/client-automation";
import type { Settings } from "../../domain/contracts";
import { reportScript, tickScript } from "./scripts/engine";
import { SENDER_TASKS } from "./scripts/senders";

export const ENGINE_WORKFLOW_TITLE = "Command Center · Engine";
export const RUN_JAVASCRIPT = "dynatrace.automations:run-javascript";
/** Bumped whenever the generated definition changes; shown by the installer status. */
export const ENGINE_DEFINITION_VERSION = 2;
export const DEFINITION_MARKER = `[command-center-engine v${ENGINE_DEFINITION_VERSION}]`;

export const TICK_TASK = "tick";
export const REPORT_TASK = "report";

export interface DefinitionOptions {
  appId: string;
  settings: Pick<Settings, "engine" | "providers">;
  /** Optional workflow actor (e.g. a service user uid). Omitted → the platform keeps/assigns one. */
  actor?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWorkflowId(id: string): boolean {
  return UUID_RE.test(id);
}

export function buildEngineTasks(appId: string): Tasks {
  const tasks: Tasks = {
    [TICK_TASK]: {
      name: TICK_TASK,
      action: RUN_JAVASCRIPT,
      description: "Ingest alerts, fold operator actions, escalate and plan notifications (app function engine-tick)",
      input: { script: tickScript(appId) },
      position: { x: 3, y: 1 },
      predecessors: [],
      // No retry: the next interval run is one minute away and a retry could double-plan.
      retry: { count: 0 },
    },
  };
  SENDER_TASKS.forEach((t, i) => {
    tasks[t.name] = {
      name: t.name,
      action: RUN_JAVASCRIPT,
      description: t.description,
      input: { script: t.script },
      position: { x: i, y: 2 },
      predecessors: [TICK_TASK],
      conditions: { states: { [TICK_TASK]: "SUCCESS" }, else: "SKIP" },
      // Never retry a sender: a retry would page people twice. Failures go to the ledger instead.
      retry: { count: 0 },
    };
  });
  tasks[REPORT_TASK] = {
    name: REPORT_TASK,
    action: RUN_JAVASCRIPT,
    description: "Report delivery results to the notification ledger (app function delivery-report)",
    input: { script: reportScript(appId) },
    position: { x: 3, y: 3 },
    predecessors: SENDER_TASKS.map((t) => t.name),
    conditions: {
      states: Object.fromEntries(SENDER_TASKS.map((t) => [t.name, "ANY" as const])),
      else: "SKIP",
    },
    retry: { count: 2, delay: 10 },
  };
  return tasks;
}

/** Body shared by create and update (no `id`: WorkflowUpdate has none; a WorkflowCreate without id is a valid WorkflowUpdate). */
function baseBody(opts: DefinitionOptions): WorkflowCreate {
  return {
    title: ENGINE_WORKFLOW_TITLE,
    description:
      `Paging engine of the Command Center app (${opts.appId}). Runs every minute; do not edit by hand — ` +
      `reinstall from Command Center → Integrations. ${DEFINITION_MARKER}`,
    // Task results contain phone numbers and message text (spec risk 6): keep it private.
    isPrivate: true,
    type: "STANDARD",
    isDeployed: true,
    trigger: {
      schedule: {
        isActive: opts.settings.engine.enabled,
        trigger: { type: "interval", intervalMinutes: 1 },
        rule: null,
        filterParameters: {},
      },
    },
    tasks: buildEngineTasks(opts.appId),
    // Non-secret context for humans reading the workflow; scripts get providers from the tick result.
    input: {
      appId: opts.appId,
      providers: opts.settings.providers.map((p) => ({
        id: p.id,
        channel: p.channel,
        kind: p.kind,
        enabled: p.enabled,
        credentialVaultId: p.credentialVaultId ?? null,
      })),
    },
    // 60 scheduled runs per hour plus manual runs (escalate now, tests).
    hourlyExecutionLimit: 240,
    ...(opts.actor ? { actor: opts.actor } : {}),
  };
}

export function buildEngineWorkflowCreate(opts: DefinitionOptions): WorkflowCreate {
  const id = opts.settings.engine.workflowId;
  if (!isWorkflowId(id)) throw new Error("settings.engine.workflowId must be a UUID");
  return { id, ...baseBody(opts), title: ENGINE_WORKFLOW_TITLE };
}

export function buildEngineWorkflowUpdate(opts: DefinitionOptions): WorkflowUpdate {
  return baseBody(opts);
}
