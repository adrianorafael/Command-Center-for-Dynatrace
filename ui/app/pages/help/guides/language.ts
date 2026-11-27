/**
 * Language of the in-app documentation: which one to show, how to remember it, and the few labels the Help page needs
 * around the guides.
 *
 * Why this exists: the guides come in English, Portuguese (BR) and Spanish, and a shared /help link must open in the
 * language it was shared in, while a reader's own choice should survive the next visit. Precedence:
 * `?lang=` in the URL > the choice remembered in this browser > the browser language > English.
 * Only an explicit choice in the selector is remembered; opening someone's link never overwrites it.
 */
import { GUIDE_IDS, isLanguage, type GuideId, type GuideSet, type Language } from "./content";

export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", "pt-BR": "Português (BR)", es: "Español" };

const STORAGE_KEY = "command-center.help-language.v1";

/** Maps a BCP 47 tag ("pt-PT", "es-419", "en-GB") to a documentation language; Portuguese of any region gets pt-BR. */
export function matchLanguage(tag: string | null | undefined): Language | undefined {
  const base = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (base === "pt") return "pt-BR";
  if (base === "es") return "es";
  if (base === "en") return "en";
  return undefined;
}

export function resolveLanguage(input: { query?: string | null; stored?: string | null; browser?: readonly string[] }): Language {
  if (isLanguage(input.query)) return input.query;
  if (isLanguage(input.stored)) return input.stored;
  for (const tag of input.browser ?? []) {
    const lang = matchLanguage(tag);
    if (lang) return lang;
  }
  return "en";
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

export function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
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
