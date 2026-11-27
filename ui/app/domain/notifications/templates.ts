/**
 * Message rendering with per-channel length limits.
 * Texts include displayId, priority, title, service and the incident link; voice gets a
 * speech text without URLs (spoken by the provider's text-to-speech).
 */

import type { Channel, Incident } from "../contracts";

/** Maximum message text length per channel (characters). */
export const TEXT_LIMITS: Record<Channel, number> = {
  sms: 300,
  voice: 300,
  whatsapp: 1000,
  telegram: 3500,
  slack: 3000,
  teams: 3000,
  ifttt: 1000,
  webhook: 4000,
};
/** Maximum subject length (characters). */
export const SUBJECT_LIMIT = 150;
/** Maximum length of the text read out on voice calls (characters). */
export const SPEECH_LIMIT = 600;

export interface TemplateContext {
  incidentUrl: string;
  serviceName?: string;
  teamName?: string;
  /** Escalation pass (0-based) and step index, for "repeat 2" hints. */
  pass?: number;
  stepIndex?: number;
  attempt?: number;
  /** Product label shown in messages. */
  appName?: string;
}

/** `speech` is set for the voice channel only. */
export interface RenderedMessage {
  subject: string;
  text: string;
  speech?: string;
}

/** Truncate to `max` chars with an ellipsis; collapses whitespace. */
export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return max <= 1 ? t.slice(0, max) : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Strip a little markdown (Davis descriptions are markdown). */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The id operators recognise: the source display id (e.g. P-24051), else the incident id. */
export function incidentLabel(inc: Incident): string {
  return inc.alert.displayId ?? inc.id;
}

/** Spell ids for TTS: "P-00012" → "P 0 0 0 1 2". */
export function speakableId(id: string): string {
  return id.replace(/[-_.]/g, " ").replace(/(\d)/g, " $1 ").replace(/\s+/g, " ").trim();
}

/** "[P1] P-24051 Title · Command Center", truncated to SUBJECT_LIMIT. */
export function renderSubject(inc: Incident, ctx: TemplateContext): string {
  const app = ctx.appName ?? "Command Center";
  return truncate(`[${inc.priority}] ${incidentLabel(inc)} ${inc.alert.title} · ${app}`, SUBJECT_LIMIT);
}

/** Channel-specific text. The URL is always kept intact (title/details are shortened first). */
export function renderText(inc: Incident, channel: Channel, ctx: TemplateContext): string {
  const limit = TEXT_LIMITS[channel];
  const label = incidentLabel(inc);
  const svc = ctx.serviceName ? ` · ${ctx.serviceName}` : "";
  const team = ctx.teamName ? ` · ${ctx.teamName}` : "";
  const repeat = ctx.pass && ctx.pass > 0 ? ` (repeat ${ctx.pass})` : "";
  const head = `${inc.priority} ${label}${repeat}: `;
  const tail = ` ${svc ? svc.slice(3) + " " : ""}Ack: ${ctx.incidentUrl}`;
  if (channel === "sms" || channel === "voice") {
    const room = Math.max(10, limit - head.length - tail.length);
    return truncate(`${head}${truncate(inc.alert.title, room)}${tail}`, limit);
  }
  const desc = inc.alert.description ? plainText(inc.alert.description) : "";
  const entities = inc.alert.entities
    .slice(0, 5)
    .map((e) => e.name ?? e.id)
    .join(", ");
  const lines = [
    `${head}${inc.alert.title}`,
    `Status: ${inc.status}${svc}${team}`,
    entities ? `Affected: ${entities}` : "",
    desc ? `Details: ${desc}` : "",
  ].filter(Boolean);
  const link = `Open: ${ctx.incidentUrl}`;
  const body = truncate(lines.join("\n"), Math.max(20, limit - link.length - 1));
  return `${body}\n${link}`;
}

/** Text-to-speech script: no URL, the id spelled out. */
export function renderSpeech(inc: Incident, ctx: TemplateContext): string {
  const p = inc.priority.replace("P", "priority ");
  const svc = ctx.serviceName ? ` on service ${ctx.serviceName}` : "";
  return truncate(
    `This is ${ctx.appName ?? "Command Center"}. ${p} incident ${speakableId(incidentLabel(inc))}${svc}. ${inc.alert.title}. Please acknowledge in the Command Center app.`,
    SPEECH_LIMIT,
  );
}

/** Subject, channel text and (voice only) speech for one notification. */
export function renderMessage(inc: Incident, channel: Channel, ctx: TemplateContext): RenderedMessage {
  return {
    subject: renderSubject(inc, ctx),
    text: renderText(inc, channel, ctx),
    ...(channel === "voice" ? { speech: renderSpeech(inc, ctx) } : {}),
  };
}

/** Relative app path used when the absolute app URL is unknown (links then only work inside Dynatrace). */
export const DEFAULT_APP_BASE_URL = "/ui/apps/my.command.center";

/** Link to the incident detail page. `appBaseUrl` should be absolute for outbound messages. */
export function incidentUrl(incidentId: string, appBaseUrl = DEFAULT_APP_BASE_URL): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/incidents/${encodeURIComponent(incidentId)}`;
}
