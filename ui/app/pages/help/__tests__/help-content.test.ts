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
import { GUIDE_ICONS, ICON_TOKEN, PICTOGRAPH, splitIconTokens } from "../guides/icons";
import { helpHref, languageSwitchHref, resolveLanguage } from "../guides/language";
import { EVENT_FIELD_KEYS, OVERVIEW, SHORTCUT_KEYS } from "../overview";
import { EVENT_FIELDS } from "../../../components/snippets";

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
  it("prefers ?lang=, then the stored choice, then English; never the browser language", () => {
    expect(resolveLanguage({ query: "es", stored: "pt-BR" })).toBe("es");
    expect(resolveLanguage({ query: "xx", stored: "pt-BR" })).toBe("pt-BR");
    expect(resolveLanguage({ query: null, stored: "xx" })).toBe("en");
    expect(resolveLanguage({ stored: null })).toBe("en");
    expect(resolveLanguage({})).toBe("en");
  });

  it("switching the language goes to the same page in the new language, with ?lang= set", () => {
    expect(languageSwitchHref("en", "pt-BR", "user-guide", "#console")).toBe("/help?doc=user-guide&lang=pt-BR");
    expect(languageSwitchHref("pt-BR", "es", undefined, "#shortcuts")).toBe("/help?lang=es#shortcuts");
    expect(languageSwitchHref("es", "en", undefined, "")).toBe("/help?lang=en");
    expect(languageSwitchHref("es", "es", "operations")).toBeUndefined();
    expect(languageSwitchHref("es", null, "operations")).toBeUndefined();
    // Whatever the remembered choice, the new URL decides the language shown.
    const href = languageSwitchHref("en", "es", "integrations") ?? "";
    expect(resolveLanguage({ query: new URL(href, "https://help.invalid").searchParams.get("lang"), stored: "pt-BR" })).toBe("es");
  });

  it("builds shareable addresses with the guide, the language and the anchor", () => {
    expect(helpHref("pt-BR", "integrations", "custom-workflow")).toBe("/help?doc=integrations&lang=pt-BR#custom-workflow");
    expect(helpHref("en")).toBe("/help?lang=en");
    expect(helpHref("es", undefined, "#shortcuts")).toBe("/help?lang=es#shortcuts");
  });
});

describe("guide icons", () => {
  const files = LANGUAGES.flatMap((lang) => GUIDE_IDS.map((id) => ({ path: `${SOURCE_DIRS[lang]}/${id}.md`, text: read(`${SOURCE_DIRS[lang]}/${id}.md`) })));

  it("no guide source uses emoji or pictographs in place of the app's icons", () => {
    for (const { path, text } of files) {
      text.split("\n").forEach((line, i) => expect(PICTOGRAPH.exec(line)?.[0], `${path}:${i + 1}: ${line.trim().slice(0, 80)}`).toBeUndefined());
    }
  });

  it("every icon token in the guides is in the allowlist, and none sits in a heading or code", () => {
    let used = 0;
    for (const { path, text } of files) {
      for (const m of text.matchAll(ICON_TOKEN)) {
        used++;
        expect(Object.keys(GUIDE_ICONS), `${path}: ${m[0]}`).toContain(m[1]);
      }
      // A token in a heading would end up in its anchor; in inline code it would show as text.
      for (const line of text.split("\n")) {
        if (/^#{1,6} /.test(line)) expect(line, path).not.toMatch(/:icon\[/);
        for (const code of line.match(/`[^`]*`/g) ?? []) expect(code, path).not.toMatch(ICON_TOKEN);
      }
      // A misspelled token (":icon[X]" without the closing colon, ":icon(X):") would show up as text.
      expect(text.replace(ICON_TOKEN, ""), path).not.toMatch(/:icon\b/);
    }
    expect(used).toBeGreaterThan(0);
  });

  it("the translations use the same icons as the English guide", () => {
    const icons = (lang: Language, id: GuideId) => [...read(`${SOURCE_DIRS[lang]}/${id}.md`).matchAll(ICON_TOKEN)].map((m) => m[1]).sort();
    for (const id of GUIDE_IDS) {
      expect(icons("pt-BR", id), id).toEqual(icons("en", id));
      expect(icons("es", id), id).toEqual(icons("en", id));
    }
  });

  it("splits known tokens out of text and leaves unknown ones as written", () => {
    expect(splitIconTokens("Open :icon[SettingIcon]: Settings")).toEqual(["Open ", { icon: "SettingIcon" }, " Settings"]);
    expect(splitIconTokens(":icon[DotMenuIcon]::icon[NotAnIcon]: x")).toEqual([{ icon: "DotMenuIcon" }, ":icon[NotAnIcon]: x"]);
    expect(splitIconTokens(":icon[constructor]: :icon[toString]:")).toEqual([":icon[constructor]: :icon[toString]:"]);
    expect(splitIconTokens("plain")).toEqual(["plain"]);
    expect(splitIconTokens("")).toEqual([]);
  });

  it("every allowed icon has a label in every language", () => {
    for (const [name, info] of Object.entries(GUIDE_ICONS)) for (const lang of LANGUAGES) expect(info.label[lang].trim(), `${name} ${lang}`).not.toBe("");
  });
});

describe("help overview", () => {
  it("is translated into every language, with every section, step, shortcut and event field", () => {
    for (const lang of LANGUAGES) {
      const t = OVERVIEW[lang];
      for (const v of [t.title, t.subtitle, t.getStartedIntro, t.concepts, t.console, t.outbound, t.troubleshooting, t.privacy, ...Object.values(t.sections), ...t.steps, ...t.inbound])
        expect(v.trim(), lang).not.toBe("");
      expect(Object.keys(t.shortcuts).sort(), lang).toEqual([...SHORTCUT_KEYS].sort());
    }
    // The overview's event fields follow the shared list on Integrations.
    expect(EVENT_FIELDS.map((f) => f.field)).toEqual([...EVENT_FIELD_KEYS]);
    expect(OVERVIEW.en.eventFields).toEqual(Object.fromEntries(EVENT_FIELDS.map((f) => [f.field, f.usedFor])));
  });

  it("translations differ from English (the selected language is the language shown)", () => {
    for (const lang of ["pt-BR", "es"] as const) {
      expect(OVERVIEW[lang].concepts).not.toBe(OVERVIEW.en.concepts);
      expect(OVERVIEW[lang].sections.concepts).not.toBe(OVERVIEW.en.sections.concepts);
    }
  });
});
