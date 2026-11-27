import { beforeEach, describe, expect, it, vi } from "vitest";

const shown: Record<string, unknown>[] = [];
vi.mock("@dynatrace/strato-components/notifications", () => ({ showToast: (o: Record<string, unknown>) => shown.push(o) }));

import { __resetNotifications, DEFAULT_NOTIFICATION_PREFS, getNotificationState, markAllRead, notify } from "../notifications";

describe("notification center", () => {
  beforeEach(() => {
    shown.length = 0;
    __resetNotifications();
  });

  it("pops up bottom-right when allowed and records the item as read", () => {
    notify({ category: "action", type: "success", title: "Done" });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ position: "bottom-right", title: "Done" });
    expect(getNotificationState()).toMatchObject({ unread: 0 });
    expect(getNotificationState().items).toHaveLength(1);
  });

  it("silenced: no pop-up, the bell counts it as unread", () => {
    __resetNotifications({ ...DEFAULT_NOTIFICATION_PREFS, popups: false });
    notify({ category: "incident", type: "critical", title: "P1 · Down", link: "/incidents/x" });
    expect(shown).toHaveLength(0);
    expect(getNotificationState().unread).toBe(1);
    markAllRead();
    expect(getNotificationState().unread).toBe(0);
  });

  it("a category turned off never pops up but is still listed", () => {
    __resetNotifications({ ...DEFAULT_NOTIFICATION_PREFS, categories: { ...DEFAULT_NOTIFICATION_PREFS.categories, action: false } });
    notify({ category: "action", type: "success", title: "Saved" });
    notify({ category: "error", type: "critical", title: "Failed" });
    expect(shown.map((s) => s.title)).toEqual(["Failed"]);
    expect(getNotificationState().items.map((i) => i.title)).toEqual(["Failed", "Saved"]);
  });
});
