import { describe, expect, it } from "vitest";
import { DEFAULT_STATUS, readFilters, statusViewOf, STATUS_VIEWS, writeFilters } from "../console/filters";

describe("console status tabs", () => {
  it("maps each tab's status list back to its tab, in any order", () => {
    for (const v of STATUS_VIEWS) expect(statusViewOf(v.status)).toBe(v.id);
    expect(statusViewOf(["acknowledged", "triggered"])).toBe("open");
    // Every status listed is the same as no status filter.
    expect(statusViewOf(["triggered", "acknowledged", "snoozed", "resolved"])).toBe("all");
    // A list no tab covers (old bookmark) selects no tab.
    expect(statusViewOf(["triggered", "resolved"])).toBeUndefined();
  });

  it("round-trips through the URL: default is Open, 'All' is an empty status list", () => {
    expect(readFilters(new URLSearchParams("")).status).toEqual(DEFAULT_STATUS);
    const all = writeFilters(new URLSearchParams(""), { ...readFilters(new URLSearchParams("")), status: [] });
    expect(all.get("status")).toBe("");
    expect(statusViewOf(readFilters(all).status)).toBe("all");
  });
});
