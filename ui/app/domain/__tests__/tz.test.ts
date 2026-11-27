import { describe, expect, it } from "vitest";
import { civilDate, inWeeklyWindow, minuteOfDayInZone, parseHHmm, weekdayInZone, zonedParts, zoneOffsetMs, zonedToUtc, formatHHmm, isValidTimeZone } from "../time/tz";

const H = 3_600_000;

describe("tz", () => {
  it("offsets for Berlin, New York, Sao Paulo", () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15, 12), "Europe/Berlin")).toBe(1 * H);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), "Europe/Berlin")).toBe(2 * H);
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15, 12), "America/New_York")).toBe(-5 * H);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), "America/New_York")).toBe(-4 * H);
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15, 12), "America/Sao_Paulo")).toBe(-3 * H);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), "America/Sao_Paulo")).toBe(-3 * H);
  });
  it("converts local times and handles midnight", () => {
    expect(zonedToUtc({ year: 2026, month: 1, day: 15 }, 9 * 60, "Europe/Berlin")).toBe(Date.UTC(2026, 0, 15, 8));
    expect(zonedParts(Date.UTC(2026, 0, 14, 23), "Europe/Berlin").hour).toBe(0);
    expect(minuteOfDayInZone(Date.UTC(2026, 0, 14, 23), "Europe/Berlin")).toBe(0);
    expect(civilDate(Date.UTC(2026, 0, 14, 23), "Europe/Berlin")).toEqual({ year: 2026, month: 1, day: 15 });
    expect(weekdayInZone(Date.UTC(2026, 0, 14, 23), "Europe/Berlin")).toBe(4); // Thu 15 Jan 2026
  });
  it("Berlin spring gap 2026-03-29: 02:30 does not exist → 03:30 CEST", () => {
    const t = zonedToUtc({ year: 2026, month: 3, day: 29 }, 2 * 60 + 30, "Europe/Berlin");
    expect(t).toBe(Date.UTC(2026, 2, 29, 1, 30));
    expect(zonedParts(t, "Europe/Berlin").hour).toBe(3);
    expect(zonedToUtc({ year: 2026, month: 3, day: 29 }, 3 * 60, "Europe/Berlin")).toBe(Date.UTC(2026, 2, 29, 1));
  });
  it("Berlin autumn overlap 2026-10-25: 02:30 occurs twice → earlier", () => {
    const t = zonedToUtc({ year: 2026, month: 10, day: 25 }, 2 * 60 + 30, "Europe/Berlin");
    expect(t).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });
  it("New York 2026-03-08 and 2026-11-01", () => {
    expect(zonedToUtc({ year: 2026, month: 3, day: 8 }, 2 * 60 + 30, "America/New_York")).toBe(Date.UTC(2026, 2, 8, 7, 30));
    expect(zonedToUtc({ year: 2026, month: 3, day: 8 }, 9 * 60, "America/New_York")).toBe(Date.UTC(2026, 2, 8, 13));
    expect(zonedToUtc({ year: 2026, month: 11, day: 1 }, 1 * 60 + 30, "America/New_York")).toBe(Date.UTC(2026, 10, 1, 5, 30));
    expect(zonedToUtc({ year: 2026, month: 11, day: 1 }, 9 * 60, "America/New_York")).toBe(Date.UTC(2026, 10, 1, 14));
  });
  it("parses HH:mm", () => {
    expect(parseHHmm("09:30")).toBe(570);
    expect(parseHHmm("24:00")).toBe(1440);
    expect(parseHHmm("25:00")).toBeUndefined();
    expect(parseHHmm("9h")).toBeUndefined();
    expect(formatHHmm(570)).toBe("09:30");
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(isValidTimeZone("America/Sao_Paulo")).toBe(true);
  });
  it("weekly windows including midnight crossing", () => {
    const tz = "America/Sao_Paulo";
    const w = { days: [5], from: "22:00", to: "06:00" }; // Fri 22:00 → Sat 06:00
    // Fri 2026-01-16 23:00 local = 2026-01-17 02:00Z
    expect(inWeeklyWindow(Date.UTC(2026, 0, 17, 2), w, tz)).toBe(true);
    // Sat 05:59 local
    expect(inWeeklyWindow(Date.UTC(2026, 0, 17, 8, 59), w, tz)).toBe(true);
    // Sat 06:00 local
    expect(inWeeklyWindow(Date.UTC(2026, 0, 17, 9), w, tz)).toBe(false);
    // Thu 23:00 local
    expect(inWeeklyWindow(Date.UTC(2026, 0, 16, 2), w, tz)).toBe(false);
  });
});
