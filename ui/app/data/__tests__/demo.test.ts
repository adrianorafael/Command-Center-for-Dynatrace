import { describe, expect, it } from "vitest";
import { isValidKey } from "../../domain/keys";
import { demoSeed, demoUsers } from "../demoPort";
import { createStaticDirectory } from "../directory";
import { MemoryRepository } from "../memoryRepository";
import { createStore } from "../store";

describe("demo seed", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const seed = demoSeed(now);

  it("uses only valid, unique app-state keys", () => {
    expect(seed.length).toBeGreaterThan(5);
    for (const s of seed) expect(isValidKey(s.key), s.key).toBe(true);
    expect(new Set(seed.map((s) => s.key)).size).toBe(seed.length);
  });

  it("loads through the Store facade like production data", async () => {
    const store = createStore(new MemoryRepository(seed));
    const settings = await store.getSettings();
    expect(settings.demoMode).toBe(true);
    expect((await store.listIncidents()).length).toBeGreaterThan(0);
    expect((await store.listTeams()).length).toBeGreaterThan(0);
    expect(await store.getHeartbeat()).toBeDefined();
  });

  it("provides a searchable synthetic directory", async () => {
    const users = demoUsers(now);
    expect(users.length).toBeGreaterThan(0);
    const dir = createStaticDirectory(users);
    const first = users[0];
    expect((await dir.resolve([first.uid]))[0]?.uid).toBe(first.uid);
  });
});
