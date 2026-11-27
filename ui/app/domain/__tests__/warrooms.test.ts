import { describe, expect, it } from "vitest";
import {
  closeWarRoom,
  isSafeHttpsUrl,
  isTodaysRoom,
  openRoomsForIncident,
  openWarRoomCount,
  reopenWarRoom,
  validateWarRoom,
  warRoomDuration,
  type WarRoom,
} from "../warrooms";

const T0 = Date.UTC(2026, 10, 26, 12, 0, 0);
const room = (over: Partial<WarRoom> = {}): WarRoom => ({
  schemaVersion: 1,
  id: "wr-1",
  title: "Checkout outage",
  url: "https://meet.example.com/abc",
  incidentIds: ["dp-p-1", "dp-p-2"],
  notebooks: [],
  status: "open",
  openedAt: T0,
  openedBy: "user-0001",
  rev: 1,
  ...over,
});

describe("war rooms", () => {
  it("accepts only https links", () => {
    expect(isSafeHttpsUrl("https://teams.microsoft.com/l/meetup-join/x")).toBe(true);
    expect(isSafeHttpsUrl("http://example.com")).toBe(false);
    expect(isSafeHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpsUrl("not a url")).toBe(false);
  });

  it("validates title, link, incidents and notebooks", () => {
    expect(validateWarRoom(room())).toEqual([]);
    const errs = validateWarRoom(room({ title: " ", url: "http://x", incidentIds: [], notebooks: [{ title: "", url: "ftp://x" }] }));
    expect(errs.map((e) => e.path)).toEqual(["title", "url", "incidentIds", "notebooks[0].title", "notebooks[0].url"]);
  });

  it("duration runs while open and freezes when closed", () => {
    expect(warRoomDuration(room(), T0 + 90_000)).toBe(90_000);
    const closed = closeWarRoom(room(), "user-0002", T0 + 3_600_000, "Rolled back");
    expect(closed).toMatchObject({ status: "closed", closedBy: "user-0002", summary: "Rolled back", rev: 2 });
    expect(warRoomDuration(closed, T0 + 10 * 3_600_000)).toBe(3_600_000);
    expect(validateWarRoom(closed)).toEqual([]);
    const again = reopenWarRoom(closed);
    expect(again.status).toBe("open");
    expect(again.closedAt).toBeUndefined();
  });

  it("counts open rooms, finds rooms per incident, filters today", () => {
    const rooms = [room(), room({ id: "wr-2", status: "closed", closedAt: T0 + 1, incidentIds: ["dp-p-3"] })];
    expect(openWarRoomCount(rooms)).toBe(1);
    expect(openRoomsForIncident(rooms, "dp-p-2").map((r) => r.id)).toEqual(["wr-1"]);
    expect(openRoomsForIncident(rooms, "dp-p-3")).toEqual([]);
    const old = room({ status: "closed", openedAt: T0 - 3 * 86_400_000, closedAt: T0 - 2 * 86_400_000 });
    expect(isTodaysRoom(old, T0)).toBe(false);
    expect(isTodaysRoom(room({ openedAt: T0 - 3 * 86_400_000 }), T0)).toBe(true); // still open
  });
});
