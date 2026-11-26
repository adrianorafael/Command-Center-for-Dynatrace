import { describe, expect, it } from "vitest";
import type { RotationLayer, Schedule } from "../contracts";
import { layerShiftAt, onCallAt } from "../schedule/resolve";
import { layerTimeline, onCallNowAndNext, scheduleTimeline } from "../schedule/timeline";

const H = 3_600_000;

function sched(tz: string, layers: RotationLayer[], overrides: Schedule["overrides"] = []): Schedule {
  return { schemaVersion: 1, id: "s1", name: "S", timeZone: tz, rev: 1, layers, overrides };
}
function layer(p: Partial<RotationLayer> & Pick<RotationLayer, "startsAt">): RotationLayer {
  return { id: "l1", name: "L", participants: ["a", "b", "c"], rotation: { type: "daily" }, handoffTime: "09:00", ...p };
}

describe("schedule resolve", () => {
  it("daily Berlin rotation across spring DST: 23h shift, handoff stays 09:00 local", () => {
    const startsAt = Date.UTC(2026, 2, 27, 8); // Fri 27 Mar 09:00 CET
    const l = layer({ startsAt });
    const tz = "Europe/Berlin";
    expect(layerShiftAt(l, tz, startsAt)?.uid).toBe("a");
    const b = layerShiftAt(l, tz, Date.UTC(2026, 2, 28, 8));
    expect(b?.uid).toBe("b");
    expect(b?.end).toBe(Date.UTC(2026, 2, 29, 7)); // 09:00 CEST
    expect(b!.end - b!.start).toBe(23 * H);
    expect(layerShiftAt(l, tz, Date.UTC(2026, 2, 29, 7) - 1)?.uid).toBe("b");
    expect(layerShiftAt(l, tz, Date.UTC(2026, 2, 29, 7))?.uid).toBe("c");
    expect(layerShiftAt(l, tz, Date.UTC(2026, 2, 30, 7))?.uid).toBe("a");
  });
  it("daily Berlin rotation across autumn DST: 25h shift", () => {
    const startsAt = Date.UTC(2026, 9, 24, 7); // Sat 24 Oct 09:00 CEST
    const s = layerShiftAt(layer({ startsAt }), "Europe/Berlin", startsAt + H);
    expect(s?.uid).toBe("a");
    expect(s!.end).toBe(Date.UTC(2026, 9, 25, 8)); // 09:00 CET
    expect(s!.end - s!.start).toBe(25 * H);
  });
  it("weekly New York across 2026-11-01 lasts 169h; across 2026-03-08 lasts 167h", () => {
    const tz = "America/New_York";
    const autumn = layer({ startsAt: Date.UTC(2026, 9, 26, 13), rotation: { type: "weekly" } });
    const s = layerShiftAt(autumn, tz, Date.UTC(2026, 9, 30));
    expect(s?.uid).toBe("a");
    expect(s!.end).toBe(Date.UTC(2026, 10, 2, 14));
    expect(s!.end - s!.start).toBe(169 * H);
    expect(layerShiftAt(autumn, tz, Date.UTC(2026, 10, 2, 14))?.uid).toBe("b");
    const spring = layer({ startsAt: Date.UTC(2026, 2, 2, 14), rotation: { type: "weekly" } });
    const s2 = layerShiftAt(spring, tz, Date.UTC(2026, 2, 5));
    expect(s2!.end - s2!.start).toBe(167 * H);
  });
  it("Sao Paulo (no DST) daily is always 24h", () => {
    const l = layer({ startsAt: Date.UTC(2026, 9, 1, 11) }); // 08:00 local
    const s = layerShiftAt({ ...l, handoffTime: "08:00" }, "America/Sao_Paulo", Date.UTC(2026, 10, 1, 12));
    expect(s!.end - s!.start).toBe(24 * H);
  });
  it("startsAt before the handoff: lead-in belongs to shift 0, handoffs keep the weekday", () => {
    const tz = "America/Sao_Paulo";
    const startsAt = Date.UTC(2026, 0, 5, 3); // Mon 5 Jan 00:00 local
    const l = layer({ startsAt });
    expect(layerShiftAt(l, tz, startsAt - 1)).toBeUndefined();
    const s = layerShiftAt(l, tz, startsAt);
    expect(s?.uid).toBe("a");
    expect(s?.start).toBe(startsAt);
    expect(s?.end).toBe(Date.UTC(2026, 0, 6, 12)); // Tue 09:00 local
    expect(layerShiftAt(l, tz, Date.UTC(2026, 0, 5, 12))?.uid).toBe("a");
    expect(layerShiftAt(l, tz, Date.UTC(2026, 0, 6, 12))?.uid).toBe("b");
    const w = layer({ startsAt, rotation: { type: "weekly" } });
    const s0 = layerShiftAt(w, tz, startsAt + 3600_000);
    expect(s0?.end).toBe(Date.UTC(2026, 0, 12, 12)); // next Monday 09:00
    const s1 = layerShiftAt(w, tz, Date.UTC(2026, 0, 12, 12));
    expect(s1?.uid).toBe("b");
    expect(new Date(s1!.end - 3 * 3600_000).getUTCDay()).toBe(1); // handoffs stay on Mondays
    const startsLate = Date.UTC(2026, 0, 5, 15); // Mon 12:00 local, after the handoff
    const c = layerShiftAt(layer({ startsAt: startsLate, rotation: { type: "custom", lengthHours: 12 } }), tz, startsLate);
    // 12h boundaries at 09:00/21:00 local: first boundary ≥ 12:00 is 21:00 → lead-in + one shift
    expect(c).toMatchObject({ uid: "a", start: startsLate, end: Date.UTC(2026, 0, 6, 12) }); // Tue 09:00 local
  });
  it("custom 12h rotation", () => {
    const tz = "UTC";
    const l = layer({ startsAt: Date.UTC(2026, 0, 1, 9), rotation: { type: "custom", lengthHours: 12 } });
    expect(layerShiftAt(l, tz, Date.UTC(2026, 0, 1, 20))?.uid).toBe("a");
    expect(layerShiftAt(l, tz, Date.UTC(2026, 0, 1, 21))?.uid).toBe("b");
    expect(layerShiftAt(l, tz, Date.UTC(2026, 0, 2, 9))?.uid).toBe("c");
    const l48 = layer({ startsAt: Date.UTC(2026, 0, 1, 9), rotation: { type: "custom", lengthHours: 48 } });
    expect(layerShiftAt(l48, tz, Date.UTC(2026, 0, 3, 8))?.uid).toBe("a");
    expect(layerShiftAt(l48, tz, Date.UTC(2026, 0, 3, 9))?.uid).toBe("b");
  });
  it("later layer wins; restricted-out layer falls through; overrides on top", () => {
    const tz = "UTC";
    const base = layer({ id: "base", startsAt: Date.UTC(2026, 0, 1, 9), participants: ["a"] });
    const business = layer({
      id: "biz", startsAt: Date.UTC(2026, 0, 1, 9), participants: ["x"],
      restrictions: [{ days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" }],
    });
    const s = sched(tz, [base, business], [
      { id: "o1", uid: "o", from: Date.UTC(2026, 0, 6, 10), to: Date.UTC(2026, 0, 6, 11) },
      { id: "o2", uid: "p", from: Date.UTC(2026, 0, 6, 10, 30), to: Date.UTC(2026, 0, 6, 12) },
    ]);
    // Mon 5 Jan 2026 10:00 → business layer
    expect(onCallAt(s, Date.UTC(2026, 0, 5, 10))).toMatchObject({ uid: "x", layerId: "biz" });
    // Mon 18:00 → base
    expect(onCallAt(s, Date.UTC(2026, 0, 5, 18))).toMatchObject({ uid: "a", layerId: "base" });
    // Sat 10:00 → base
    expect(onCallAt(s, Date.UTC(2026, 0, 10, 10))?.uid).toBe("a");
    // Tue 10:15 → override o1; 10:45 → o2 (later in array wins)
    expect(onCallAt(s, Date.UTC(2026, 0, 6, 10, 15))).toMatchObject({ uid: "o", source: "override" });
    expect(onCallAt(s, Date.UTC(2026, 0, 6, 10, 45))?.uid).toBe("p");
    expect(onCallAt(s, Date.UTC(2026, 0, 6, 12))?.uid).toBe("x");
  });
  it("empty schedule → nobody", () => {
    expect(onCallAt(sched("UTC", [layer({ startsAt: 0, participants: [] })]), 1000)).toBeUndefined();
  });
});

describe("schedule timeline", () => {
  it("produces merged contiguous segments matching onCallAt", () => {
    const tz = "Europe/Berlin";
    const base = layer({ id: "base", startsAt: Date.UTC(2026, 2, 23, 8) });
    const night = layer({ id: "night", startsAt: Date.UTC(2026, 2, 23, 8), participants: ["n"], restrictions: [{ days: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "06:00" }] });
    const s = sched(tz, [base, night], [{ id: "o1", uid: "o", from: Date.UTC(2026, 2, 28, 12), to: Date.UTC(2026, 2, 28, 14) }]);
    const from = Date.UTC(2026, 2, 26);
    const to = Date.UTC(2026, 3, 1);
    const segs = scheduleTimeline(s, from, to);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.from).toBeGreaterThanOrEqual(segs[i - 1]!.to);
    for (let t = from; t < to; t += 17 * 60_000) {
      const seg = segs.find((x) => x.from <= t && t < x.to);
      expect(seg?.uid).toBe(onCallAt(s, t)?.uid);
    }
    expect(segs.some((x) => x.source === "override" && x.uid === "o")).toBe(true);
    const rows = layerTimeline(s, "night", from, to);
    expect(rows.every((r) => r.uid === "n")).toBe(true);
    expect(rows.length).toBe(7); // nights 25→26 (partial) … 31→1 (partial)
  });
  it("now and next", () => {
    const s = sched("UTC", [layer({ startsAt: Date.UTC(2026, 0, 1, 9) })]);
    const r = onCallNowAndNext(s, Date.UTC(2026, 0, 1, 12));
    expect(r.current?.uid).toBe("a");
    expect(r.next?.uid).toBe("b");
    expect(r.next?.from).toBe(Date.UTC(2026, 0, 2, 9));
  });
});
