/**
 * Live finding: with 1-minute ticks, steps after the first fired ~1–2 min late.
 * Simulates minute ticks (with execution jitter) and asserts every step fires on the FIRST
 * tick at or after its due time.
 */
import { describe, expect, it } from "vitest";
import type { EscalationPolicy, NotificationRecord } from "../contracts";
import { applyDeliveryResults } from "../engine/delivery";
import { tick, type TickInput } from "../engine/tick";
import { seededRng } from "../ids";
import { alert, input, persist, T0 } from "./test-utils";

const MIN = 60_000;

function simulate(delays: number[], jitterMs: (k: number) => number, opts: { report?: boolean } = {}) {
  const policy: EscalationPolicy = {
    schemaVersion: 1, id: "pol-noc", name: "timing", rev: 1, repeat: 0,
    steps: delays.map((d, i) => ({ delayMinutes: d, targets: [{ type: "user", uid: i % 2 ? "user-0001" : "user-0002" }] })),
  };
  let st: TickInput = input({ policies: [policy] });
  const fired: { step: number; at: number }[] = [];
  const tickTimes: number[] = [];
  for (let k = 0; k <= 20; k++) {
    const now = T0 + k * MIN + jitterMs(k);
    tickTimes.push(now);
    const out = tick({ ...st, now, alerts: [alert({ sourceId: "P-1", startedAt: T0 - 30_000 })] });
    for (const r of Object.values(out.batches).flat()) if (r.attempt === 1) fired.push({ step: r.step, at: now });
    st = { ...st, ...persist(st, out) };
    if (opts.report !== false) {
      const planned = out.notificationsToWrite.filter((r) => r.status === "planned");
      const d = applyDeliveryResults({ now: now + 5_000, ledger: st.ledger, incidents: st.incidents, results: planned.map((r) => ({ key: r.key, status: "sent" as const, at: now + 5_000 })) });
      const led = new Map(st.ledger.map((r) => [r.key, r]));
      for (const r of d.notificationsToWrite) led.set(r.key, r);
      const inc = new Map(st.incidents.map((i) => [i.id, i]));
      for (const i of d.incidentsToWrite) inc.set(i.id, i);
      st = { ...st, ledger: [...led.values()] as NotificationRecord[], incidents: [...inc.values()] };
    }
  }
  const startedAt = st.incidents[0]!.escalation.startedAt;
  let acc = 0;
  const expected = delays.map((d, i) => {
    acc += d * MIN;
    const due = startedAt + acc;
    return { step: i, at: tickTimes.find((t) => t >= due)! };
  });
  const firstPerStep = expected.map((e) => fired.find((f) => f.step === e.step));
  return { expected, firstPerStep, fired };
}

describe("step timing with 1-minute ticks", () => {
  const rng = seededRng(42);
  const jitters: [string, (k: number) => number][] = [
    ["no jitter", () => 0],
    ["constant +17 s", () => 17_000],
    ["random 0–40 s", () => Math.floor(rng() * 40_000)],
  ];
  for (const delays of [[0, 3, 3, 4], [0, 5, 5]]) {
    for (const [name, j] of jitters) {
      it(`delays ${delays.join(",")} — ${name}: each step on the first tick at/after its due time`, () => {
        const r = simulate(delays, j);
        expect(r.firstPerStep).toEqual(r.expected);
      });
    }
  }
  it("also when delivery reports never arrive (timeouts/retries running)", () => {
    const r = simulate([0, 3, 3, 4], () => 0, { report: false });
    expect(r.firstPerStep).toEqual(r.expected);
  });
});

describe("live pattern reproduction (diagnosis)", () => {
  it("+0/+5/+7/+11 is exactly what every-other-minute ticks produce (scheduled ticks being skipped)", () => {
    // Creation by an off-cycle run at hh:56:40; scheduled runs at :10 but only every 2nd one executes.
    const created = Date.UTC(2026, 10, 26, 22, 56, 40);
    const runs = [created, ...Array.from({ length: 8 }, (_, i) => Date.UTC(2026, 10, 26, 22, 57 + 2 * i, 10))];
    const label = (t: number) => Math.floor(t / MIN) - Math.floor(created / MIN);
    const cases: [number[], number[]][] = [[[0, 3, 3, 4], [0, 5, 7, 11]], [[0, 5, 5], [0, 7, 11]]];
    for (const [delays, want] of cases) {
      const policy: EscalationPolicy = { schemaVersion: 1, id: "pol-noc", name: "t", rev: 1, repeat: 0, steps: delays.map((d) => ({ delayMinutes: d, targets: [{ type: "user" as const, uid: "user-0002" }] })) };
      let st: TickInput = input({ policies: [policy] });
      const firedAt: number[] = [];
      for (const now of runs) {
        const out = tick({ ...st, now, alerts: [alert({ sourceId: "P-1" })] });
        for (const r of Object.values(out.batches).flat()) if (r.attempt === 1) firedAt[r.step] = label(now);
        st = { ...st, ...persist(st, out) };
        st = { ...st, ledger: st.ledger.map((r) => (r.status === "planned" ? { ...r, status: "sent" as const } : r)) };
      }
      expect(firedAt).toEqual(want);
    }
  });
});
