/**
 * Column widths of the guide tables (GuideView), decided from the cell texts.
 *
 * Why this exists: with plain automatic table layout, a column of short values next to a long prose column is squeezed
 * to its longest word, so "1–240" or "Generic webhook" broke over two lines. The rules below keep short cells on one
 * line and give name columns room first; a table that still cannot fit scrolls sideways inside its frame.
 *
 * Pure: no React.
 */
import { ICON_TOKEN } from "./icons";

/** A column whose every cell is at most this long (an icon counts as one character) never wraps. */
export const SHORT_CELL = 32;
/** A column of names (every cell at most this long) gets room for its longest name, up to 13em, before prose does. */
const NAME_CELL = 64;
/** Prose never gets narrower than this; on a narrow window the table scrolls instead of stacking one word per line. */
const PROSE_MIN_EM = 15;

/**
 * Per-column rules for one table, from its cell texts: a column of short cells (keys, values, defaults) keeps each
 * cell on one line, a column of names (setting names, providers) gets a minimum width, and prose gets a readable
 * minimum, so "1–240" or "Generic webhook" never break over two lines and a narrow window scrolls the table instead.
 */
export function columnRules(rows: readonly (readonly string[])[]): { col: number; nowrap?: true; minWidthEm?: number }[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const rules: { col: number; nowrap?: true; minWidthEm?: number }[] = [];
  for (let col = 0; col < width; col++) {
    const longest = Math.max(0, ...rows.map((r) => (r[col] ?? "").replace(ICON_TOKEN, "I").trim().length));
    if (longest <= SHORT_CELL) rules.push({ col, nowrap: true });
    else if (longest <= NAME_CELL) rules.push({ col, minWidthEm: Math.min(13, Math.ceil(longest * 0.5)) });
    else rules.push({ col, minWidthEm: PROSE_MIN_EM });
  }
  return rules;
}
