import { describe, expect, it } from "vitest";
import { namesHint } from "../teams/names";

describe("team page: ids shown instead of names are always explained", () => {
  it("says nothing when every member has a name", () => {
    expect(namesHint(0, false, false)).toBeUndefined();
    expect(namesHint(0, true, true)).toBeUndefined();
  });

  it("a refused lookup (403) asks for the permission and says nobody was lost", () => {
    const h = namesHint(4, true, true)!;
    expect(h.detail).toMatch(/403/);
    expect(h.detail).toMatch(/4 people show as an id/);
    expect(h.detail).toMatch(/still members and are paged as usual/);
  });

  it("any other failure shows its reason", () => {
    expect(namesHint(1, true, false, "the values don't meet the requirements")!.detail).toMatch(/failed: the values don't meet the requirements\. Until it works, 1 person shows as an id/);
  });

  it("a lookup that worked means the person is not an active account user", () => {
    expect(namesHint(2, false, false)!.title).toBe("2 people are not active users of this account");
    expect(namesHint(1, false, false)!.detail).toMatch(/Remove the person from the team/);
  });
});
