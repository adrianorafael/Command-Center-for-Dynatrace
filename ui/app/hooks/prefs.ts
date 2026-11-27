/**
 * Per-viewer UI preferences that the frozen Settings contract has no field for
 * (keyboard shortcuts, table density, acknowledge target, on-call week view). Browser storage only;
 * every access is guarded because storage can be unavailable.
 */
import { useCallback, useState } from "react";

/** The stored per-viewer preferences. */
export interface UiPrefs {
  /** WCAG 2.1.4: single-key shortcuts can be turned off. */
  keyboardShortcuts: boolean;
  tableDensity: "default" | "condensed";
  /** Acknowledge target in minutes: drives the age color and the MTTA meter. */
  ackTargetMin: number;
  /** On-call "Upcoming shifts" week view: show Monday → Friday instead of Sunday → Saturday. */
  shiftsWorkdaysOnly: boolean;
}

export const DEFAULT_PREFS: UiPrefs = { keyboardShortcuts: true, tableDensity: "condensed", ackTargetMin: 5, shiftsWorkdaysOnly: false };

const STORAGE_KEY = "command-center.ui-prefs.v1";

/** Stored preferences over the defaults; the defaults when storage is empty, unreadable or blocked. */
export function readPrefs(): UiPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Best-effort save to localStorage. */
export function writePrefs(p: UiPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable: the preference lasts for this session only
  }
}

/** React state backed by localStorage: the setter saves and updates in one call. */
export function usePrefsState(): [UiPrefs, (p: UiPrefs) => void] {
  const [prefs, setPrefs] = useState<UiPrefs>(() => readPrefs());
  const update = useCallback((p: UiPrefs) => {
    writePrefs(p);
    setPrefs(p);
  }, []);
  return [prefs, update];
}
