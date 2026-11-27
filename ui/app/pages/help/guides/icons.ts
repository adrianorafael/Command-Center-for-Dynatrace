/**
 * Icon tokens in the guides: `:icon[SettingIcon]:` in the markdown becomes the app's own icon in the Help page.
 *
 * Why this exists: the guides describe buttons and indicators by their icon, and an emoji (⚙️, 🔔, ⋮…) never looks
 * like the Strato icon the app really shows. Markdown cannot hold React components and Strato's Markdown takes no
 * plugins, so the guide names the icon in a small token and GuideView swaps it for the component. Only the names below
 * are recognised (an explicit allowlist, checked by a test over every guide); anything else stays plain text.
 * Each name is the Strato export the app uses for that control (see `source`), except the four `Health*` names, which
 * are the HealthIndicator shapes of the incident status.
 *
 * Pure: no React, so the generator and the tests can use it.
 */
import type { Language } from "./content";

export interface GuideIconInfo {
  /** Where the app shows this icon, for whoever maintains the list. */
  source: string;
  /** Accessible name (aria-label and tooltip) in each language. */
  label: Record<Language, string>;
}

const icon = (source: string, en: string, ptBR: string, es: string): GuideIconInfo => ({ source, label: { en, "pt-BR": ptBR, es } });

export const GUIDE_ICONS = {
  NotificationIcon: icon("ShellHeader: bell, nothing new", "Bell", "Sino", "Campana"),
  NotificationActiveIcon: icon("ShellHeader: bell with unread items", "Bell with unread items", "Sino com itens não lidos", "Campana con elementos sin leer"),
  NotificationOffIcon: icon("ShellHeader: bell with pop-ups silenced", "Bell, pop-ups silenced", "Sino, pop-ups silenciados", "Campana, ventanas emergentes silenciadas"),
  CallIcon: icon("ShellHeader on-call indicator; ChannelIcon voice", "Phone", "Telefone", "Teléfono"),
  SettingIcon: icon("ShellHeader: Settings button", "Settings", "Configurações", "Configuración"),
  MobileIcon: icon("ChannelIcon: SMS", "SMS", "SMS", "SMS"),
  ChatIcon: icon("ChannelIcon: chat apps", "Chat", "Chat", "Chat"),
  HttpIcon: icon("ChannelIcon: HTTP (IFTTT, webhook)", "HTTP", "HTTP", "HTTP"),
  CriticalFailedIcon: icon("IncidentTable Last notified: failed", "Failed", "Falhou", "Falló"),
  AiIcon: icon("IncidentTable source: Davis problem", "Davis (AI)", "Davis (IA)", "Davis (IA)"),
  EventIcon: icon("IncidentTable source: event", "Event", "Evento", "Evento"),
  ArrowUpIcon: icon("IncidentTable / timeline: escalate", "Escalate", "Escalar", "Escalar"),
  PauseIcon: icon("IncidentTable / timeline: snooze", "Snooze", "Adiar", "Posponer"),
  AccountIcon: icon("IncidentTable / timeline: assignee, reassign", "Assignee", "Responsável", "Responsable"),
  EditIcon: icon("IncidentTable / timeline: priority or tag change", "Edit", "Editar", "Editar"),
  DescriptionIcon: icon("IncidentTable / timeline: note", "Note", "Nota", "Nota"),
  GroupIcon: icon("IncidentTable war room; EscalationProgress whole team", "Team", "Equipe", "Equipo"),
  ClockIcon: icon("AgeText over the acknowledge target; KpiStrip MTTA", "Clock", "Relógio", "Reloj"),
  MuteIcon: icon("IncidentTimeline: suppressed", "Suppressed", "Suprimido", "Suprimido"),
  RepeatIcon: icon("EscalationProgress / PolicyView: the policy repeats", "Repeats", "Repete", "Se repite"),
  SuccessIcon: icon("EscalationProgress step done; rule test condition met", "Done", "Concluído", "Hecho"),
  XmarkIcon: icon("ServicesPage rule test: condition not met", "Not met", "Não atendida", "No cumplida"),
  CircleIcon: icon("EscalationProgress: pending step", "Pending", "Pendente", "Pendiente"),
  LockIcon: icon("ServicesPage: default route", "Default route", "Rota padrão", "Ruta predeterminada"),
  PlayIcon: icon("ServicesPage Run test; IntegrationsPage Send test", "Run", "Executar", "Ejecutar"),
  KeyIcon: icon("IntegrationsPage: Credential Vault", "Credential Vault", "Credential Vault", "Credential Vault"),
  FlowIcon: icon("IntegrationsPage: workflow", "Workflow", "Workflow", "Workflow"),
  DotMenuIcon: icon("IncidentTable / IncidentDetails: more actions menu", "More actions", "Mais ações", "Más acciones"),
  HealthCritical: icon("StatusIndicator: triggered", "Triggered", "Disparado", "Disparado"),
  HealthWarning: icon("StatusIndicator: acknowledged", "Acknowledged", "Reconhecido", "Reconocido"),
  HealthNeutral: icon("StatusIndicator: snoozed", "Snoozed", "Adiado", "Pospuesto"),
  HealthIdeal: icon("StatusIndicator: resolved", "Resolved", "Resolvido", "Resuelto"),
} satisfies Record<string, GuideIconInfo>;

export type GuideIconName = keyof typeof GUIDE_ICONS;

export function isGuideIconName(v: string): v is GuideIconName {
  return Object.prototype.hasOwnProperty.call(GUIDE_ICONS, v);
}

/** `:icon[Name]:`; the name is letters only, so a token never spans markdown syntax. */
export const ICON_TOKEN = /:icon\[([A-Za-z]+)\]:/g;

export type IconTextPart = string | { icon: GuideIconName };

/** Splits text at known icon tokens; an unknown name stays in the text exactly as written. */
export function splitIconTokens(text: string): IconTextPart[] {
  const parts: IconTextPart[] = [];
  let last = 0;
  let buffer = "";
  for (const m of text.matchAll(ICON_TOKEN)) {
    const name = m[1];
    if (!isGuideIconName(name)) continue;
    buffer += text.slice(last, m.index);
    if (buffer) parts.push(buffer);
    buffer = "";
    parts.push({ icon: name });
    last = (m.index ?? 0) + m[0].length;
  }
  buffer += text.slice(last);
  if (buffer) parts.push(buffer);
  return parts;
}

/**
 * Pictographs a guide must not contain: emoji, dingbats, the symbol blocks they come from, the emoji variation
 * selector, and the few geometric symbols (⋮ ⋯ ○ ●) that were used as stand-ins for icons. Arrows (→), dashes,
 * the ellipsis (…) and math symbols such as ≈ are text and stay allowed.
 */
export const PICTOGRAPH = /[\p{Extended_Pictographic}\u{2190}-\u{2191}\u{2193}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{22EE}\u{22EF}\u{FE0F}\u{1F000}-\u{1FAFF}]/u;
