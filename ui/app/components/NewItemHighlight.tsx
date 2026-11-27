import React, { useEffect, useRef } from "react";
import Colors from "@dynatrace/strato-design-tokens/colors";

/**
 * "Just created" highlight, used for every item a user creates in a list with a button.
 *
 * - `pulse(el)`: one soft 1-second pulse with the menu-hover look plus an outline (Web Animations API,
 *   Strato tokens, no stylesheet). With `prefers-reduced-motion` it starts highlighted and fades out.
 * - `markCreated(kind, id)`: called by whatever created the item (form save, quick action).
 * - `<CreatedMarker kind id />`: an invisible marker rendered inside each list item. When the item
 *   mounts within a few seconds of `markCreated` (or is already on screen when it is called), it pulses
 *   its row: the closest table row, else the closest `[data-created-scope]` element, else the closest Strato
 *   Surface (cards in forms), else its parent.
 * - `<NewItemHighlight active>`: wrapper for small lists the caller controls directly (form drafts).
 */

const WINDOW_MS = 6_000;
const created = new Map<string, number>();
const listeners = new Set<(key: string) => void>();
const keyOf = (kind: string, id: string) => `${kind}:${id}`;

export function markCreated(kind: string, id: string): void {
  const key = keyOf(kind, id);
  created.set(key, Date.now());
  listeners.forEach((l) => l(key));
}

/** True once per marked item, within the window (the first marker that sees it consumes it). */
export function consumeCreated(kind: string, id: string): boolean {
  const key = keyOf(kind, id);
  const at = created.get(key);
  if (at === undefined) return false;
  created.delete(key);
  return Date.now() - at <= WINDOW_MS;
}

export function pulse(el: HTMLElement | null | undefined): void {
  if (!el || typeof el.animate !== "function") return;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const off = { backgroundColor: "transparent", boxShadow: "inset 0 0 0 0 transparent" };
  // Same look as hovering a menu item (field hover background) plus an outline, one soft pulse in 1 s.
  const on = {
    backgroundColor: Colors.Background.Field.Neutral.DefaultHover,
    boxShadow: `inset 0 0 0 2px ${Colors.Border.Primary.Accent}`,
  };
  if (reduced) el.animate([on, off], { duration: 1000, easing: "ease-out" });
  else el.animate([{ ...off, offset: 0 }, { ...on, offset: 0.35 }, { ...off, offset: 1 }], { duration: 1000, easing: "ease-in-out" });
}

function rowOf(marker: HTMLElement): HTMLElement | null {
  return (
    marker.closest<HTMLElement>('[role="row"]') ??
    marker.closest<HTMLElement>("[data-created-scope]") ??
    marker.closest<HTMLElement>('[data-dt-component="Surface"]') ??
    marker.parentElement
  );
}

/** Invisible marker placed inside a list item; pulses the item when it was just created. */
export const CreatedMarker = ({ kind, id }: { kind: string; id: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tryPulse = () => {
      if (ref.current && consumeCreated(kind, id)) pulse(rowOf(ref.current));
    };
    tryPulse();
    const onMark = (key: string) => {
      if (key === keyOf(kind, id)) tryPulse();
    };
    listeners.add(onMark);
    return () => {
      listeners.delete(onMark);
    };
  }, [kind, id]);
  return <span ref={ref} aria-hidden style={{ display: "none" }} />;
};

/** Wrapper for lists the caller controls: pulses when `active` turns true. */
export const NewItemHighlight = ({ active, children, radius = 6 }: { active: boolean; children: React.ReactNode; radius?: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) pulse(ref.current);
  }, [active]);
  return (
    <div ref={ref} style={{ borderRadius: radius, padding: "4px 6px", margin: "-4px -6px" }}>
      {children}
    </div>
  );
};

/**
 * For draft lists edited in a form (steps, layers, contact methods…): remembers which index was just
 * added by a button so that row can be wrapped in `<NewItemHighlight active>`.
 */
export function useJustAdded(): [number | undefined, (index: number) => void] {
  const [i, setI] = React.useState<number>();
  return [i, setI];
}
