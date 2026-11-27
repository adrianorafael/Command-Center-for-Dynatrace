import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INLINE_ACTIONS,
  MAX_INLINE_ACTIONS,
  menuActions,
  moveInlineAction,
  normalizeInlineActions,
  ROW_ACTION_IDS,
  sameInlineActions,
  toggleInlineAction,
} from "../console/rowActions";

describe("normalizeInlineActions", () => {
  it("defaults to Acknowledge + Resolve when nothing valid is stored", () => {
    expect(DEFAULT_INLINE_ACTIONS).toEqual(["ack", "resolve"]);
    for (const raw of [undefined, null, "ack", 3, { 0: "ack" }]) expect(normalizeInlineActions(raw)).toEqual(["ack", "resolve"]);
  });

  it("returns a fresh array, never the default itself", () => {
    const a = normalizeInlineActions(undefined);
    a.push("note");
    expect(DEFAULT_INLINE_ACTIONS).toEqual(["ack", "resolve"]);
  });

  it("keeps order, drops unknown ids, non-strings and duplicates", () => {
    expect(normalizeInlineActions(["note", "bogus", 7, "ack", "note", "davis"])).toEqual(["note", "ack", "davis"]);
  });

  it("caps at the maximum", () => {
    expect(MAX_INLINE_ACTIONS).toBe(4);
    expect(normalizeInlineActions([...ROW_ACTION_IDS])).toEqual(["ack", "resolve", "reassign", "escalate"]);
  });

  it("keeps an explicit empty choice", () => {
    expect(normalizeInlineActions([])).toEqual([]);
    expect(normalizeInlineActions(["gone"])).toEqual([]);
  });
});

describe("menuActions", () => {
  it("lists every action not inline, in menu order", () => {
    const menu = menuActions(["snooze", "ack"]);
    expect(menu).not.toContain("snooze");
    expect(menu).not.toContain("ack");
    expect(menu).toEqual(ROW_ACTION_IDS.filter((id) => id !== "snooze" && id !== "ack"));
    expect(menuActions([])).toEqual([...ROW_ACTION_IDS]);
  });
});

describe("toggleInlineAction / moveInlineAction", () => {
  it("adds at the end, removes, and refuses a fifth", () => {
    expect(toggleInlineAction(["ack"], "note")).toEqual(["ack", "note"]);
    expect(toggleInlineAction(["ack", "note"], "ack")).toEqual(["note"]);
    const full = ["ack", "resolve", "note", "davis"] as const;
    expect(toggleInlineAction(full, "snooze")).toEqual([...full]);
  });

  it("moves within bounds only", () => {
    expect(moveInlineAction(["ack", "resolve", "note"], "note", -1)).toEqual(["ack", "note", "resolve"]);
    expect(moveInlineAction(["ack", "resolve"], "ack", 1)).toEqual(["resolve", "ack"]);
    expect(moveInlineAction(["ack", "resolve"], "ack", -1)).toEqual(["ack", "resolve"]);
    expect(moveInlineAction(["ack", "resolve"], "resolve", 1)).toEqual(["ack", "resolve"]);
    expect(moveInlineAction(["ack"], "note", 1)).toEqual(["ack"]);
  });

  it("compares order-sensitively", () => {
    expect(sameInlineActions(["ack", "resolve"], ["ack", "resolve"])).toBe(true);
    expect(sameInlineActions(["resolve", "ack"], ["ack", "resolve"])).toBe(false);
  });
});

describe("stored prefs", () => {
  const store = new Map<string, string>();
  const stubWindow = () =>
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("prefs saved before the field existed get the default; bad ids are dropped", async () => {
    stubWindow();
    const { readPrefs, writePrefs } = await import("../../hooks/prefs");
    store.set("command-center.ui-prefs.v1", JSON.stringify({ keyboardShortcuts: false, tableDensity: "default", ackTargetMin: 9 }));
    expect(readPrefs()).toMatchObject({ keyboardShortcuts: false, ackTargetMin: 9, consoleInlineActions: ["ack", "resolve"] });
    writePrefs({ ...readPrefs(), consoleInlineActions: ["note", "bogus", "ack"] as never });
    expect(readPrefs().consoleInlineActions).toEqual(["note", "ack"]);
    expect(readPrefs().ackTargetMin).toBe(9);
  });
});
