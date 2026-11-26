import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../../domain/contracts";
import {
  ENGINE_DEFINITION_VERSION,
  REPORT_TASK,
  RUN_JAVASCRIPT,
  TICK_TASK,
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
import { SENDER_TASKS } from "../workflows/scripts/senders";

const WF_ID = "00000000-0000-4000-8000-000000000001";
const settings = {
  engine: { enabled: true, workflowId: WF_ID, maxNotificationsPerTick: 100, reportTimeoutSec: 180, maxAttempts: 3, lockTtlSec: 90 },
  providers: [
    { id: "twilio", name: "Twilio", channel: "sms", kind: "twilio", enabled: true, credentialVaultId: "CREDENTIALS_VAULT-YOUR-TWILIO-ENTRY", params: { from: "+15550000001" } },
  ],
} as unknown as Settings;

describe("engine workflow definition", () => {
  const wf = buildEngineWorkflowCreate({ appId: "my.command.center", settings });
  const tasks = wf.tasks ?? {};
  const names = Object.keys(tasks);

  it("has the fixed id, private STANDARD type and a 1-minute interval trigger", () => {
    expect(wf.id).toBe(WF_ID);
    expect(wf.title).toBe("Command Center · Engine");
    expect(wf.type).toBe("STANDARD");
    expect(wf.isPrivate).toBe(true);
    expect(wf.trigger?.schedule?.trigger).toEqual({ type: "interval", intervalMinutes: 1 });
    expect(wf.trigger?.schedule?.isActive).toBe(true);
    expect(wf.description).toContain(`[command-center-engine v${ENGINE_DEFINITION_VERSION}]`);
  });

  it("contains tick, the eight senders and report, all run-javascript with a script", () => {
    expect(names).toEqual([TICK_TASK, ...SENDER_TASKS.map((t) => t.name), REPORT_TASK]);
    for (const [name, t] of Object.entries(tasks)) {
      expect(t?.name).toBe(name);
      expect(t?.action).toBe(RUN_JAVASCRIPT);
      expect(typeof t?.input?.script).toBe("string");
    }
    expect(new Set(SENDER_TASKS.map((t) => t.channel)).size).toBe(8);
  });

  it("every predecessor and condition refers to an existing task; graph is acyclic", () => {
    for (const t of Object.values(tasks)) {
      for (const p of t?.predecessors ?? []) expect(names).toContain(p);
      for (const p of Object.keys(t?.conditions?.states ?? {})) expect(t?.predecessors).toContain(p);
    }
    // topological order exists
    const done = new Set<string>();
    for (let guard = 0; done.size < names.length && guard < names.length; guard++) {
      for (const n of names) if ((tasks[n]?.predecessors ?? []).every((p) => done.has(p))) done.add(n);
    }
    expect(done.size).toBe(names.length);
  });

  it("senders run only on tick SUCCESS and never retry; report waits for ANY sender state", () => {
    for (const s of SENDER_TASKS) {
      expect(tasks[s.name]?.predecessors).toEqual([TICK_TASK]);
      expect(tasks[s.name]?.conditions).toEqual({ states: { tick: "SUCCESS" }, else: "SKIP" });
      expect(tasks[s.name]?.retry).toEqual({ count: 0 });
    }
    expect(Object.values(tasks[REPORT_TASK]?.conditions?.states ?? {})).toEqual(SENDER_TASKS.map(() => "ANY"));
  });

  it("embeds the app id in tick/report and never a secret in input", () => {
    expect(tasks[TICK_TASK]?.input?.script).toContain('"my.command.center"');
    const json = JSON.stringify(wf.input);
    expect(json).not.toMatch(/password|authToken|"token"/i);
    expect(wf.input?.providers?.[0]).toEqual({
      id: "twilio",
      channel: "sms",
      kind: "twilio",
      enabled: true,
      credentialVaultId: "CREDENTIALS_VAULT-YOUR-TWILIO-ENTRY",
    });
  });

  it("update body has no id and no actor unless one is chosen", () => {
    const u = buildEngineWorkflowUpdate({ appId: "my.command.center", settings });
    expect(u).not.toHaveProperty("id");
    expect(u).not.toHaveProperty("actor");
    expect(buildEngineWorkflowUpdate({ appId: "my.command.center", settings, actor: "service-user-1" }).actor).toBe("service-user-1");
  });

  it("rejects a non-UUID workflow id", () => {
    const bad = { ...settings, engine: { ...settings.engine, workflowId: "nope" } } as Settings;
    expect(() => buildEngineWorkflowCreate({ appId: "my.command.center", settings: bad })).toThrow();
  });
});

function client(over: Partial<AutomationClientLike> = {}): AutomationClientLike {
  const notFound = () => Promise.reject(Object.assign(new Error("nf"), { response: { status: 404 } }));
  return {
    getWorkflow: vi.fn(notFound),
    getWorkflows: vi.fn().mockResolvedValue({ results: [] }),
    runWorkflow: vi.fn().mockResolvedValue({ id: "exec-1" }),
    getExecutions: vi.fn().mockResolvedValue({ results: [] }),
    ...over,
  };
}

describe("installer (read + run only)", () => {
  it("cannot install: custom apps have no automation:workflows:write", async () => {
    await expect(createWorkflowInstaller("my.command.center", client()).install(settings)).rejects.toBeInstanceOf(InstallNotPermittedError);
  });

  it("exports the definition for this app id as importable JSON", () => {
    const e = createWorkflowInstaller("my.custom.app", client()).exportDefinition(settings);
    expect(e.fileName).toMatch(/\.json$/);
    const wf = JSON.parse(e.json) as { id: string; tasks: { tick: { input: { script: string } } } };
    expect(wf.id).toBe(WF_ID);
    expect(wf.tasks.tick.input.script).toContain('"my.custom.app"');
  });

  it("reports status with definition version and last execution", async () => {
    const c = client({
      getWorkflow: vi.fn().mockResolvedValue({
        id: WF_ID,
        version: 7,
        isDeployed: true,
        description: "x [command-center-engine v0]",
        lastExecution: { id: "e1", state: "SUCCESS", startedAt: new Date(1000), endedAt: null, triggerType: "Schedule" },
      }),
    });
    const s = await createWorkflowInstaller("my.command.center", c).getStatus(settings);
    expect(s).toMatchObject({ installed: true, workflowId: WF_ID, definitionVersion: 0, outdated: true, workflowVersion: 7 });
    expect(s.foundByTitle).toBeUndefined();
    expect(s.lastExecution).toEqual({ id: "e1", state: "SUCCESS", startedAt: 1000, endedAt: undefined, triggerType: "Schedule" });
    expect(await createWorkflowInstaller("my.command.center", client()).getStatus(settings)).toMatchObject({ installed: false });
  });

  it("finds a workflow imported under another id by its title", async () => {
    const other = "00000000-0000-4000-8000-0000000000ff";
    const getWorkflow = vi.fn(({ id }: { id: string }) =>
      id === other
        ? Promise.resolve({ id: other, title: "Command Center · Engine", description: `[command-center-engine v${ENGINE_DEFINITION_VERSION}]` })
        : Promise.reject(Object.assign(new Error("nf"), { response: { status: 404 } })),
    );
    const c = client({
      getWorkflow,
      getWorkflows: vi.fn().mockResolvedValue({ results: [{ id: "x", title: "Something else" }, { id: other, title: "Command Center · Engine" }] }),
      runWorkflow: vi.fn(({ id }: { id: string }) =>
        id === other ? Promise.resolve({ id: "exec-2" }) : Promise.reject(Object.assign(new Error("nf"), { response: { status: 404 } })),
      ),
    });
    const inst = createWorkflowInstaller("my.command.center", c);
    expect(await inst.getStatus(settings)).toMatchObject({ installed: true, workflowId: other, foundByTitle: true, outdated: false });
    expect(await inst.runEngineNow(settings, { reason: "manual" })).toBe("exec-2");
  });

  it("propagates errors other than not-found", async () => {
    const c = client({ getWorkflow: vi.fn().mockRejectedValue(Object.assign(new Error("forbidden"), { response: { status: 403 } })) });
    await expect(createWorkflowInstaller("my.command.center", c).getStatus(settings)).rejects.toThrow("forbidden");
  });

  it("runs the engine with params and a unique qualifier", async () => {
    const c = client();
    const id = await createWorkflowInstaller("my.command.center", c).runEngineNow(settings, { reason: "manual" }, "esc-inc-1-3");
    expect(id).toBe("exec-1");
    expect(c.runWorkflow).toHaveBeenCalledWith({ id: WF_ID, body: { params: { reason: "manual" }, uniqueQualifier: "esc-inc-1-3" } });
  });

  it("parses the definition marker and has a no-op demo variant", async () => {
    expect(parseDefinitionVersion("a [command-center-engine v12] b")).toBe(12);
    expect(parseDefinitionVersion(undefined)).toBeUndefined();
    const demo = createDemoInstaller();
    expect(await demo.getStatus(settings)).toMatchObject({ installed: true, demo: true });
    expect(await demo.runEngineNow(settings, { reason: "manual" })).toBeUndefined();
  });
});

describe("checked-in workflow templates", () => {
  it("command-center-engine.workflow.json matches the generated definition (run scripts/gen-workflow-templates.mjs)", async () => {
    const { readFileSync } = await import("node:fs");
    const { engineTemplateJson } = await import("../workflows/template");
    const file = readFileSync(new URL("../../../../workflow-templates/command-center-engine.workflow.json", import.meta.url), "utf8");
    expect(file).toBe(engineTemplateJson());
    expect(file).not.toMatch(/\.apps\.dynatrace\.com|\.live\.dynatrace\.com/);
  });
});
