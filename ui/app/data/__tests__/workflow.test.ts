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
