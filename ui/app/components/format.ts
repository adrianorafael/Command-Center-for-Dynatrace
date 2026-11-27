/** Formatting helpers shared by every screen (UI-only, no domain logic). */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "45 s", "12 min", "3 h 4 min", "2 d 5 h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  const abs = Math.max(0, Math.round(ms));
  if (abs < MIN) return `${Math.round(abs / 1000)} s`;
  if (abs < HOUR) return `${Math.floor(abs / MIN)} min`;
  if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    const m = Math.floor((abs % HOUR) / MIN);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(abs / DAY);
  const h = Math.floor((abs % DAY) / HOUR);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** Relative age "12 min ago" / "in 5 min". */
export function formatRelative(at: number, now: number): string {
  const diff = now - at;
  if (Math.abs(diff) < 30_000) return "just now";
  return diff >= 0 ? `${formatDuration(diff)} ago` : `in ${formatDuration(-diff)}`;
}

function fmt(at: number, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", opts).format(at);
  }
}

/** "14:02" */
export function formatTime(at: number, timeZone?: string, seconds = false): string {
  return fmt(at, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hourCycle: "h23",
  });
}

/** "Fri 09:00" */
export function formatDayTime(at: number, timeZone?: string): string {
  return fmt(at, timeZone, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** "Fri, Dec 4, 09:00" */
export function formatDayDateTime(at: number, timeZone?: string): string {
  return fmt(at, timeZone, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** "Nov 26, 2026, 14:02:31 CET" */
export function formatDateTime(at: number, timeZone?: string): string {
  return fmt(at, timeZone, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
}

/** "Thu, Nov 26" — day header for timelines. */
export function formatDay(at: number, timeZone?: string): string {
  return fmt(at, timeZone, { weekday: "short", month: "short", day: "numeric" });
}

/** Short zone abbreviation, e.g. "CET". */
export function zoneAbbr(at: number, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Initials for an Avatar abbreviation. */
export function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** "+43 ••• ••• 123" — never show a full phone number in lists. */
export function maskAddress(address: string): string {
  if (/^\+?[0-9 ]{6,}$/.test(address)) {
    const digits = address.replace(/\s/g, "");
    return `${digits.slice(0, 3)} ••• ••• ${digits.slice(-3)}`;
  }
  if (address.length > 12) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  return address;
}

/** Browser time zone (fallback for settings.ui.timeZone). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** All IANA zones the runtime knows (fallback list when supportedValuesOf is missing). */
export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.("timeZone");
    if (list && list.length) return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    // ignore
  }
  return ["UTC", "Europe/Vienna", "Europe/Berlin", "Europe/London", "America/New_York", "America/Chicago",
    "America/Los_Angeles", "America/Sao_Paulo", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"];
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** DateTimePicker / TimeframeSelector value → epoch ms (TimeValue.absoluteDate or ISO string). */
export function pickerToMs(v: unknown): number | undefined {
  if (!v) return undefined;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof v === "object" && v !== null && "absoluteDate" in v) {
    const t = Date.parse(String((v as { absoluteDate: unknown }).absoluteDate));
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

export function msToIso(ms: number | undefined): string | null {
  return ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}

const FIELD_LABELS: Record<string, string> = {
  "sources.davisProblems.lookbackHours": "Look back (hours)",
  "sources.genericEvents.eventType": "Generic event type",
  "defaults.priority": "Fallback priority",
  "engine.maxNotificationsPerTick": "Max notifications per run",
  "engine.reportTimeoutSec": "Delivery report timeout",
  "engine.maxAttempts": "Delivery attempts",
  "engine.lockTtlSec": "Engine lock lease",
  "engine.workflowId": "Engine workflow ID",
  "retention.resolvedVisibleHours": "Keep resolved incidents visible",
  "retention.archiveDays": "Archive resolved incidents for",
  "ui.autoRefreshSec": "Auto-refresh default",
  "ui.timeZone": "Tenant time zone",
};
const SEGMENT_LABELS: Record<string, string> = { methods: "Contact method", rules: "Rule", conditions: "Condition", steps: "Step", targets: "Target", layers: "Layer", providers: "Provider", quietHours: "Window" };

/** Turns a validation path such as `methods[4].address` into "Contact method 5 · address" for people. */
export function fieldLabel(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  return path
    .split(".")
    .map((seg) => {
      const m = /^(\w+)\[(\d+)\]$/.exec(seg);
      if (m) return `${SEGMENT_LABELS[m[1] ?? ""] ?? m[1]} ${Number(m[2]) + 1}`;
      return seg.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    })
    .join(" · ");
}

/** "Label: message" lines for a list of validation errors. */
export function describeErrors(errors: readonly { path: string; message: string }[], separator = "  "): string {
  return errors.map((e) => `${fieldLabel(e.path)}: ${e.message}`).join(separator);
}
