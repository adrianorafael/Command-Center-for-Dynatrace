/**
 * Which Console row actions show as inline buttons and which stay in the row's "⋯" menu. Pure: no React, no
 * storage. The choice is kept per viewer in hooks/prefs.ts (`consoleInlineActions`), normalized here on every read.
 */

/** Every row action, in the order the "⋯" menu lists them. */
export const ROW_ACTION_IDS = [
  "ack",
  "resolve",
  "reassign",
  "escalate",
  "snooze",
  "priority",
  "note",
  "warroom",
  "davis",
  "copylink",
] as const;

export type RowActionId = (typeof ROW_ACTION_IDS)[number];

/** Labels in the picker; the row buttons use the same words (war room says Join or Open per row). */
export const ROW_ACTION_LABEL: Record<RowActionId, string> = {
  ack: "Acknowledge",
  resolve: "Resolve",
  reassign: "Reassign",
  escalate: "Escalate now",
  snooze: "Snooze",
  priority: "Change priority",
  note: "Add note",
  warroom: "War room",
  davis: "Open Davis problem",
  copylink: "Copy link",
};

/** More than four icon buttons makes the actions column crowd the incident title. */
export const MAX_INLINE_ACTIONS = 4;

/** What rows showed inline before the choice existed, so nobody's table changes until they pick. */
export const DEFAULT_INLINE_ACTIONS: readonly RowActionId[] = ["ack", "resolve"];

const KNOWN = new Set<string>(ROW_ACTION_IDS);

export function isRowActionId(v: unknown): v is RowActionId {
  return typeof v === "string" && KNOWN.has(v);
}

/**
 * Stored value → a valid inline list. Not an array (missing in prefs saved before this field, or corrupt) → the
 * default. An array keeps its order, drops unknown ids (actions removed in a later version) and duplicates, and is
 * cut at the maximum. An empty array stays empty: the person chose to keep every action in the menu.
 * Always a fresh array, so callers can't mutate the default.
 */
export function normalizeInlineActions(raw: unknown): RowActionId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_INLINE_ACTIONS];
  const out: RowActionId[] = [];
  for (const v of raw) {
    if (isRowActionId(v) && !out.includes(v)) out.push(v);
    if (out.length === MAX_INLINE_ACTIONS) break;
  }
  return out;
}

/** Actions for the "⋯" menu: everything not inline, in menu order, so no action shows twice on a row. */
export function menuActions(inline: readonly RowActionId[]): RowActionId[] {
  return ROW_ACTION_IDS.filter((id) => !inline.includes(id));
}

/** Add (at the end) or remove one action; adding past the maximum is a no-op. */
export function toggleInlineAction(inline: readonly RowActionId[], id: RowActionId): RowActionId[] {
  if (inline.includes(id)) return inline.filter((x) => x !== id);
  return inline.length >= MAX_INLINE_ACTIONS ? [...inline] : [...inline, id];
}

/** Move one chosen action up (-1) or down (+1); out of range or not chosen → unchanged. */
export function moveInlineAction(inline: readonly RowActionId[], id: RowActionId, dir: -1 | 1): RowActionId[] {
  const i = inline.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= inline.length) return [...inline];
  const next = [...inline];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Same list in the same order (the picker enables "Reset to default" and "Save" only when something differs). */
export function sameInlineActions(a: readonly RowActionId[], b: readonly RowActionId[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
