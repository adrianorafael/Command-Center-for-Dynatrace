import { describe, expect, it } from "vitest";
import {
  addWeeks,
  civilDateToPickerIso,
  daysRange,
  formatCivilDate,
  formatDaysRange,
  isInDays,
  parseCivilDate,
  pickedCivilDate,
  placeSpan,
  positionIn,
  resolveWeekParam,
  weekDays,
  weekStartAt,
  weekStartOfDate,
} from "../time/week";

const H = 3_600_000;

describe("week: civil dates and the ?week= parameter", () => {
  it("parses strictly and formats back", () => {
    expect(parseCivilDate("2026-11-22")).toEqual({ year: 2026, month: 11, day: 22 });
    expect(parseCivilDate("2026-02-31")).toBeUndefined();
    expect(parseCivilDate("2026-13-01")).toBeUndefined();
    expect(parseCivilDate("22/11/2026")).toBeUndefined();
    expect(parseCivilDate("2026-11-22T00:00")).toBeUndefined();
    expect(parseCivilDate("")).toBeUndefined();
    expect(parseCivilDate(null)).toBeUndefined();
    expect(formatCivilDate({ year: 2026, month: 3, day: 1 })).toBe("2026-03-01");
  });

  it("normalises any date to the Sunday of its week", () => {
    expect(weekStartOfDate({ year: 2026, month: 11, day: 22 })).toEqual({ year: 2026, month: 11, day: 22 }); // Sunday
    expect(weekStartOfDate({ year: 2026, month: 11, day: 25 })).toEqual({ year: 2026, month: 11, day: 22 }); // Wednesday
    expect(weekStartOfDate({ year: 2026, month: 11, day: 28 })).toEqual({ year: 2026, month: 11, day: 22 }); // Saturday
    expect(weekStartOfDate({ year: 2027, month: 1, day: 1 })).toEqual({ year: 2026, month: 12, day: 27 }); // across the year
    expect(addWeeks({ year: 2026, month: 11, day: 22 }, 1)).toEqual({ year: 2026, month: 11, day: 29 });
    expect(addWeeks({ year: 2026, month: 11, day: 22 }, -4)).toEqual({ year: 2026, month: 10, day: 25 });
  });

  it("finds the current week in the display zone, not in UTC", () => {
    // Sat 28 Nov 2026 23:30 in São Paulo is already Sunday 29 Nov in UTC.
    const ts = Date.UTC(2026, 10, 29, 2, 30);
    expect(weekStartAt(ts, "America/Sao_Paulo")).toEqual({ year: 2026, month: 11, day: 22 });
    expect(weekStartAt(ts, "UTC")).toEqual({ year: 2026, month: 11, day: 29 });
  });

  it("resolves the URL value: a valid date picks its week, anything else is the current week", () => {
    const now = Date.UTC(2026, 10, 27, 12);
    expect(resolveWeekParam("2026-11-22", now, "UTC")).toEqual({ year: 2026, month: 11, day: 22 });
    expect(resolveWeekParam("2026-12-03", now, "UTC")).toEqual({ year: 2026, month: 11, day: 29 });
    expect(resolveWeekParam("garbage", now, "UTC")).toEqual({ year: 2026, month: 11, day: 22 });
    expect(resolveWeekParam(null, now, "UTC")).toEqual({ year: 2026, month: 11, day: 22 });
  });
});

describe("week: day columns", () => {
  it("Sunday → Saturday, or Monday → Friday for workdays only", () => {
    const all = weekDays({ year: 2026, month: 11, day: 22 }, "UTC");
    expect(all.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(all[0].key).toBe("2026-11-22");
    expect(all[6].key).toBe("2026-11-28");
    const work = weekDays({ year: 2026, month: 11, day: 22 }, "UTC", true);
    expect(work.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(daysRange(work)).toEqual({ from: Date.UTC(2026, 10, 23), to: Date.UTC(2026, 10, 28) });
  });

  it("day boundaries are local midnights (São Paulo, UTC−3)", () => {
    const days = weekDays({ year: 2026, month: 11, day: 22 }, "America/Sao_Paulo");
    expect(days[0].start).toBe(Date.UTC(2026, 10, 22, 3));
    expect(days[6].end).toBe(Date.UTC(2026, 10, 29, 3));
  });

  it("keeps the 23-hour and 25-hour days of Europe/Berlin", () => {
    const spring = weekDays({ year: 2026, month: 3, day: 29 }, "Europe/Berlin"); // DST starts Sun 29 Mar
    expect(spring[0].end - spring[0].start).toBe(23 * H);
    expect(spring[1].end - spring[1].start).toBe(24 * H);
    const autumn = weekDays({ year: 2026, month: 10, day: 25 }, "Europe/Berlin"); // DST ends Sun 25 Oct
    expect(autumn[0].end - autumn[0].start).toBe(25 * H);
    // Columns stay equal: the next day still starts exactly at 1/7.
    expect(positionIn(autumn[1].start, autumn)).toBeCloseTo(1 / 7, 10);
    expect(positionIn(autumn[0].start + 12.5 * H, autumn)).toBeCloseTo(0.5 / 7, 10);
  });

  it("handles a zone whose clocks jump at midnight on the week's Sunday (America/Santiago)", () => {
    // Chile: Sun 6 Sep 2026 00:00 does not exist; the day starts at 01:00 −03 (04:00 UTC).
    const days = weekDays({ year: 2026, month: 9, day: 6 }, "America/Santiago");
    expect(days[0].start).toBe(Date.UTC(2026, 8, 6, 4));
    expect(days[0].end).toBe(Date.UTC(2026, 8, 7, 3));
    expect(days[0].end - days[0].start).toBe(23 * H);
    // The previous Saturday ends where Sunday starts: no hole and no overlap between weeks.
    const prev = weekDays({ year: 2026, month: 8, day: 30 }, "America/Santiago");
    expect(prev[6].end).toBe(days[0].start);
  });
});

describe("week: placement", () => {
  const days = weekDays({ year: 2026, month: 11, day: 22 }, "UTC");
  const work = weekDays({ year: 2026, month: 11, day: 22 }, "UTC", true);

  it("maps instants to equal-width day columns and clamps outside the range", () => {
    expect(positionIn(Date.UTC(2026, 10, 22), days)).toBe(0);
    expect(positionIn(Date.UTC(2026, 10, 25, 12), days)).toBeCloseTo(3.5 / 7, 10);
    expect(positionIn(Date.UTC(2026, 10, 1), days)).toBe(0);
    expect(positionIn(Date.UTC(2026, 11, 31), days)).toBe(1);
    expect(isInDays(Date.UTC(2026, 10, 28, 23), days)).toBe(true);
    expect(isInDays(Date.UTC(2026, 10, 28, 23), work)).toBe(false);
  });

  it("clips spans to the visible days and drops spans outside them", () => {
    // A weekend shift Fri 18:00 → Mon 09:00, seen with workdays only.
    const span = placeSpan(Date.UTC(2026, 10, 27, 18), Date.UTC(2026, 10, 30, 9), work);
    expect(span?.left).toBeCloseTo((4 + 0.75) / 5, 10);
    expect((span?.left ?? 0) + (span?.width ?? 0)).toBeCloseTo(1, 10);
    expect(placeSpan(Date.UTC(2026, 10, 28, 8), Date.UTC(2026, 10, 28, 20), work)).toBeUndefined(); // Saturday only
    expect(placeSpan(Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 2), days)).toBeUndefined();
  });
});

describe("week: date picker values", () => {
  it("reads the local date from offset or date-only ISO text", () => {
    expect(pickedCivilDate("2026-11-25T00:00:00.000+09:00", "UTC")).toEqual({ year: 2026, month: 11, day: 25 });
    expect(pickedCivilDate("2026-11-25T00:00:00.000-08:00", "Asia/Tokyo")).toEqual({ year: 2026, month: 11, day: 25 });
    expect(pickedCivilDate({ absoluteDate: "2026-11-25T00:00:00-0300", value: "x", type: "iso8601" }, "UTC")).toEqual({ year: 2026, month: 11, day: 25 });
    expect(pickedCivilDate("2026-11-25", "UTC")).toEqual({ year: 2026, month: 11, day: 25 });
  });

  it("converts a UTC timestamp in the fallback zone, and ignores empty values", () => {
    expect(pickedCivilDate("2026-11-24T15:00:00.000Z", "Asia/Tokyo")).toEqual({ year: 2026, month: 11, day: 25 });
    expect(pickedCivilDate(null, "UTC")).toBeUndefined();
    expect(pickedCivilDate({ absoluteDate: "", value: "", type: "expression" }, "UTC")).toBeUndefined();
    expect(pickedCivilDate("not a date", "UTC")).toBeUndefined();
  });

  it("hands the picker noon UTC so nearby zones show the same calendar date", () => {
    expect(civilDateToPickerIso({ year: 2026, month: 11, day: 22 })).toBe("2026-11-22T12:00:00.000Z");
  });
});

describe("week: range label", () => {
  it("formats within a month, across months and across years", () => {
    expect(formatDaysRange(weekDays({ year: 2026, month: 11, day: 22 }, "UTC"))).toBe("Nov 22 – 28, 2026");
    expect(formatDaysRange(weekDays({ year: 2026, month: 11, day: 29 }, "UTC"))).toBe("Nov 29 – Dec 5, 2026");
    expect(formatDaysRange(weekDays({ year: 2026, month: 12, day: 27 }, "UTC"))).toBe("Dec 27, 2026 – Jan 2, 2027");
    expect(formatDaysRange(weekDays({ year: 2026, month: 11, day: 22 }, "UTC", true))).toBe("Nov 23 – 27, 2026");
    expect(formatDaysRange([])).toBe("");
  });
});
