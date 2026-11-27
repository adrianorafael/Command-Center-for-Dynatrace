/**
 * Language of the in-app documentation: which one to show, how to remember it, and the few labels the Help page needs
 * around the guides.
 *
 * Why this exists: the guides come in English, Portuguese (BR) and Spanish, and a shared /help link must open in the
 * language it was shared in, while a reader's own choice should survive the next visit. Precedence:
 * `?lang=` in the URL > the choice remembered in this browser > English.
 * The browser language is deliberately not used: the app itself is English, and picking Portuguese or Spanish on
 * its own surprised readers. Only an explicit choice in the selector is remembered; opening someone's link never
 * overwrites it.
 */
import { GUIDE_IDS, isLanguage, type GuideId, type GuideSet, type Language } from "./content";

export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", "pt-BR": "Português (BR)", es: "Español" };

const STORAGE_KEY = "command-center.help-language.v1";

export function resolveLanguage(input: { query?: string | null; stored?: string | null }): Language {
  if (isLanguage(input.query)) return input.query;
  if (isLanguage(input.stored)) return input.stored;
  return "en";
}

/**
 * Where the selector goes when the reader picks `next` while `current` is shown: the same guide (or the overview) in
 * the new language, with `?lang=` set so the URL, the selector and the content always name the same language.
 * A guide's anchors differ per language (they are translated headings), so a guide starts at the top; the overview's
 * section ids are the same in every language and the anchor is kept. `undefined` when nothing changes.
 */
export function languageSwitchHref(current: Language, next: Language | null | undefined, doc: GuideId | undefined, hash = ""): string | undefined {
  if (!next || !isLanguage(next) || next === current) return undefined;
  return helpHref(next, doc, doc ? undefined : hash.replace(/^#/, "") || undefined);
}

export function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLanguage(lang: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // storage unavailable: the choice lasts while the URL carries ?lang=
  }
}

/**
 * Lazy loading: one literal import() per language, so the bundler splits each into its own chunk and the main bundle
 * carries none of the ~110–125 KB modules. A computed path would defeat the split.
 */
export function loadGuides(lang: Language): Promise<GuideSet> {
  switch (lang) {
    case "pt-BR":
      return import("./generated/pt-BR").then((m) => m.default);
    case "es":
      return import("./generated/es").then((m) => m.default);
    default:
      return import("./generated/en").then((m) => m.default);
  }
}

interface HelpLabels {
  overview: string;
  guides: string;
  onThisPage: string;
  language: string;
  loading: string;
  loadFailed: string;
  /** Short guide names; Portuguese and Spanish are the ones the translated READMEs used. */
  guideNames: Record<GuideId, string>;
}

export const LABELS: Record<Language, HelpLabels> = {
  en: {
    overview: "Overview",
    guides: "Guides",
    onThisPage: "On this page",
    language: "Language",
    loading: "Loading the guide…",
    loadFailed: "The guide could not be loaded. Reload the page to try again.",
    guideNames: {
      "getting-started": "Getting started",
      "install-with-vibe-coding": "Install with vibe coding",
      "user-guide": "User guide",
      "alerts-reference": "Alerts reference",
      integrations: "Integrations",
      configuration: "Configuration",
      operations: "Operations",
    },
  },
  "pt-BR": {
    overview: "Visão geral",
    guides: "Guias",
    onThisPage: "Nesta página",
    language: "Idioma",
    loading: "Carregando o guia…",
    loadFailed: "Não foi possível carregar o guia. Recarregue a página para tentar de novo.",
    guideNames: {
      "getting-started": "Primeiros passos",
      "install-with-vibe-coding": "Instalar com vibe coding",
      "user-guide": "Guia do usuário",
      "alerts-reference": "Referência de alertas",
      integrations: "Integrações",
      configuration: "Configuração",
      operations: "Operações",
    },
  },
  es: {
    overview: "Resumen",
    guides: "Guías",
    onThisPage: "En esta página",
    language: "Idioma",
    loading: "Cargando la guía…",
    loadFailed: "No se pudo cargar la guía. Vuelve a cargar la página para intentarlo de nuevo.",
    guideNames: {
      "getting-started": "Primeros pasos",
      "install-with-vibe-coding": "Instalar con vibe coding",
      "user-guide": "Guía del usuario",
      "alerts-reference": "Referencia de alertas",
      integrations: "Integraciones",
      configuration: "Configuración",
      operations: "Operaciones",
    },
  },
};

/** The in-app address of a guide (or of the overview when `doc` is undefined), shareable as is. */
export function helpHref(lang: Language, doc?: GuideId, hash?: string): string {
  const q = new URLSearchParams();
  if (doc) q.set("doc", doc);
  q.set("lang", lang);
  return `/help?${q.toString()}${hash ? `#${hash.replace(/^#/, "")}` : ""}`;
}

export { GUIDE_IDS };
