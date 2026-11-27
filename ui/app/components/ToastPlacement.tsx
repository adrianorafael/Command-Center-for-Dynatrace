/**
 * Puts the app's pop-ups (Strato toasts) in the top-right corner, just below the header bar with the bell.
 *
 * Strato's ToastContainer only offers bottom positions, so the container gets a class and a small style sheet
 * moves it: `top` follows the bottom edge of the header (measured, so a header that wraps on a narrow window is
 * respected) and the pop-ups slide in from the right instead of from the bottom edge.
 */
import React, { useLayoutEffect, useRef } from "react";

/** Class given to the ToastContainer (App.tsx). */
export const TOAST_CLASS = "cc-toasts-top-right";
/** CSS variable holding the distance from the top of the app to the first pop-up. */
const TOP_VAR = "--cc-toast-top";
/** Space between the header and the first pop-up. */
const GAP_PX = 8;

const CSS = `
.${TOAST_CLASS} .Toastify__toast-container {
  top: var(${TOP_VAR}, 64px) !important;
  bottom: auto !important;
  right: var(--dt-spacings-size-16, 16px) !important;
  left: auto !important;
  transform: none !important;
}
@keyframes cc-toast-in { from { transform: translateX(calc(100% + 16px)); } to { transform: translateX(0); } }
@keyframes cc-toast-out { from { transform: translateX(0); } to { transform: translateX(calc(100% + 16px)); } }
.${TOAST_CLASS} .strato__toast__enter { animation-name: cc-toast-in; }
.${TOAST_CLASS} .strato__toast__exit { animation-name: cc-toast-out; }
@media (prefers-reduced-motion) {
  .${TOAST_CLASS} .strato__toast__enter, .${TOAST_CLASS} .strato__toast__exit { animation-duration: 0s; }
}
`;

/**
 * Wraps the header. Keeps the CSS variable in step with the header's bottom edge and renders the style sheet once.
 */
export function ToastAnchor({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty(TOP_VAR, `${Math.max(0, Math.round(el.getBoundingClientRect().bottom)) + GAP_PX}px`);
    update();
    // The header can grow (narrow window) and the page can scroll it away; follow both.
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    ro?.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);
  return (
    <div ref={ref}>
      <style>{CSS}</style>
      {children}
    </div>
  );
}
