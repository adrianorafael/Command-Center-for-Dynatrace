/**
 * In-app documentation: the model and the markdown → app transform.
 *
 * Why this exists: the seven user guides are written as markdown (English in docs/guides/en, the source on GitHub;
 * Portuguese (BR) and Spanish next to this file, the app is their only home). The Help page shows them with Strato's
 * `Markdown` component, which cannot show repository images, cannot draw mermaid and would send `x.md` links to
 * nowhere. `transformGuide` turns a guide into what the app can render, and `renderLanguageModule` writes the
 * generated TypeScript module of one language (scripts/gen-help-content.mjs). The drift test
 * (`__tests__/help-content.test.ts`) runs the same functions, so the script's `--check` and the test cannot disagree.
 *
 * Pure: no React, no DOM, no file system.
 */

export const LANGUAGES = ["en", "pt-BR", "es"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Guide ids are the markdown file names without `.md`; the order is the table of contents. */
export const GUIDE_IDS = ["getting-started", "install-with-vibe-coding", "user-guide", "alerts-reference", "integrations", "configuration", "operations"] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export interface GuideHeading {
  depth: number;
  text: string;
  /** GitHub-style anchor, unique within the guide. */
  slug: string;
  /** 1-based line of the heading in `Guide.markdown`: the renderer finds a heading's id by its source line. */
  line: number;
}

export interface Guide {
  id: GuideId;
  /** Text of the guide's first-level heading. */
  title: string;
  markdown: string;
  headings: GuideHeading[];
}

export type GuideSet = Record<GuideId, Guide>;

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);
}

export function isGuideId(v: unknown): v is GuideId {
  return typeof v === "string" && (GUIDE_IDS as readonly string[]).includes(v);
}

/**
 * GitHub's heading anchor: lower case, every character that is not a letter, digit, mark, space, `-` or `_` removed,
 * each space turned into `-`. "Passo 2 — entenda as permissões" → "passo-2--entenda-as-permissões".
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

/** Heading text as GitHub sees it for the anchor: inline code, emphasis and link syntax removed. */
function headingText(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

const FENCE = /^(\s*)(```+|~~~+)(.*)$/;

/**
 * Turns one guide's markdown into what the app renders:
 * - blocks between `<!-- app:omit -->` and `<!-- /app:omit -->` are dropped (text that only makes sense on GitHub);
 * - images are dropped (the repository screenshots are not part of the app bundle);
 * - mermaid diagrams become plain code blocks (Strato's Markdown has no diagram renderer; the source stays readable);
 * - links to another guide (`integrations.md#anchor`) become in-app links (`/help?doc=integrations#anchor`); the
 *   renderer adds the language.
 * Text is never rewritten otherwise.
 */
export function transformGuide(id: GuideId, source: string): Guide {
  const out: string[] = [];
  let fence: string | undefined;
  let mermaid = false;
  let omit = false;
  for (const rawLine of source.replace(/\r\n/g, "\n").split("\n")) {
    const f = FENCE.exec(rawLine);
    if (fence) {
      if (f && f[2].startsWith(fence) && f[3].trim() === "") fence = undefined;
      // Mermaid labels use <br/> for line breaks; in a plain code block a space reads better. Other code is untouched.
      out.push(mermaid ? rawLine.replace(/<br\s*\/?>/g, " ") : rawLine);
      continue;
    }
    if (rawLine.trim() === "<!-- app:omit -->") omit = true;
    else if (rawLine.trim() === "<!-- /app:omit -->") omit = false;
    else if (omit) continue;
    else if (f) {
      fence = f[2];
      mermaid = f[3].trim() === "mermaid";
      // A diagram is shown as its source: no language, so no misleading syntax highlighting.
      out.push(f[3].trim() === "mermaid" ? `${f[1]}${f[2]}` : rawLine);
    } else {
      const line = rawLine
        .replace(/ ?!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\]\(([a-z0-9-]+)\.md(#[^)]*)?\)/g, (_m, doc: string, hash?: string) => `](/help?doc=${doc}${hash ?? ""})`);
      // A line that held only images disappears (blank lines are collapsed below).
      if (line !== rawLine && line.trim() === "") continue;
      out.push(line);
    }
  }
  const markdown = out.join("\n").replace(/\n{3,}/g, "\n\n");
  const headings = extractHeadings(markdown);
  const title = headings.find((h) => h.depth === 1)?.text ?? id;
  return { id, title, markdown, headings };
}

/** ATX headings outside code blocks, with their 1-based line in `markdown`. */
function extractHeadings(markdown: string): GuideHeading[] {
  const headings: GuideHeading[] = [];
  let fence: string | undefined;
  markdown.split("\n").forEach((line, i) => {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[2].startsWith(fence) && f[3].trim() === "") fence = undefined;
      return;
    }
    if (f) {
      fence = f[2];
      return;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const text = headingText(h[2]);
      headings.push({ depth: h[1].length, text, slug: slugify(text), line: i + 1 });
    }
  });
  return headings;
}

export function transformGuides(sources: Record<GuideId, string>): GuideSet {
  const set = {} as GuideSet;
  for (const id of GUIDE_IDS) set[id] = transformGuide(id, sources[id]);
  return set;
}

/** The generated module of one language, exactly as checked in under `generated/`. */
export function renderLanguageModule(lang: Language, sourceDir: string, guides: GuideSet): string {
  return [
    `// GENERATED by scripts/gen-help-content.mjs from ${sourceDir}/*.md (${lang}). Do not edit:`,
    "// change the markdown and run `node scripts/gen-help-content.mjs`. A unit test fails when this file drifts.",
    "// The guides quote placeholder URLs (YOUR-ENVIRONMENT…), which the entropy rule mistakes for secrets. The drift test",
    "// checks that only placeholders appear and that no token pattern does (R1), so the rule is off for this file only.",
    "/* eslint-disable noSecrets/no-secrets */",
    'import type { GuideSet } from "../content";',
    "",
    `const guides: GuideSet = ${JSON.stringify(guides, null, 2)};`,
    "",
    "export default guides;",
    "",
  ].join("\n");
}

/** Where each language's markdown lives, relative to the repository root. */
export const SOURCE_DIRS: Record<Language, string> = {
  en: "docs/guides/en",
  "pt-BR": "ui/app/pages/help/guides/pt-BR",
  es: "ui/app/pages/help/guides/es",
};

/** Where each generated module lives, relative to the repository root. */
export const GENERATED_FILES: Record<Language, string> = {
  en: "ui/app/pages/help/guides/generated/en.ts",
  "pt-BR": "ui/app/pages/help/guides/generated/pt-BR.ts",
  es: "ui/app/pages/help/guides/generated/es.ts",
};
