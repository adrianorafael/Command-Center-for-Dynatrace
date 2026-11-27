/**
 * Renders one documentation guide inside the app with Strato's Markdown component.
 *
 * Why this exists: the guides are generated markdown (guides/content.ts), and a few things Markdown does not do on its
 * own are needed in the app:
 * - headings need GitHub-style ids so `#anchor` links land;
 * - links between guides must stay in the app (React Router) in the reader's language instead of opening a new tab;
 * - `:icon[Name]:` tokens (guides/icons.ts) become the app's real Strato icons, from an allowlist;
 * - tables are plain, readable HTML tables: Strato maps markdown tables to SimpleTable with equal column widths, and
 *   its wrapper breaks words anywhere, which squeezed short cells (keys, values, code) into broken fragments. Here a
 *   table takes the width its content needs, up to the content area, and scrolls sideways inside its own frame when
 *   it cannot fit.
 * Everything else keeps Strato's default element mappings.
 */
import React, { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { HealthIndicator, Markdown, componentMappings } from "@dynatrace/strato-components/content";
import { Link } from "@dynatrace/strato-components/typography";
import {
  AccountIcon,
  AiIcon,
  ArrowUpIcon,
  CallIcon,
  ChatIcon,
  CircleIcon,
  ClockIcon,
  CriticalFailedIcon,
  DescriptionIcon,
  DotMenuIcon,
  EditIcon,
  EventIcon,
  FlowIcon,
  GroupIcon,
  HttpIcon,
  KeyIcon,
  LockIcon,
  MobileIcon,
  MuteIcon,
  NotificationActiveIcon,
  NotificationIcon,
  NotificationOffIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  SettingIcon,
  SuccessIcon,
  XmarkIcon,
} from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Borders from "@dynatrace/strato-design-tokens/borders";
import Typography from "@dynatrace/strato-design-tokens/typography";
import { isGuideId, type Guide, type Language } from "./guides/content";
import { GUIDE_ICONS, ICON_TOKEN, splitIconTokens, type GuideIconName } from "./guides/icons";
import { helpHref } from "./guides/language";

type MarkdownComponents = NonNullable<React.ComponentProps<typeof Markdown>["customComponentMappings"]>;
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
/** The function form of a mapping (react-markdown.d.ts also allows a plain tag name). */
type MappingFn<K extends keyof MarkdownComponents> = Extract<NonNullable<MarkdownComponents[K]>, (props: never) => React.ReactNode>;
type HeadingProps = Parameters<MappingFn<"h2">>[0];
type AnchorProps = Parameters<MappingFn<"a">>[0];
type TextTag = "p" | "li" | "strong" | "em" | "del";
/** What react-markdown hands a table element: its children, the column alignment as `style`, and bookkeeping. */
interface TableElementProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Strato's default mapping for a tag: always a function in Strato's componentMappings (Markdown.js). */
function stratoDefault<K extends HeadingTag | TextTag | "a">(tag: K) {
  return componentMappings[tag] as unknown as React.ComponentType<K extends "a" ? AnchorProps : HeadingProps>;
}

const STATUS_SHAPE = { HealthCritical: "critical", HealthWarning: "warning", HealthNeutral: "neutral", HealthIdeal: "ideal" } as const;

/** The component and colour of each allowed icon, as the app shows it (the source of each is in guides/icons.ts). */
const ICON_COMPONENTS: Record<Exclude<GuideIconName, keyof typeof STATUS_SHAPE>, { Icon: React.ElementType; color?: string }> = {
  NotificationIcon: { Icon: NotificationIcon },
  NotificationActiveIcon: { Icon: NotificationActiveIcon },
  NotificationOffIcon: { Icon: NotificationOffIcon },
  CallIcon: { Icon: CallIcon },
  SettingIcon: { Icon: SettingIcon },
  MobileIcon: { Icon: MobileIcon },
  ChatIcon: { Icon: ChatIcon },
  HttpIcon: { Icon: HttpIcon },
  CriticalFailedIcon: { Icon: CriticalFailedIcon, color: Colors.Icon.Critical.Default },
  AiIcon: { Icon: AiIcon },
  EventIcon: { Icon: EventIcon },
  ArrowUpIcon: { Icon: ArrowUpIcon, color: Colors.Icon.Primary.Default },
  PauseIcon: { Icon: PauseIcon },
  AccountIcon: { Icon: AccountIcon },
  EditIcon: { Icon: EditIcon },
  DescriptionIcon: { Icon: DescriptionIcon },
  GroupIcon: { Icon: GroupIcon },
  ClockIcon: { Icon: ClockIcon },
  MuteIcon: { Icon: MuteIcon },
  RepeatIcon: { Icon: RepeatIcon },
  SuccessIcon: { Icon: SuccessIcon, color: Colors.Icon.Success.Default },
  XmarkIcon: { Icon: XmarkIcon, color: Colors.Icon.Critical.Default },
  CircleIcon: { Icon: CircleIcon, color: Colors.Icon.Neutral.Subdued },
  LockIcon: { Icon: LockIcon },
  PlayIcon: { Icon: PlayIcon },
  KeyIcon: { Icon: KeyIcon },
  FlowIcon: { Icon: FlowIcon },
  DotMenuIcon: { Icon: DotMenuIcon },
};

const ICON_STYLE: React.CSSProperties = { width: "1.25em", height: "1.25em", verticalAlign: "-0.3em" };

/** One inline icon, sized to the surrounding text and named for screen readers and on hover. */
export const GuideIcon = ({ name, lang }: { name: GuideIconName; lang: Language }) => {
  const label = GUIDE_ICONS[name].label[lang];
  if (name in STATUS_SHAPE) {
    return (
      <span className="cc-guide-icon cc-guide-icon--status" role="img" aria-label={label} title={label}>
        <HealthIndicator status={STATUS_SHAPE[name as keyof typeof STATUS_SHAPE]} visual="shape" aria-hidden />
      </span>
    );
  }
  const { Icon, color } = ICON_COMPONENTS[name as keyof typeof ICON_COMPONENTS];
  return (
    <span className="cc-guide-icon" role="img" aria-label={label} title={label}>
      <Icon aria-hidden style={{ ...ICON_STYLE, color }} />
    </span>
  );
};

/** Replaces icon tokens in the text children of an element; elements and unknown tokens pass through untouched. */
export function withIcons(children: React.ReactNode, lang: Language): React.ReactNode {
  // Adjacent strings are joined first, so a token the parser happened to split is still found.
  const merged: React.ReactNode[] = [];
  for (const child of React.Children.toArray(children)) {
    const prev = merged[merged.length - 1];
    if (typeof child === "string" && typeof prev === "string") merged[merged.length - 1] = prev + child;
    else merged.push(child);
  }
  if (!merged.some((c) => typeof c === "string" && c.includes(":icon["))) return children;
  return merged.flatMap((child, i): React.ReactNode[] =>
    typeof child !== "string"
      ? [child]
      : splitIconTokens(child).map((part, j) => (typeof part === "string" ? part : <GuideIcon key={`icon-${i}-${j}`} name={part.icon} lang={lang} />)),
  );
}

/** Table, header and cell styles; `overflow-wrap` undoes the Markdown wrapper's `anywhere`, which broke short words. */
const TABLE_CSS = `
.cc-guide-table-frame {
  overflow-x: auto;
  max-width: 100%;
  margin: 16px 0 24px;
  border: ${Borders.Width.Default} solid ${Colors.Border.Neutral.Default};
  border-radius: ${Borders.Radius.Container.Default};
}
.cc-guide-table {
  border-collapse: collapse;
  width: 100%;
  font: inherit;
}
.cc-guide-table th,
.cc-guide-table td {
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: break-word;
  word-break: normal;
  hyphens: manual;
  border-bottom: ${Borders.Width.Default} solid ${Colors.Border.Neutral.Default};
}
.cc-guide-table th + th,
.cc-guide-table td + td {
  border-left: ${Borders.Width.Default} solid ${Colors.Border.Neutral.Default};
}
.cc-guide-table tbody tr:last-child td { border-bottom: none; }
.cc-guide-table th {
  vertical-align: bottom;
  white-space: nowrap;
  font-weight: ${Typography.Text.Base.Emphasized.Weight};
  background: ${Colors.Background.Container.Neutral.Default};
}
/* Prose columns get a readable minimum, so a long text next to short columns does not shrink to a few words a line. */
.cc-guide-table td { min-width: 6em; }
/* Code, keys and values never break inside a cell; the frame scrolls instead. */
.cc-guide-table code { white-space: nowrap; }
.cc-guide-icon { display: inline-flex; vertical-align: baseline; line-height: 1; }
.cc-guide-icon--status { vertical-align: -0.05em; margin-right: 0.15em; }
`;

/** Minimal shape of the hast nodes react-markdown passes along (`node` prop). */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  position?: { start: { line: number } };
}

function hastText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

function hastRows(table: HastNode): HastNode[][] {
  const rows: HastNode[][] = [];
  const walk = (n: HastNode) => {
    if (n.tagName === "tr") rows.push((n.children ?? []).filter((c) => c.tagName === "td" || c.tagName === "th"));
    else (n.children ?? []).forEach(walk);
  };
  walk(table);
  return rows;
}

/** A column whose every cell is at most this long (an icon counts as one character) never wraps. */
export const SHORT_CELL = 32;

/**
 * Columns of a table whose cells are all short (keys, values, names, defaults): those keep each cell on one line, so
 * the browser gives the room to the prose columns instead of breaking "1–240" or "Generic webhook" over two lines.
 */
export function shortColumns(rows: readonly (readonly string[])[]): number[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const short: number[] = [];
  for (let col = 0; col < width; col++) {
    if (rows.every((r) => (r[col] ?? "").replace(ICON_TOKEN, "I").trim().length <= SHORT_CELL)) short.push(col);
  }
  return short;
}

const GuideTable = ({ children, node }: TableElementProps & { node?: HastNode }) => {
  const rows = node ? hastRows(node).map((r) => r.map(hastText)) : [];
  const id = `cc-guide-table-${node?.position?.start.line ?? 0}`;
  const nowrap = shortColumns(rows)
    .map((c) => `.${id} td:nth-child(${c + 1})`)
    .join(", ");
  return (
    <div className="cc-guide-table-frame">
      {nowrap && <style>{`${nowrap} { white-space: nowrap; }`}</style>}
      <table className={`cc-guide-table ${id}`}>{children}</table>
    </div>
  );
};

export const GuideView = ({ guide, lang }: { guide: Guide; lang: Language }) => {
  const mappings = useMemo<MarkdownComponents>(() => {
    // The generator recorded each heading's source line and unique slug; the hast node carries the same line.
    const slugByLine = new Map(guide.headings.map((h) => [h.line, h.slug]));
    const heading = (tag: HeadingTag): MappingFn<"h2"> => {
      const Base = stratoDefault(tag);
      const Mapped = (props: HeadingProps) => {
        const line = props.node?.position?.start.line;
        const id = line === undefined ? undefined : slugByLine.get(line);
        return <Base {...props} id={id} />;
      };
      Mapped.displayName = `GuideHeading(${tag})`;
      return Mapped;
    };
    // Text elements keep Strato's look; only their text children get the icon tokens replaced.
    const text = (tag: TextTag): MappingFn<"p"> => {
      const Base = stratoDefault(tag);
      const Mapped = (props: HeadingProps) => <Base {...props}>{withIcons(props.children, lang) as HeadingProps["children"]}</Base>;
      Mapped.displayName = `GuideText(${tag})`;
      return Mapped;
    };
    const cell = (Tag: "th" | "td") => {
      const Mapped = ({ children, style }: TableElementProps) => <Tag style={style?.textAlign ? { textAlign: style.textAlign } : undefined}>{withIcons(children, lang)}</Tag>;
      Mapped.displayName = `GuideCell(${Tag})`;
      return Mapped;
    };
    const BaseLink = stratoDefault("a");
    const GuideLink = (props: AnchorProps) => {
      const href = props.href ?? "";
      // Same-guide anchor, or another guide (the generator rewrote `x.md#y` to `/help?doc=x#y`).
      let to: string | undefined;
      if (href.startsWith("#")) to = helpHref(lang, guide.id, href.slice(1));
      else if (href.startsWith("/help")) {
        const url = new URL(href, "https://help.invalid");
        const doc = url.searchParams.get("doc");
        to = helpHref(lang, isGuideId(doc) ? doc : undefined, url.hash.slice(1));
      }
      if (to === undefined) return <BaseLink {...props} />;
      return (
        <Link as={RouterLink} to={to}>
          {props.children}
        </Link>
      );
    };
    GuideLink.displayName = "GuideLink";
    return {
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
      p: text("p"),
      li: text("li"),
      strong: text("strong"),
      em: text("em"),
      del: text("del"),
      a: GuideLink,
      table: GuideTable,
      thead: ({ children }: TableElementProps) => <thead>{children}</thead>,
      tbody: ({ children }: TableElementProps) => <tbody>{children}</tbody>,
      tr: ({ children }: TableElementProps) => <tr>{children}</tr>,
      th: cell("th"),
      td: cell("td"),
    } as MarkdownComponents;
  }, [guide, lang]);

  return (
    <>
      <style>{TABLE_CSS}</style>
      <Markdown customComponentMappings={mappings}>{guide.markdown}</Markdown>
    </>
  );
};
