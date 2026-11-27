/**
 * "Command Center · Engine" workflow definition — a SIMPLE workflow.
 *
 * Why simple: per the Dynatrace licensing docs (docs.dynatrace.com → License → Capabilities → Automation),
 * standard workflows consume workflow hours for every hour they exist, and every task execution is a billable
 * Standard Function Call; simple workflows consume no workflow hours. A simple workflow allows exactly one task,
 * any trigger, and any action except Run JavaScript / Run Workflow / Approval
 * (docs.dynatrace.com → Workflows → Build → Create a simple workflow). The task is therefore this app's custom
 * action `run-engine` (actions/run-engine.action.ts), which runs the whole cycle in one invocation.
 * Verified on a trial tenant (2026-11-27): POST /platform/automation/v1/workflows with type "SIMPLE" and the
 * action `my.command.center:run-engine` was accepted, ran (one ACTION invocation in the billing events), read and
 * wrote App State, queried Grail, read a Credential Vault secret and reached an external host.
 *
 * Field shapes: node_modules/@dynatrace-sdk/client-automation/types/index.d.ts (WorkflowCreate, Task,
 * IntervalTrigger, EventTriggerConfig). The same object is the payload of the Workflows "create workflow" intent
 * (developer.dynatrace.com/develop/workflows/use-intents: title, tasks, trigger).
 */

import type { WorkflowCreate, WorkflowUpdate } from "@dynatrace-sdk/client-automation";
import type { Settings } from "../../domain/contracts";

export const ENGINE_WORKFLOW_TITLE = "Command Center · Engine";
export const RUN_ENGINE_ACTION = "run-engine";
/** Bumped whenever the generated definition changes; shown by the installer status. */
export const ENGINE_DEFINITION_VERSION = 3;
export const DEFINITION_MARKER = `[command-center-engine v${ENGINE_DEFINITION_VERSION}]`;
export const ENGINE_TASK = "run_engine";
/** Engine interval choices offered in Settings (minutes). Escalation timing granularity equals the interval. */
export const ENGINE_INTERVALS = [1, 2, 5] as const;

export interface DefinitionOptions {
  appId: string;
  settings: Pick<Settings, "engine">;
  /** Interval in minutes (default 1). */
  intervalMinutes?: number;
  /** Optional workflow actor (e.g. a service user uid). Omitted → the platform assigns the creator. */
  actor?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWorkflowId(id: string): boolean {
  return UUID_RE.test(id);
}

export function actionId(appId: string): string {
  return `${appId}:${RUN_ENGINE_ACTION}`;
}

/** The workflow object shared by the intent, the JSON download, the admin script and the API. */
export function buildEngineWorkflow(opts: DefinitionOptions): Pick<WorkflowCreate, "title" | "description" | "type" | "isPrivate" | "trigger" | "tasks"> {
  const interval = ENGINE_INTERVALS.includes((opts.intervalMinutes ?? 1) as (typeof ENGINE_INTERVALS)[number]) ? (opts.intervalMinutes ?? 1) : 1;
  return {
    title: ENGINE_WORKFLOW_TITLE,
    description:
      `Paging engine of the Command Center app (${opts.appId}). Simple workflow: one task, no workflow hours. ` +
      `Runs every ${interval} minute${interval === 1 ? "" : "s"}. ${DEFINITION_MARKER}`,
    type: "SIMPLE",
    isPrivate: false,
    trigger: {
      schedule: {
        isActive: opts.settings.engine.enabled,
        trigger: { type: "interval", intervalMinutes: interval },
        rule: null,
        filterParameters: {},
      },
    },
    tasks: {
      [ENGINE_TASK]: {
        name: ENGINE_TASK,
        action: actionId(opts.appId),
        description: "One Command Center cycle: alerts, escalations, notifications, delivery records",
        input: {},
        position: { x: 0, y: 1 },
        predecessors: [],
      },
    },
  };
}

export function buildEngineWorkflowCreate(opts: DefinitionOptions): WorkflowCreate {
  const id = opts.settings.engine.workflowId;
  return { ...(isWorkflowId(id) ? { id } : {}), ...buildEngineWorkflow(opts), ...(opts.actor ? { actor: opts.actor } : {}) };
}

export function buildEngineWorkflowUpdate(opts: DefinitionOptions): WorkflowUpdate {
  return { ...buildEngineWorkflow(opts), ...(opts.actor ? { actor: opts.actor } : {}) };
}

// ─── Engine on problem (optional second engine workflow, Problem trigger) ──────

export const ON_PROBLEM_WORKFLOW_TITLE = "Command Center · Engine on problem";
/** Bumped whenever this definition changes. */
export const ON_PROBLEM_DEFINITION_VERSION = 1;
export const ON_PROBLEM_MARKER = `[command-center-engine-on-problem v${ON_PROBLEM_DEFINITION_VERSION}]`;

/**
 * Optional second engine workflow: SIMPLE, **Problem trigger** (a Davis problem opens or closes), one task — the
 * same run-engine action, with the problem's id and status as input. With it the first page no longer waits for
 * the interval of the engine workflow, so a longer interval (fewer runs) becomes acceptable. The interval workflow
 * stays: escalation steps, snooze ends and retries need a clock.
 *
 * Verified on a trial tenant (2026-11-27): the platform accepted this body as a simple workflow; the trigger fired
 * 1–12 s after the problem event, once when the problem opened and once when it closed, and every execution was
 * one billed invocation of the action. Trigger shape: DavisProblemTriggerConfig in
 * node_modules/@dynatrace-sdk/client-automation/types/index.d.ts (triggerOn, categories, analysisReady).
 */
export function buildOnProblemWorkflow(opts: Pick<DefinitionOptions, "appId" | "settings" | "actor">): Pick<WorkflowCreate, "title" | "description" | "type" | "isPrivate" | "trigger" | "tasks"> {
  return {
    title: ON_PROBLEM_WORKFLOW_TITLE,
    description:
      `Runs the paging engine of the Command Center app (${opts.appId}) as soon as Davis opens or closes a problem, so the ` +
      `first page does not wait for the interval of "${ENGINE_WORKFLOW_TITLE}". Simple workflow: one task, no workflow hours. ` +
      `Keep "${ENGINE_WORKFLOW_TITLE}" installed: escalations need its clock. ${ON_PROBLEM_MARKER}`,
    type: "SIMPLE",
    isPrivate: false,
    trigger: {
      eventTrigger: {
        isActive: opts.settings.engine.enabled,
        triggerConfiguration: {
          type: "davis-problem",
          value: {
            // Every category: the app's own routing rules decide what pages, not the trigger.
            categories: { monitoringUnavailable: true, availability: true, error: true, slowdown: true, resource: true, custom: true, info: true },
            entityTags: {},
            entityTagsMatch: null,
            triggerOn: "open-and-close",
            customFilter: "",
            analysisReady: false,
          },
        },
      },
    },
    tasks: {
      [ENGINE_TASK]: {
        name: ENGINE_TASK,
        action: actionId(opts.appId),
        description: "One Command Center cycle for the problem that started this run",
        input: { problemId: '{{ event()["event.id"] }}', problemStatus: '{{ event()["event.status"] }}' },
        position: { x: 0, y: 1 },
        predecessors: [],
      },
    },
  };
}

export function buildOnProblemWorkflowCreate(opts: Pick<DefinitionOptions, "appId" | "settings" | "actor">): WorkflowCreate {
  return { ...buildOnProblemWorkflow(opts), ...(opts.actor ? { actor: opts.actor } : {}) };
}

// ─── Custom integration workflow (provider kind "workflow") ───────────────────

export const CUSTOM_WORKFLOW_TITLE = "Command Center · Custom integration";
export const CUSTOM_WORKFLOW_TASK = "send_notification";
/** Placeholder endpoint the customer replaces in the Workflows app. */
export const CUSTOM_WORKFLOW_EXAMPLE_URL = "https://example.com/command-center/notifications";

/**
 * A SIMPLE, on-demand workflow with one HTTP request task, prefilled with example data. Command Center runs it
 * once per notification with params `{ source, version, notification }`; the task body forwards them as JSON with
 * the expression `{{ execution().params | to_json }}` (verified on a trial tenant: the receiver got the substituted
 * JSON, quotes escaped). The customer replaces the URL and headers, or the whole task with any other action
 * (email, ITSM, chat…), using fields such as `{{ execution().params.notification.subject }}`.
 */
export function buildCustomWorkflow(appId: string): Pick<WorkflowCreate, "title" | "description" | "type" | "isPrivate" | "tasks"> {
  return {
    title: CUSTOM_WORKFLOW_TITLE,
    description:
      `Custom notification channel of the Command Center app (${appId}). Command Center runs this workflow once per ` +
      "notification. Replace the example URL and headers, or replace the task with any action; the notification is in " +
      "execution().params.notification (subject, text, priority, to.address, incidentUrl…).",
    type: "SIMPLE",
    isPrivate: false,
    tasks: {
      [CUSTOM_WORKFLOW_TASK]: {
        name: CUSTOM_WORKFLOW_TASK,
        action: "dynatrace.automations:http-function",
        description: "Example: forward the notification as JSON. Replace the URL with your endpoint.",
        input: {
          url: CUSTOM_WORKFLOW_EXAMPLE_URL,
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Example-Header": "replace-or-remove" },
          payload: "{{ execution().params | to_json }}",
        },
        position: { x: 0, y: 1 },
        predecessors: [],
      },
    },
  };
}

// ─── Per-integration workflows (one per built-in provider) ─────────────────────

export const SEND_NOTIFICATION_ACTION = "send-notification";
export const PROVIDER_WORKFLOW_TASK = "send";

export function providerWorkflowTitle(providerName: string): string {
  return `Command Center · ${providerName}`;
}

/**
 * The workflow of one integration: SIMPLE, on demand (no trigger), one task — this app's send-notification action
 * with the provider id and the notification passed through from the run params. Created by the person when the
 * integration is switched on (Workflows "create workflow" intent, or JSON upload); the engine then runs it once per
 * notification of that provider.
 */
export function buildProviderWorkflow(appId: string, provider: { id: string; name: string }): Pick<WorkflowCreate, "title" | "description" | "type" | "isPrivate" | "tasks"> {
  return {
    title: providerWorkflowTitle(provider.name),
    description:
      `Sends Command Center (${appId}) notifications through the "${provider.name}" integration. Command Center runs ` +
      "this workflow once per notification; settings and secrets stay in the Command Center app and the Credential Vault.",
    type: "SIMPLE",
    isPrivate: false,
    tasks: {
      [PROVIDER_WORKFLOW_TASK]: {
        name: PROVIDER_WORKFLOW_TASK,
        action: `${appId}:${SEND_NOTIFICATION_ACTION}`,
        description: `Send one notification through ${provider.name}`,
        input: { providerId: provider.id, notification: "{{ execution().params.notification }}" },
        position: { x: 0, y: 1 },
        predecessors: [],
      },
    },
  };
}
