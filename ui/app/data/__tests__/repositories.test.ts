import { describe, expect, it, vi } from "vitest";
import { AppStateRepository, relativeValidUntil, validUntilTime, type StateClientLike } from "../appStateRepository";
import { MemoryRepository, TTL_MAX_MS, TTL_MIN_MS, clampTtlMs } from "../memoryRepository";

describe("MemoryRepository", () => {
  it("round-trips JSON values and copies them", async () => {
    const repo = new MemoryRepository([], { actor: "user-0001" });
    const v = { a: 1, nested: { b: [1, 2] } };
    await repo.put("cfg.settings", v);
    v.nested.b.push(3);
    const got = await repo.get<typeof v>("cfg.settings");
    expect(got?.value).toEqual({ a: 1, nested: { b: [1, 2] } });
    expect(got?.lastModifiedBy).toBe("user-0001");
    got!.value.a = 99;
    expect((await repo.get<typeof v>("cfg.settings"))?.value.a).toBe(1);
  });

  it("lists by prefix in key order and honours the seed", async () => {
    const repo = new MemoryRepository([
      { key: "team.b", value: { id: "b" }, lastModifiedBy: "user-0002" },
      { key: "team.a", value: { id: "a" } },
      { key: "sched.x", value: { id: "x" } },
    ]);
    const teams = await repo.list<{ id: string }>("team.");
    expect(teams.map((t) => t.key)).toEqual(["team.a", "team.b"]);
    expect(teams[1].lastModifiedBy).toBe("user-0002");
  });

  it("expires values after their (clamped) TTL and deletes idempotently", async () => {
    let now = 1_000_000;
    const repo = new MemoryRepository([], { now: () => now });
    await repo.put("lock.engine", { x: 1 }, 1000); // clamped to 1 min
    now += 30_000;
    expect(await repo.get("lock.engine")).toBeDefined();
    now += 31_000;
    expect(await repo.get("lock.engine")).toBeUndefined();
    await repo.delete("lock.engine");
    await repo.delete("never.existed");
    expect(repo.size()).toBe(0);
  });

  it("clamps TTLs to the platform window", () => {
    expect(clampTtlMs(1)).toBe(TTL_MIN_MS);
    expect(clampTtlMs(365 * 24 * 3600_000)).toBe(TTL_MAX_MS);
    expect(clampTtlMs(Number.NaN)).toBe(TTL_MAX_MS);
  });
});

function fakeStateClient() {
  const store = new Map<string, { value: string; validUntilTime?: string | null }>();
  const notFound = () => Object.assign(new Error("Not found"), { response: { status: 404 } });
  const client: StateClientLike = {
    getAppStates: vi.fn(({ filter }: { filter?: string; addFields?: string } = {}) => {
      const m = /key starts-with '([^']*)'/.exec(filter ?? "");
      const p = (m?.[1] ?? "").toLowerCase();
      return Promise.resolve(
        [...store.entries()]
          .filter(([k]) => k.toLowerCase().startsWith(p))
          .map(([key, s]) => ({
            key,
            value: s.value,
            modificationInfo: { lastModifiedBy: "user-0003", lastModifiedTime: new Date(5000) },
          })),
      );
    }),
    getAppState: vi.fn(({ key }: { key: string }) => {
      const s = store.get(key);
      return s
        ? Promise.resolve({ value: s.value, modificationInfo: { lastModifiedBy: "user-0003", lastModifiedTime: "1970-01-01T00:00:06.000Z" } })
        : Promise.reject(notFound());
    }),
    setAppState: vi.fn(({ key, body }: { key: string; body: { value: string; validUntilTime?: string | null } }) => {
      store.set(key, body);
      return Promise.resolve();
    }),
    deleteAppState: vi.fn(({ key }: { key: string }) => (store.delete(key) ? Promise.resolve() : Promise.reject(notFound()))),
  };
  return { client, store };
}

describe("AppStateRepository", () => {
  it("uses the documented list filter and addFields, maps modificationInfo", async () => {
    const { client } = fakeStateClient();
    const repo = new AppStateRepository(client);
    await repo.put("inc.dp-p-00001", { id: "dp-p-00001" });
    await repo.put("incx.other", { id: "nope" });
    const rows = await repo.list<{ id: string }>("inc.");
    expect(client.getAppStates).toHaveBeenCalledWith({ filter: "key starts-with 'inc.'", addFields: "value,modificationInfo" });
    expect(rows).toEqual([
      { key: "inc.dp-p-00001", value: { id: "dp-p-00001" }, lastModifiedBy: "user-0003", lastModifiedTime: 5000 },
    ]);
  });

  it("returns undefined for a missing key and treats a 404 delete as success", async () => {
    const { client } = fakeStateClient();
    const repo = new AppStateRepository(client);
    expect(await repo.get("cfg.settings")).toBeUndefined();
    await expect(repo.delete("cfg.settings")).resolves.toBeUndefined();
  });

  it("stores JSON strings and a clamped validUntilTime", async () => {
    const { client, store } = fakeStateClient();
    const repo = new AppStateRepository(client);
    await repo.put("act.inc-1.0000000000001.abc123", { type: "ack" }, 7 * 24 * 3600_000);
    const s = store.get("act.inc-1.0000000000001.abc123");
    expect(JSON.parse(s!.value)).toEqual({ type: "ack" });
    const until = Date.parse(s!.validUntilTime!);
    expect(until - Date.now()).toBeGreaterThan(7 * 24 * 3600_000 - 5000);
    await repo.put("cfg.settings", { a: 1 });
    expect(store.get("cfg.settings")?.validUntilTime).toBeUndefined();
    expect((await repo.get<{ a: number }>("cfg.settings"))?.lastModifiedTime).toBe(6000);
  });

  it("rejects invalid keys and prefixes before calling the service", async () => {
    const { client } = fakeStateClient();
    const repo = new AppStateRepository(client);
    await expect(repo.put("Bad Key", 1)).rejects.toThrow(/Invalid app-state key/);
    await expect(repo.list("x' or key contains '")).rejects.toThrow(/Invalid key prefix/);
    expect(client.setAppState).not.toHaveBeenCalled();
  });

  it("skips non-JSON values instead of crashing", async () => {
    const { client, store } = fakeStateClient();
    store.set("problem-ack-states", { value: "not json {" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const repo = new AppStateRepository(client);
    expect(await repo.get("problem-ack-states")).toBeUndefined();
    warn.mockRestore();
  });

  it("falls back to the relative validUntilTime form on a 400", async () => {
    const { client, store } = fakeStateClient();
    const set = client.setAppState as ReturnType<typeof vi.fn>;
    const original = set.getMockImplementation() as (c: unknown) => Promise<void>;
    set.mockImplementation((c: { key: string; body: { value: string; validUntilTime?: string | null } }) =>
      c.body.validUntilTime && !c.body.validUntilTime.startsWith("now+")
        ? Promise.reject(Object.assign(new Error("bad request"), { response: { status: 400 } }))
        : original(c),
    );
    await new AppStateRepository(client).put("lock.engine", { holder: "a" }, 90_000);
    expect(store.get("lock.engine")?.validUntilTime).toBe("now+2m");
    expect(relativeValidUntil(7 * 24 * 3600_000)).toBe("now+10080m");
  });

  it("validUntilTime clamps to 1 min … 90 d", () => {
    expect(validUntilTime(1, 0)).toBe(new Date(60_000).toISOString());
    expect(validUntilTime(1e15, 0)).toBe(new Date(TTL_MAX_MS).toISOString());
  });
});
