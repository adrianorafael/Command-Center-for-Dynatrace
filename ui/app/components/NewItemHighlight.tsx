import React, { useEffect, useRef } from "react";
import Colors from "@dynatrace/strato-design-tokens/colors";

/**
 * Draws attention to something that was just created by a button click: the wrapped row takes the menu
 * hover look with an outline and fades back, in one soft 1-second pulse. Uses the Web Animations API, so no
 * stylesheet is needed and the element's own styles are untouched once the animation ends. With
 * `prefers-reduced-motion` it starts highlighted and simply fades out.
 */
export const NewItemHighlight = ({
  active,
  children,
  radius = 6,
}: {
  /** Animate when true (typically: this item was added in the last action). */
  active: boolean;
  children: React.ReactNode;
  radius?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof el.animate !== "function") return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const off = { backgroundColor: "transparent", boxShadow: "0 0 0 0 transparent" };
    // Same look as hovering a menu item (field hover background) plus an outline, one soft pulse in 1 s.
    const on = {
      backgroundColor: Colors.Background.Field.Neutral.DefaultHover,
      boxShadow: `0 0 0 2px ${Colors.Border.Primary.Accent}`,
    };
    const animation = reduced
      ? el.animate([on, off], { duration: 1000, easing: "ease-out" })
      : el.animate([{ ...off, offset: 0 }, { ...on, offset: 0.35 }, { ...off, offset: 1 }], { duration: 1000, easing: "ease-in-out" });
    return () => animation.cancel();
  }, [active]);

  return (
    <div ref={ref} style={{ borderRadius: radius, padding: "4px 6px", margin: "-4px -6px" }}>
      {children}
    </div>
  );
};
