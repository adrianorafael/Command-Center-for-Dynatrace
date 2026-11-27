/**
 * Renders one documentation guide inside the app with Strato's Markdown component.
 *
 * Why this exists: the guides are generated markdown (guides/content.ts), and two things Markdown does not do on its
 * own are needed in the app: headings need GitHub-style ids so `#anchor` links land, and links between guides must
 * stay in the app (React Router) in the reader's language instead of opening a new browser tab. Everything else
 * keeps Strato's default element mappings.
 */
import React, { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Markdown, componentMappings } from "@dynatrace/strato-components/content";
import { Link } from "@dynatrace/strato-components/typography";
import { isGuideId, type Guide, type Language } from "./guides/content";
import { helpHref } from "./guides/language";

type MarkdownComponents = NonNullable<React.ComponentProps<typeof Markdown>["customComponentMappings"]>;
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
/** The function form of a mapping (react-markdown.d.ts also allows a plain tag name). */
type MappingFn<K extends keyof MarkdownComponents> = Extract<NonNullable<MarkdownComponents[K]>, (props: never) => React.ReactNode>;
type HeadingProps = Parameters<MappingFn<"h2">>[0];
type AnchorProps = Parameters<MappingFn<"a">>[0];

/** Strato's default mapping for a tag: always a function in Strato's componentMappings (Markdown.js). */
function stratoDefault<K extends HeadingTag | "a">(tag: K) {
  return componentMappings[tag] as unknown as React.ComponentType<K extends "a" ? AnchorProps : HeadingProps>;
}

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
      a: GuideLink,
    };
  }, [guide, lang]);

  return <Markdown customComponentMappings={mappings}>{guide.markdown}</Markdown>;
};
