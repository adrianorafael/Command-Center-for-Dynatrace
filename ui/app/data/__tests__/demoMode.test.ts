import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ id: "env-placeholder" }));
vi.mock("@dynatrace-sdk/app-environment", () => ({
  getEnvironmentId: () => env.id,
  getAppId: () => "my.command.center",
}));

import { isDemo } from "../demoMode";

function browser(search: string, stored?: string) {
  vi.stubGlobal("window", { location: { search } });
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "cc.demo" ? (stored ?? null) : null) });
}

afterEach(() => vi.unstubAllGlobals());

describe("#19 demo mode detection", () => {
  it("ignores ?demo=1 inside a real environment", () => {
    env.id = "env-placeholder";
    browser("?demo=1");
    expect(isDemo()).toBe(false);
  });

  it("honours the stored preference inside a real environment", () => {
    env.id = "env-placeholder";
    browser("", "1");
    expect(isDemo()).toBe(true);
  });

  it("is always on without the platform runtime", () => {
    env.id = "dt.missing.environment.id";
    browser("");
    expect(isDemo()).toBe(true);
  });
});

describe("?demo=empty (offline preview): first-time setup from nothing", () => {
  it("starts without teams, schedules or incidents, but only without the platform runtime", async () => {
    const { getStore, resetAdaptersForTests } = await import("../demoMode");
    env.id = "dt.missing.environment.id";
    browser("?demo=empty");
    resetAdaptersForTests();
    expect(await getStore().listTeams()).toEqual([]);
    expect((await getStore().getSettings()).defaults.teamId).toBeUndefined();
    browser("?demo=1");
    resetAdaptersForTests();
    expect((await getStore().listTeams()).length).toBeGreaterThan(0);
    resetAdaptersForTests();
  });
});

describe("demo heartbeat", () => {
  it("is reported as fresh, so a long demo never warns that the engine is late", async () => {
    const { withLiveDemoHeartbeat } = await import("../demoMode");
    const { MemoryRepository } = await import("../memoryRepository");
    const { KEY } = await import("../repository");
    const seeded = new MemoryRepository([{ key: KEY.heartbeat, value: { lastTickAt: 0, durationMs: 5 } }, { key: "x", value: 1 }]);
    const later = Date.UTC(2026, 10, 27, 15, 30, 42);
    const r = withLiveDemoHeartbeat(seeded, () => later);
    expect((await r.get<{ lastTickAt: number; durationMs: number }>(KEY.heartbeat))?.value).toEqual({ lastTickAt: Date.UTC(2026, 10, 27, 15, 30, 0), durationMs: 5 });
    expect((await r.get<number>("x"))?.value).toBe(1);
  });
});
