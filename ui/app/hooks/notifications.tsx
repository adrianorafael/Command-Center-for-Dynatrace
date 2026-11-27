/**
 * In-app notification center.
 *
 * Every toast in the app goes through `notify()`: it is recorded in a small in-memory list (shown by the
 * header bell with an unread count) and shown as a pop-up in the bottom-right corner unless the viewer
 * silenced pop-ups or turned that category off. Preferences are per browser (localStorage, guarded).
 */
import type React from "react";
import { useSyncExternalStore } from "react";
import { showToast } from "@dynatrace/strato-components/notifications";

/** Categories the viewer can mute separately (Settings → Notifications). */
export type NotificationCategory = "incident" | "action" | "error" | "engine";

/** Label of each category in the preferences UI. */
export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  incident: "New P1/P2 incidents",
  action: "Confirmations of my actions",
  error: "Errors",
  engine: "Paging engine health",
};

/** One entry of the header bell list; `at` is epoch ms. */
export interface AppNotification {
  id: number;
  at: number;
  category: NotificationCategory;
  type: "success" | "info" | "warning" | "critical";
  title: string;
  message?: string;
  /** In-app route to open when the notification is selected. */
  link?: string;
  read: boolean;
}

/** Per-browser notification preferences. */
export interface NotificationPrefs {
  /** false = silenced: notifications are only counted in the header bell. */
  popups: boolean;
  categories: Record<NotificationCategory, boolean>;
}

const PREFS_KEY = "command-center.notification-prefs.v1";
const MAX_ITEMS = 50;
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  popups: true,
  categories: { incident: true, action: true, error: true, engine: true },
};

function readPrefs(): NotificationPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const p = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      popups: p.popups ?? true,
      categories: { ...DEFAULT_NOTIFICATION_PREFS.categories, ...(p.categories ?? {}) },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

interface State {
  items: AppNotification[];
  prefs: NotificationPrefs;
}

let state: State = { items: [], prefs: typeof window === "undefined" ? DEFAULT_NOTIFICATION_PREFS : readPrefs() };
let nextId = 1;
const listeners = new Set<() => void>();

function emit(next: State): void {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Input of notify(); `lifespan` is the pop-up duration in ms (default 4 s). */
export interface NotifyOptions {
  category: NotificationCategory;
  type: AppNotification["type"];
  title: string;
  message?: string;
  link?: string;
  lifespan?: number | "infinite";
  actions?: React.JSX.Element;
}

/** Record a notification and, if allowed by the viewer's preferences, show it as a pop-up. */
export function notify(o: NotifyOptions): void {
  const item: AppNotification = {
    id: nextId++,
    at: Date.now(),
    category: o.category,
    type: o.type,
    title: o.title,
    ...(o.message ? { message: o.message } : {}),
    ...(o.link ? { link: o.link } : {}),
    read: false,
  };
  const popup = state.prefs.popups && state.prefs.categories[o.category];
  // A pop-up the viewer sees counts as read; silenced ones stay unread in the bell.
  if (popup) item.read = true;
  emit({ ...state, items: [item, ...state.items].slice(0, MAX_ITEMS) });
  if (popup) {
    showToast({
      type: o.type,
      title: o.title,
      message: o.message,
      lifespan: o.lifespan ?? 4_000,
      actions: o.actions,
      position: "bottom-right",
    });
  }
}

/** Marks every bell entry read. */
export function markAllRead(): void {
  emit({ ...state, items: state.items.map((i) => (i.read ? i : { ...i, read: true })) });
}

/** Empties the bell list. */
export function clearNotifications(): void {
  emit({ ...state, items: [] });
}

/** Saves the preferences (best effort) and applies them at once. */
export function setNotificationPrefs(prefs: NotificationPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: the preference lasts for this session only
  }
  emit({ ...state, prefs });
}

/** Subscribes a component to the bell list and preferences. */
export function useNotifications(): State & { unread: number } {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  return { ...s, unread: s.items.filter((i) => !i.read).length };
}

/** Test hook: reset the module state. */
export function __resetNotifications(prefs: NotificationPrefs = DEFAULT_NOTIFICATION_PREFS): void {
  nextId = 1;
  emit({ items: [], prefs });
}

/** Non-React read of the current state (tests, diagnostics). */
export function getNotificationState(): State & { unread: number } {
  return { ...state, unread: state.items.filter((i) => !i.read).length };
}
