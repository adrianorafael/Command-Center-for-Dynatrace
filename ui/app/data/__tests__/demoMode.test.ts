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
