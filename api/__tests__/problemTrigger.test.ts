import { describe, expect, it, vi } from "vitest";

vi.mock("@dynatrace-sdk/app-environment", () => ({ getEnvironmentUrl: () => "dt.missing", getAppId: () => "dt.missing" }));

import type { Settings } from "../../ui/app/domain/contracts";
import { KEY } from "../../ui/app/data/repository";
import { MemoryRepository } from "../../ui/app/data/memoryRepository";
import { defaultSettings } from "../../ui/app/data/domainPort";
import type { RunQuery } from "../../ui/app/data/grail";
import { incidentIdFor } from "../../ui/app/domain/ids";
import { CYCLE_BUDGET_MS, type CycleResult } from "../lib/cycle";
import { PROBLEM_POLL_MS, PROBLEM_WAIT_MS, runProblemTriggeredCycle } from "../lib/problemTrigger";

const T0 = Date.parse("2026-11-27T14:00:00Z");
const PROBLEM = "P-00042";
const INCIDENT_KEY = KEY.incident(incidentIdFor({ source: "davis-problem", sourceId: PROBLEM }));
const ran: CycleResult = { ok: true, tickAt: T0, counts: { alertsFetched: 1, incidentsCreated: 1, incidentsResolved: 0, actionsFolded: 0, notificationsPlanned: 1, notificationsRetried: 0 }, sent: 1, failed: 0, deferred: 0, errors: [] };

/** A fake clock that only moves when the run sleeps, a repository and call counters. */
function harness(opts: { settings?: (s: Settings) => void; readableAfterPolls?: number; status?: string; cycle?: (n: number, repo: MemoryRepository) => Promise<CycleResult> | CycleResult } = {}) {
  let clock = T0;
  const s = defaultSettings();
  opts.settings?.(s);
  const repo = new MemoryRepository([{ key: KEY.settings, value: s }], { now: () => clock });
  const sleeps: number[] = [];
  let polls = 0;
  const queries: string[] = [];
  const runQuery = vi.fn(async (q: string) => {
    queries.push(q);
    polls++;
    return polls > (opts.readableAfterPolls ?? 0) ? [{ "event.id": PROBLEM, "event.status": opts.status ?? "ACTIVE", "dt.davis.event_ids": [] }] : [];
  }) as unknown as RunQuery;
  let cycles = 0;
  const deadlines: (number | undefined)[] = [];
  const runCycle = vi.fn(async (_req: unknown, deps: { deadlineAt?: number }) => {
    cycles++;
    deadlines.push(deps.deadlineAt);
    return opts.cycle ? opts.cycle(cycles, repo) : ran;
  });
  const deps = {
    repo,
    runQuery,
    now: () => clock,
    fetch: (() => Promise.reject(new Error("no network in tests"))) as unknown as typeof fetch,
    readCredential: async () => ({}),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    runCycle: runCycle as never,
  };
  return { deps, repo, sleeps, queries, deadlines, cycles: () => cycles, elapsed: () => clock - T0 };
}

const incident = (status: string) => ({ schemaVersion: 1, id: "x", status });

describe("engine run started by the Problem trigger", () => {
  it("waits until the problem can be read, then runs cycles until its incident exists", async () => {
    // Readable on the 4th poll (15 s in); the cycle creates the incident.
    const h = harness({
      readableAfterPolls: 3,
      cycle: async (_n, repo) => {
        await repo.put(INCIDENT_KEY, incident("triggered"));
        return ran;
      },
    });
    const res = await runProblemTriggeredCycle({ problemId: PROBLEM, problemStatus: "ACTIVE" }, h.deps);
    expect(res).toMatchObject({ ok: true, sent: 1 });
    expect(h.cycles()).toBe(1);
    expect(h.queries).toHaveLength(4);
    expect(h.queries[0]).toContain(`event.id == "${PROBLEM}"`);
    // Three waits before the problem was readable; the run ends as soon as its cycle created the incident.
    expect(h.sleeps).toEqual([PROBLEM_POLL_MS, PROBLEM_POLL_MS, PROBLEM_POLL_MS]);
    // Sending is bound to the start of the invocation, not to the (late) start of the cycle.
    expect(h.deadlines).toEqual([T0 + CYCLE_BUDGET_MS]);
  });

  it("does nothing when the incident is already there (another run was faster, or a later update of an open problem)", async () => {
    const h = harness();
    await h.repo.put(INCIDENT_KEY, incident("acknowledged"));
    const res = await runProblemTriggeredCycle({ problemId: PROBLEM, problemStatus: "ACTIVE" }, h.deps);
    expect(res).toMatchObject({ ok: true, skipped: "already-handled", sent: 0 });
    expect(h.cycles()).toBe(0);
    expect(h.queries).toHaveLength(0);
    expect(h.sleeps).toHaveLength(0);
  });

  it("gives up after the wait budget and leaves the problem to the scheduled run", async () => {
    const h = harness({ readableAfterPolls: 1000 });
    const res = await runProblemTriggeredCycle({ problemId: PROBLEM, problemStatus: "ACTIVE" }, h.deps);
    expect(res).toMatchObject({ ok: true, skipped: "problem-not-readable" });
    expect(h.cycles()).toBe(0);
    expect(h.elapsed()).toBeLessThanOrEqual(PROBLEM_WAIT_MS);
    expect(h.elapsed()).toBeGreaterThan(PROBLEM_WAIT_MS - 2 * PROBLEM_POLL_MS);
  });

  it("keeps checking after a locked run: the other run's incident ends the wait", async () => {
    const h = harness({
      cycle: async (n, repo) => {
        // The first attempt meets the lease; meanwhile the other run writes the incident.
        if (n === 1) {
          await repo.put(INCIDENT_KEY, incident("triggered"));
          return { ...ran, skipped: "locked", sent: 0, counts: { ...ran.counts, incidentsCreated: 0, notificationsPlanned: 0 } };
        }
        return ran;
      },
    });
    const res = await runProblemTriggeredCycle({ problemId: PROBLEM, problemStatus: "ACTIVE" }, h.deps);
    expect(h.cycles()).toBe(1);
    expect(res.skipped).toBe("locked");
  });

  it("runs again when a cycle did not create the incident yet (its routing properties were not readable)", async () => {
    const h = harness({
      cycle: async (n, repo) => {
        if (n === 2) await repo.put(INCIDENT_KEY, incident("triggered"));
        return ran;
      },
    });
    await runProblemTriggeredCycle({ problemId: PROBLEM, problemStatus: "ACTIVE" }, h.deps);
    expect(h.cycles()).toBe(2);
  });

  it("a closed problem waits for the CLOSED record and for the incident to be resolved", async () => {
    const h = harness({
      status: "CLOSED",
      readableAfterPolls: 1,
      cycle: async (_n, repo) => {
        await repo.put(INCIDENT_KEY, incident("resolved"));
        return ran;
      },
    });
    await h.repo.put(INCIDENT_KEY, incident("triggered"));
    await runProblemTriggeredCycle({ problemId: PROBLEM, problemStatus: "CLOSED" }, h.deps);
    expect(h.cycles()).toBe(1);
    expect(h.queries).toHaveLength(2);
    // An ACTIVE record does not count for a close.
    const open = harness({ status: "ACTIVE" });
    await open.repo.put(INCIDENT_KEY, incident("triggered"));
    const res = await runProblemTriggeredCycle({ problemId: PROBLEM, problemStatus: "CLOSED" }, open.deps);
    expect(open.cycles()).toBe(0);
    expect(res.skipped).toBe("problem-not-readable");
  });

  it("a reopened problem is not 'already handled' by its resolved incident", async () => {
    const h = harness({
      cycle: async (_n, repo) => {
        await repo.put(INCIDENT_KEY, incident("triggered"));
        return ran;
      },
    });
    await h.repo.put(INCIDENT_KEY, incident("resolved"));
    await runProblemTriggeredCycle({ problemId: PROBLEM, problemStatus: "ACTIVE" }, h.deps);
    expect(h.cycles()).toBe(1);
  });

  it("without a usable problem id it is a plain cycle (workflow run by hand, or input edited)", async () => {
    for (const input of [undefined, {}, { problemId: "" }, { problemId: 'P-1" or true' }, { problemId: 42 }]) {
      const h = harness();
      await runProblemTriggeredCycle(input, h.deps);
      expect(h.cycles()).toBe(1);
      expect(h.queries).toHaveLength(0);
      expect(h.sleeps).toHaveLength(0);
    }
  });

  it("does not wait when the engine or the Davis problems source is off", async () => {
    const off = harness({ settings: (s) => void (s.engine.enabled = false) });
    expect((await runProblemTriggeredCycle({ problemId: PROBLEM }, off.deps)).skipped).toBe("disabled");
    const noSource = harness({ settings: (s) => void (s.sources.davisProblems.enabled = false) });
    expect((await runProblemTriggeredCycle({ problemId: PROBLEM }, noSource.deps)).skipped).toBe("problems-source-off");
    expect(off.cycles() + noSource.cycles()).toBe(0);
    expect(off.sleeps.length + noSource.sleeps.length).toBe(0);
  });

  it("a failing status query is reported and treated as 'not readable yet'", async () => {
    const h = harness();
    h.deps.runQuery = vi.fn(async () => {
      throw new Error("grail down");
    }) as unknown as RunQuery;
    const res = await runProblemTriggeredCycle({ problemId: PROBLEM }, h.deps);
    expect(res.skipped).toBe("problem-not-readable");
    expect(res.errors.join(" ")).toMatch(/grail down/);
    expect(h.cycles()).toBe(0);
  });
});
