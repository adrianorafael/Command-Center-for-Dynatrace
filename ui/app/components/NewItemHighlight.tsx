import React, { useEffect, useRef } from "react";
import Colors from "@dynatrace/strato-design-tokens/colors";

/**
 * Draws attention to something that was just created by a button click: the wrapped row glows in the
 * primary highlight colour and fades out, twice (~2.4 s). Uses the Web Animations API, so no stylesheet
 * is needed and the element's own styles are untouched once the animation ends. With
 * `prefers-reduced-motion` the glow is a single, static highlight that fades once.
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
    const on = {
      backgroundColor: Colors.Background.Container.Primary.Emphasized,
      boxShadow: `0 0 0 2px ${Colors.Border.Primary.Accent}`,
    };
    const animation = reduced
      ? el.animate([on, on, off], { duration: 1600, easing: "ease-out" })
      : el.animate([off, on, off, on, off], { duration: 2400, easing: "ease-in-out" });
    return () => animation.cancel();
  }, [active]);

  return (
    <div ref={ref} style={{ borderRadius: radius, padding: "4px 6px", margin: "-4px -6px" }}>
      {children}
    </div>
  );
};
