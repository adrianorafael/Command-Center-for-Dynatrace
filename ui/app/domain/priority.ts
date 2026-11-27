/**
 * Priority helpers. P1 is the most urgent; rank = 1 … 5.
 * Use these everywhere instead of comparing strings, so boundaries are never inverted.
 */

import { PRIORITIES, type Priority } from "./contracts";

/** 1 for P1 … 5 for P5. */
export function priorityRank(p: Priority): number {
  return PRIORITIES.indexOf(p) + 1;
}

/** `a` is as urgent as `b` or more (P1 vs P3 → true). */
export function atLeastAsUrgent(a: Priority, b: Priority): boolean {
  return priorityRank(a) <= priorityRank(b);
}

/** `a` is strictly less urgent than `b` (P4 vs P3 → true). */
export function lessUrgentThan(a: Priority, b: Priority): boolean {
  return priorityRank(a) > priorityRank(b);
}

/** Type guard for an exact Priority string. */
export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
}

/** Lenient parse: "P1", "p2", "3", 4 → Priority; otherwise undefined. */
export function parsePriority(v: unknown): Priority | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) return `P${v}` as Priority;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toUpperCase();
  if (isPriority(s)) return s;
  if (/^[1-5]$/.test(s)) return `P${s}` as Priority;
  return undefined;
}

/** Sort comparator: most urgent first. */
export function byUrgency(a: Priority, b: Priority): number {
  return priorityRank(a) - priorityRank(b);
}
