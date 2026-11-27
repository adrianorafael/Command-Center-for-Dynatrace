/**
 * The in-app documentation: the generated modules match the markdown (run scripts/gen-help-content.mjs), the
 * generated content holds nothing the app cannot render, every in-app link lands on a heading, and the translations
 * keep the structure of the English source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GENERATED_FILES,
  GUIDE_IDS,
  LANGUAGES,
  renderLanguageModule,
  slugify,
  SOURCE_DIRS,
  transformGuide,
  transformGuides,
  type GuideId,
  type GuideSet,
  type Language,
} from "../guides/content";
import { helpHref, matchLanguage, resolveLanguage } from "../guides/language";

const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const sources = (lang: Language) => Object.fromEntries(GUIDE_IDS.map((id) => [id, read(`${SOURCE_DIRS[lang]}/${id}.md`)])) as Record<GuideId, string>;
const sets: Record<Language, GuideSet> = Object.fromEntries(LANGUAGES.map((l) => [l, transformGuides(sources(l))])) as Record<Language, GuideSet>;

describe("generated help content", () => {
  it.each(LANGUAGES)("%s module matches the markdown (run scripts/gen-help-content.mjs)", (lang) => {
    expect(read(GENERATED_FILES[lang])).toBe(renderLanguageModule(lang, SOURCE_DIRS[lang], sets[lang]));
  });

  it.each(LANGUAGES)("%s holds no images, mermaid, .md links, repository paths or language bar", (lang) => {
    for (const id of GUIDE_IDS) {
      const md = sets[lang][id].markdown;
      expect(md, id).not.toMatch(/!\[|```mermaid|\.md[)#]|\]\(\.\.?\/|screenshots\/|^🌐|app:omit|<br\s*\/?>/m);
      // Only the YOUR-ENVIRONMENT placeholder may name an environment (R1).
      expect(md.replace(/YOUR-ENVIRONMENT\.(apps|live)\.dynatrace\.com/g, ""), id).not.toMatch(/\.apps\.dynatrace\.com|\.live\.dynatrace\.com/);
      expect(md, id).not.toMatch(/dt0[a-z]\d{2}\.[A-Z0-9]{8,}|[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    }
  });

  it.each(LANGUAGES)("%s: every in-app link lands on a guide and a heading of the same language", (lang) => {
    for (const id of GUIDE_IDS) {
      const md = sets[lang][id].markdown;
      for (const [, href] of md.matchAll(/\]\(((?:\/help|#)[^)]*)\)/g)) {
        const url = new URL(href, `https://help.invalid/help?doc=${id}`);
        const target = url.searchParams.get("doc") as GuideId;
        expect(GUIDE_IDS, `${id}: ${href}`).toContain(target);
        const anchor = decodeURIComponent(url.hash.slice(1));
        if (anchor) expect(sets[lang][target].headings.map((h) => h.slug), `${id}: ${href}`).toContain(anchor);
      }
    }
  });

  it.each(LANGUAGES)("%s: heading anchors are unique per guide and point at heading lines", (lang) => {
    for (const id of GUIDE_IDS) {
      const { markdown, headings } = sets[lang][id];
      const slugs = headings.map((h) => h.slug);
      expect(new Set(slugs).size, id).toBe(slugs.length);
      const lines = markdown.split("\n");
      for (const h of headings) expect(lines[h.line - 1], `${id}: ${h.slug}`).toMatch(new RegExp(`^#{${h.depth}} `));
    }
  });

  it.each(["pt-BR", "es"] as const)("%s keeps the structure of the English guides (headings, code blocks, table rows, list items)", (lang) => {
    const shape = (md: string) => ({
      headings: md.split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => l.match(/^#+/)?.[0]).join(""),
      fences: (md.match(/^\s*```/gm) ?? []).length,
      tableRows: (md.match(/^\|/gm) ?? []).length,
      listItems: (md.match(/^\s*(?:[-*]|\d+\.) /gm) ?? []).length,
    });
    for (const id of GUIDE_IDS) expect(shape(sets[lang][id].markdown), id).toEqual(shape(sets.en[id].markdown));
  });
});

describe("guide transform", () => {
  it("drops images and app:omit blocks, re-fences mermaid, and turns guide links into in-app links", () => {
    const g = transformGuide(
      "user-guide",
      [
        "# Title",
        "",
        "<!-- app:omit -->",
        "Only on GitHub.",
        "<!-- /app:omit -->",
        "",
        "![Shot](../../screenshots/x.png)",
        "",
        "| Inbound ![Inbound](../../screenshots/y.png) | See [integrations](integrations.md#custom-workflow) and [here](#title). |",
        "",
        "```mermaid",
        "A[One<br/>two] --> B",
        "```",
        "",
        "```bash",
        "# not a heading",
        "```",
        "## Passo 2 — entenda as permissões",
      ].join("\n"),
    );
    expect(g.markdown).not.toContain("Only on GitHub");
    expect(g.markdown).not.toContain("![");
    expect(g.markdown).toContain("| Inbound | See [integrations](/help?doc=integrations#custom-workflow) and [here](#title). |");
    expect(g.markdown).toContain("```\nA[One two] --> B\n```");
    expect(g.headings.map((h) => h.slug)).toEqual(["title", "passo-2--entenda-as-permissões"]);
    expect(g.title).toBe("Title");
  });

  it("slugs like GitHub", () => {
    expect(slugify("The `cc.*` properties (placeholders)")).toBe("the-cc-properties-placeholders");
    expect(slugify("Ejecución en cada problema")).toBe("ejecución-en-cada-problema");
    expect(slugify("Step 2 — Understand the permissions")).toBe("step-2--understand-the-permissions");
  });
});

describe("help language", () => {
  it("prefers ?lang=, then the stored choice, then the browser, then English", () => {
    expect(resolveLanguage({ query: "es", stored: "pt-BR", browser: ["en-US"] })).toBe("es");
    expect(resolveLanguage({ query: "xx", stored: "pt-BR", browser: ["es-ES"] })).toBe("pt-BR");
    expect(resolveLanguage({ stored: null, browser: ["de-DE", "pt-PT"] })).toBe("pt-BR");
    expect(resolveLanguage({ browser: ["es-419"] })).toBe("es");
    expect(resolveLanguage({ browser: ["fr-FR"] })).toBe("en");
    expect(resolveLanguage({})).toBe("en");
    expect(matchLanguage("PT_br")).toBe("pt-BR");
    expect(matchLanguage(undefined)).toBeUndefined();
  });

  it("builds shareable addresses with the guide, the language and the anchor", () => {
    expect(helpHref("pt-BR", "integrations", "custom-workflow")).toBe("/help?doc=integrations&lang=pt-BR#custom-workflow");
    expect(helpHref("en")).toBe("/help?lang=en");
    expect(helpHref("es", undefined, "#shortcuts")).toBe("/help?lang=es#shortcuts");
  });
});
