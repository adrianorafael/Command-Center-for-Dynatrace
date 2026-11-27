import { describe, expect, it, vi } from "vitest";

vi.mock("@dynatrace-sdk/navigation", () => ({ sendIntent: vi.fn() }));
vi.mock("@dynatrace-sdk/app-utils", () => ({ functions: { call: vi.fn() } }));

import { sendIntent } from "@dynatrace-sdk/navigation";
import type { Settings } from "../../domain/contracts";
import {
  ENGINE_DEFINITION_VERSION,
  ENGINE_TASK,
  actionId,
  buildEngineWorkflow,
  buildEngineWorkflowCreate,
  buildEngineWorkflowUpdate,
} from "../workflows/definition";
import {
  InstallNotPermittedError,
  createDemoInstaller,
  createWorkflowInstaller,
  parseDefinitionVersion,
  type AutomationClientLike,
} from "../workflows/installer";

const WF_ID = "00000000-0000-4000-8000-000000000001";
const settings = {
  engine: { enabled: true, workflowId: WF_ID, maxNotificationsPerTick: 100, reportTimeoutSec: 180, maxAttempts: 3, lockTtlSec: 150 },
  providers: [],
} as unknown as Settings;

describe("engine workflow definition (simple workflow)", () => {
  const wf = buildEngineWorkflowCreate({ appId: "my.command.center", settings });

  it("is a SIMPLE workflow with exactly one task: the app's run-engine action, no input", () => {
    expect(wf.type).toBe("SIMPLE");
    expect(Object.keys(wf.tasks ?? {})).toEqual([ENGINE_TASK]);
    const task = (wf.tasks ?? {})[ENGINE_TASK] as { action?: string; input?: unknown };
    expect(task.action).toBe("my.command.center:run-engine");
    expect((task as { input?: unknown }).input).toEqual({});
    // Simple workflows allow no task options or conditions.
    expect(task).not.toHaveProperty("retry");
    expect(task).not.toHaveProperty("conditions");
  });

  it("uses an interval trigger (1, 2 or 5 minutes; anything else falls back to 1)", () => {
    expect(wf.trigger?.schedule?.trigger).toEqual({ type: "interval", intervalMinutes: 1 });
    expect(buildEngineWorkflow({ appId: "x.y", settings, intervalMinutes: 5 }).trigger?.schedule?.trigger).toEqual({ type: "interval", intervalMinutes: 5 });
    expect(buildEngineWorkflow({ appId: "x.y", settings, intervalMinutes: 7 }).trigger?.schedule?.trigger).toEqual({ type: "interval", intervalMinutes: 1 });
  });

  it("carries the fixed id on create, none on update, and the version marker", () => {
    expect(wf.id).toBe(WF_ID);
    expect(buildEngineWorkflowUpdate({ appId: "my.command.center", settings })).not.toHaveProperty("id");
    expect(parseDefinitionVersion(wf.description)).toBe(ENGINE_DEFINITION_VERSION);
    expect(actionId("my.app")).toBe("my.app:run-engine");
  });

  it("holds no secret or environment URL", () => {
    expect(JSON.stringify(wf)).not.toMatch(/CREDENTIAL|token|password|\.apps\.dynatrace\.com/i);
  });
});

describe("installer", () => {
  const client = (wf: Record<string, unknown> | null): AutomationClientLike => ({
    getWorkflow: () => (wf ? Promise.resolve({ id: WF_ID, ...wf }) : Promise.reject(Object.assign(new Error("nf"), { response: { status: 404 } }))),
    getWorkflows: () => Promise.resolve({ results: [] }),
  });

  it("cannot create workflows directly (automation:workflows:write is reserved)", async () => {
    await expect(createWorkflowInstaller("my.command.center", client(null)).install(settings)).rejects.toBeInstanceOf(InstallNotPermittedError);
  });

  it("installs through the Workflows create-workflow intent with title, tasks and trigger", () => {
    createWorkflowInstaller("my.command.center", client(null)).openInstallIntent(settings, 2);
    const payload = vi.mocked(sendIntent).mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.title).toBe("Command Center · Engine");
    expect(Object.keys(payload.tasks as object)).toEqual([ENGINE_TASK]);
    expect(payload.trigger).toMatchObject({ schedule: { trigger: { intervalMinutes: 2 } } });
  });

  it("reports a SIMPLE workflow using the action as up to date, a legacy one as outdated", async () => {
    const simple = await createWorkflowInstaller("my.command.center", client({
      type: "SIMPLE",
      description: `x [command-center-engine v${ENGINE_DEFINITION_VERSION}]`,
      tasks: { run_engine: { action: "my.command.center:run-engine" } },
      isDeployed: true,
    })).getStatus(settings);
    expect(simple).toMatchObject({ installed: true, type: "SIMPLE", usesAction: true, outdated: false });
    const legacy = await createWorkflowInstaller("my.command.center", client({
      type: "STANDARD",
      description: "x [command-center-engine v2]",
      tasks: { tick: { action: "dynatrace.automations:run-javascript" } },
    })).getStatus(settings);
    expect(legacy).toMatchObject({ installed: true, usesAction: false, outdated: true });
    expect((await createWorkflowInstaller("my.command.center", client(null)).getStatus(settings)).installed).toBe(false);
  });

  it("runs the engine now through the injected runner (app function engine-run)", async () => {
    const runner = vi.fn().mockResolvedValue({ ok: true, sent: 1, failed: 0, deferred: 0, errors: [] });
    const r = await createWorkflowInstaller("my.command.center", client(null), runner).runEngineNow(settings, { reason: "manual" });
    expect(runner).toHaveBeenCalledWith({ reason: "manual" });
    expect(r?.sent).toBe(1);
  });

  it("demo installer reports a healthy simple workflow and never leaves the browser", async () => {
    const d = createDemoInstaller();
    expect(await d.getStatus(settings)).toMatchObject({ installed: true, type: "SIMPLE", demo: true });
    expect(await d.runEngineNow(settings, { reason: "manual" })).toBeUndefined();
  });
});

describe("checked-in workflow template", () => {
  it("command-center-engine.workflow.json matches the generated definition (run scripts/gen-workflow-templates.mjs)", async () => {
    const { readFileSync } = await import("node:fs");
    const { engineTemplateJson } = await import("../workflows/template");
    const file = readFileSync(new URL("../../../../workflow-templates/command-center-engine.workflow.json", import.meta.url), "utf8");
    expect(file).toBe(engineTemplateJson());
    expect(file).not.toMatch(/\.apps\.dynatrace\.com|\.live\.dynatrace\.com/);
  });
});

describe("engine on problem (optional workflow with a Problem trigger)", () => {
  it("is a SIMPLE workflow: Problem trigger on open and close, one task, the engine action with the problem as input", async () => {
    const { buildOnProblemWorkflow, buildOnProblemWorkflowCreate, ON_PROBLEM_WORKFLOW_TITLE, ON_PROBLEM_MARKER } = await import("../workflows/definition");
    const wf = buildOnProblemWorkflow({ appId: "my.command.center", settings });
    expect(wf.title).toBe(ON_PROBLEM_WORKFLOW_TITLE);
    expect(wf.type).toBe("SIMPLE");
    expect(wf.description).toContain(ON_PROBLEM_MARKER);
    expect(wf.trigger).toMatchObject({
      eventTrigger: { isActive: true, triggerConfiguration: { type: "davis-problem", value: { triggerOn: "open-and-close", analysisReady: false } } },
    });
    // Every problem category: the app's routing decides what pages, not the trigger.
    const value = (wf.trigger as unknown as { eventTrigger: { triggerConfiguration: { value: { categories: Record<string, boolean> } } } }).eventTrigger.triggerConfiguration.value;
    expect(Object.values(value.categories).every(Boolean)).toBe(true);
    expect(Object.keys(value.categories)).toHaveLength(7);
    const tasks = Object.values(wf.tasks ?? {});
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      action: actionId("my.command.center"),
      input: { problemId: '{{ event()["event.id"] }}', problemStatus: '{{ event()["event.status"] }}' },
    });
    // It has no fixed id (found by title) and follows the engine switch.
    expect(buildOnProblemWorkflowCreate({ appId: "my.command.center", settings })).not.toHaveProperty("id");
    const off = buildOnProblemWorkflow({ appId: "my.command.center", settings: { ...settings, engine: { ...settings.engine, enabled: false } } });
    expect(off.trigger).toMatchObject({ eventTrigger: { isActive: false } });
    expect(JSON.stringify(wf)).not.toMatch(/dt0[cs]\d{2}\.|CREDENTIAL|\.apps\.dynatrace\.com/);
  });

  it("its status is found by title: not installed, healthy, standard, trigger off, outdated", async () => {
    const { getOnProblemStatus, parseOnProblemVersion } = await import("../workflows/installer");
    const { buildOnProblemWorkflow, ON_PROBLEM_WORKFLOW_TITLE, ON_PROBLEM_DEFINITION_VERSION } = await import("../workflows/definition");
    const def = buildOnProblemWorkflow({ appId: "my.command.center", settings });
    expect(parseOnProblemVersion(def.description)).toBe(ON_PROBLEM_DEFINITION_VERSION);
    // The engine workflow's own marker is not mistaken for this one.
    expect(parseOnProblemVersion("[command-center-engine v3]")).toBeUndefined();
    const client = (wf?: Record<string, unknown>): AutomationClientLike => ({
      getWorkflows: () => Promise.resolve({ results: wf ? [{ id: "wf-1", title: ON_PROBLEM_WORKFLOW_TITLE }, { id: "wf-0", title: `${ON_PROBLEM_WORKFLOW_TITLE} (copy)` }] : [] }),
      getWorkflow: () => (wf ? Promise.resolve({ id: "wf-1", title: ON_PROBLEM_WORKFLOW_TITLE, ...wf }) : Promise.reject(new Error("not found"))),
    });
    const installed = { description: def.description, type: "SIMPLE", isDeployed: true, tasks: def.tasks, trigger: { eventTrigger: { isActive: true } } };
    expect(await getOnProblemStatus("my.command.center", client())).toEqual({ installed: false });
    expect(await getOnProblemStatus("my.command.center", client(installed))).toMatchObject({
      installed: true,
      workflowId: "wf-1",
      type: "SIMPLE",
      usesAction: true,
      triggerActive: true,
      outdated: false,
    });
    expect(await getOnProblemStatus("my.command.center", client({ ...installed, type: "STANDARD" }))).toMatchObject({ type: "STANDARD" });
    expect(await getOnProblemStatus("my.command.center", client({ ...installed, trigger: { eventTrigger: { isActive: false } } }))).toMatchObject({ triggerActive: false });
    expect(await getOnProblemStatus("my.command.center", client({ ...installed, description: "edited by hand" }))).toMatchObject({ outdated: true });
    expect(await getOnProblemStatus("my.command.center", client({ ...installed, tasks: { x: { action: "dynatrace.automations:run-javascript" } } }))).toMatchObject({ usesAction: false, outdated: true });
  });

  it("the checked-in template matches the generated definition (run scripts/gen-workflow-templates.mjs)", async () => {
    const { readFileSync } = await import("node:fs");
    const { onProblemTemplateJson } = await import("../workflows/template");
    const file = readFileSync(new URL("../../../../workflow-templates/command-center-engine-on-problem.workflow.json", import.meta.url), "utf8");
    expect(file).toBe(onProblemTemplateJson());
    expect(file).not.toMatch(/\.apps\.dynatrace\.com|\.live\.dynatrace\.com/);
  });
});

describe("custom integration workflow", () => {
  it("is a SIMPLE on-demand workflow with one HTTP request task forwarding the run params as JSON", async () => {
    const { buildCustomWorkflow, CUSTOM_WORKFLOW_TASK } = await import("../workflows/definition");
    const wf = buildCustomWorkflow("my.command.center");
    expect(wf.type).toBe("SIMPLE");
    expect(wf).not.toHaveProperty("trigger");
    const task = (wf.tasks ?? {})[CUSTOM_WORKFLOW_TASK] as { action?: string; input?: Record<string, unknown> };
    expect(task.action).toBe("dynatrace.automations:http-function");
    expect(task.input?.payload).toBe("{{ execution().params | to_json }}");
    expect(String(task.input?.url)).toMatch(/^https:\/\/example\.com\//);
  });
});

describe("per-integration workflow", () => {
  it("is a SIMPLE on-demand workflow whose task is the app's send-notification action for that provider", async () => {
    const { buildProviderWorkflow, PROVIDER_WORKFLOW_TASK } = await import("../workflows/definition");
    const wf = buildProviderWorkflow("my.command.center", { id: "slack", name: "Slack" });
    expect(wf.title).toBe("Command Center · Slack");
    expect(wf.type).toBe("SIMPLE");
    expect(wf).not.toHaveProperty("trigger");
    const task = (wf.tasks ?? {})[PROVIDER_WORKFLOW_TASK] as { action?: string; input?: Record<string, unknown> };
    expect(task.action).toBe("my.command.center:send-notification");
    expect(task.input).toEqual({ providerId: "slack", notification: "{{ execution().params.notification }}" });
  });
});
